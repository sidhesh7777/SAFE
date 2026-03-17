const axios = require("axios");
const twilio = require("twilio");

// Load .env if dotenv is available; otherwise do minimal parsing ourselves.
try {
  require("dotenv").config();
} catch {
  try {
    const fs = require("fs");
    const path = require("path");
    const envPath = path.join(__dirname, ".env");
    if (fs.existsSync(envPath)) {
      const lines = fs.readFileSync(envPath, "utf8").split(/\r?\n/);
      for (const line of lines) {
        const trimmed = line.trim();
        if (!trimmed || trimmed.startsWith("#")) continue;
        const eq = trimmed.indexOf("=");
        if (eq === -1) continue;
        const key = trimmed.slice(0, eq).trim();
        let val = trimmed.slice(eq + 1).trim();
        if (
          (val.startsWith('"') && val.endsWith('"')) ||
          (val.startsWith("'") && val.endsWith("'"))
        ) {
          val = val.slice(1, -1);
        }
        if (process.env[key] === undefined) process.env[key] = val;
      }
    }
  } catch {}
}

const SUPABASE_PROJECT_URL =
  process.env.SUPABASE_PROJECT_URL || "https://mtizzberatdiejzpozds.supabase.co";
const SUPABASE_KEY = process.env.SUPABASE_KEY;

const SOURCE_TABLE = process.env.AI_SOURCE_TABLE || "thinkspeak_data";
const STATUS_TABLE = process.env.AI_STATUS_TABLE || "worker_status";
const WORKERS_TABLE = process.env.AI_WORKERS_TABLE || "workers";
const RAVI_NAME_MATCH = process.env.RAVI_NAME_MATCH || "ravi";

const INTERVAL_MS = Number(process.env.AI_INTERVAL_MS || 3000);

// SMS config (Twilio)
const TWILIO_ACCOUNT_SID = process.env.TWILIO_ACCOUNT_SID;
const TWILIO_AUTH_TOKEN = process.env.TWILIO_AUTH_TOKEN;
const TWILIO_FROM_PHONE = process.env.TWILIO_FROM_PHONE;
const ALERT_TO_SUPERVISOR = process.env.ALERT_TO_SUPERVISOR;
const ALERT_TO_HOSPITAL = process.env.ALERT_TO_HOSPITAL;

let lastProcessedSourceTime = null;
let lastSmsSignature = null;

function supabaseHeaders() {
  return {
    apikey: SUPABASE_KEY,
    Authorization: `Bearer ${SUPABASE_KEY}`,
    "Content-Profile": "public",
    "Accept-Profile": "public",
    Accept: "application/json",
  };
}

function normalizeAlert(alertValue) {
  const raw = (alertValue ?? "").toString().trim();
  const up = raw.toUpperCase();

  if (!raw) return { alert: "UNKNOWN", message: "Unknown alert (empty)" };
  if (up === "OK" || up === "NORMAL" || up === "SAFE") return { alert: "OK", message: "All Normal" };

  // Keep it flexible: you said field8 could change to unknown values.
  // We map common keywords, otherwise treat as UNKNOWN but still show it on the website.
  if (up.includes("SOS")) return { alert: "SOS", message: "🚨 SOS EMERGENCY!" };
  if (up.includes("HEART")) return { alert: "HEART", message: "❤️ HEART ALERT!" };
  if (up.includes("GAS")) return { alert: "GAS", message: "⚠ GAS HAZARD ALERT!" };
  if (up.includes("TEMP")) return { alert: "TEMP", message: "🌡 TEMPERATURE ALERT!" };

  return { alert: raw, message: `⚠ ALERT: ${raw}` };
}

async function sendSmsIfNeeded({ alert, message, source_created_at }) {
  const needsSms = alert === "SOS" || alert === "HEART";
  if (!needsSms) return;

  // Prevent spamming if the backend restarts / loops quickly.
  const signature = `${alert}|${source_created_at}`;
  if (signature === lastSmsSignature) return;
  lastSmsSignature = signature;

  const canSend =
    TWILIO_ACCOUNT_SID &&
    TWILIO_AUTH_TOKEN &&
    TWILIO_FROM_PHONE &&
    (ALERT_TO_SUPERVISOR || ALERT_TO_HOSPITAL);

  if (!canSend) {
    console.log("📩 SMS skipped (Twilio/recipient env not configured).", { alert, message });
    return;
  }

  const client = twilio(TWILIO_ACCOUNT_SID, TWILIO_AUTH_TOKEN);
  const body = `${message}\nTime: ${source_created_at}`;

  const recipients = [ALERT_TO_SUPERVISOR, ALERT_TO_HOSPITAL].filter(Boolean);
  await Promise.all(
    recipients.map((to) =>
      client.messages.create({
        from: TWILIO_FROM_PHONE,
        to,
        body,
      })
    )
  );

  console.log("📩 SMS sent to:", recipients.join(", "));
}

async function readLatestSourceRow() {
  const url = `${SUPABASE_PROJECT_URL}/rest/v1/${encodeURIComponent(
    SOURCE_TABLE
  )}?select=created_at,worktime,alert&order=created_at.desc&limit=1`;

  const res = await axios.get(url, {
    timeout: 8000,
    headers: supabaseHeaders(),
  });

  return res?.data?.[0] || null;
}

async function writeStatusRow(payload) {
  // Use UPSERT to avoid duplicate-key crashes if the table has a PK/unique constraint
  // on source_created_at (common for "latest status per reading" setups).
  const url = `${SUPABASE_PROJECT_URL}/rest/v1/${encodeURIComponent(
    STATUS_TABLE
  )}?on_conflict=source_created_at`;

  await axios.post(url, payload, {
    timeout: 8000,
    headers: {
      ...supabaseHeaders(),
      "Content-Type": "application/json",
      Prefer: "return=minimal,resolution=merge-duplicates",
    },
  });
}

async function updateRaviWorkTime(worktime) {
  // Requirement: only Ravi's work_time should be updated in workers table.
  // Others stay as-is (you can keep them 0 by default).
  const url = `${SUPABASE_PROJECT_URL}/rest/v1/${encodeURIComponent(
    WORKERS_TABLE
  )}?name=ilike.${encodeURIComponent(RAVI_NAME_MATCH)}*`;

  // workers.work_time column in your table is text, so store as string.
  const payload = { work_time: String(Number.isFinite(Number(worktime)) ? Number(worktime) : 0) };

  await axios.patch(url, payload, {
    timeout: 8000,
    headers: {
      ...supabaseHeaders(),
      "Content-Type": "application/json",
      Prefer: "return=minimal",
    },
  });
}

async function runOnce() {
  try {
    if (!SUPABASE_KEY) throw new Error("Missing SUPABASE_KEY in environment.");

    const source = await readLatestSourceRow();
    if (!source) return;

    if (source.created_at === lastProcessedSourceTime) return;
    lastProcessedSourceTime = source.created_at;

    const norm = normalizeAlert(source.alert);
    const statusRow = {
      alert: norm.alert,
      message: norm.message,
      worktime: Number.isFinite(Number(source.worktime)) ? Number(source.worktime) : null,
      source_created_at: source.created_at,
      created_at: new Date().toISOString(),
    };

    await writeStatusRow(statusRow);
    console.log("✅ AI status stored:", statusRow);

    // Keep workers table in sync (Ravi only)
    await updateRaviWorkTime(statusRow.worktime);

    await sendSmsIfNeeded(statusRow);
  } catch (err) {
    const msg =
      err?.response?.data?.message ||
      err?.response?.data ||
      err?.message ||
      String(err);
    console.error("❌ AI monitor error:", msg);
  }
}

runOnce();
setInterval(runOnce, INTERVAL_MS);

