const axios = require("axios");

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

// -------- CONFIG --------
const TS_URL =
  process.env.TS_URL ||
  "https://api.thingspeak.com/channels/3293797/feeds.json?results=1";

// Your Supabase PostgREST endpoint for the table
// https://mtizzberatdiejzpozds.supabase.co/rest/v1/thinkspeak_data
const SUPABASE_URL =
  process.env.SUPABASE_URL ||
  "https://mtizzberatdiejzpozds.supabase.co/rest/v1/thinkspeak_data";
const SUPABASE_KEY = process.env.SUPABASE_KEY;

const INTERVAL_MS = Number(process.env.INGEST_INTERVAL_MS || 3000);

// -------- TRACK LAST ENTRY --------
let lastEntryId = null;

function toInt(v) {
  const n = parseInt(v, 10);
  return Number.isFinite(n) ? n : null;
}

function toFloat(v) {
  const n = parseFloat(v);
  return Number.isFinite(n) ? n : null;
}

// -------- MAIN FUNCTION --------
async function sendData() {
  try {
    if (!SUPABASE_KEY) throw new Error("Missing SUPABASE_KEY (set it in .env).");

    const res = await axios.get(TS_URL, { timeout: 8000 });
    const feed = res?.data?.feeds?.[0];
    if (!feed) return;

    // ✅ Avoid duplicate inserts
    if (feed.entry_id === lastEntryId) return;
    lastEntryId = feed.entry_id;

    // -------- PURE RAW DATA --------
    const data = {
      mq135: toInt(feed.field1),
      mq9: toInt(feed.field2),
      bpm: toInt(feed.field3),
      temp: toFloat(feed.field4),

      lat: toFloat(feed.field5),
      lon: toFloat(feed.field6),

      worktime: toInt(feed.field7),
      alert: feed.field8 ?? null,

      created_at: feed.created_at ?? new Date().toISOString(),
    };

    console.log("New Data:", data);

    // -------- SEND TO SUPABASE --------
    await axios.post(SUPABASE_URL, data, {
      timeout: 8000,
      headers: {
        "Content-Type": "application/json",
        Accept: "application/json",
        apikey: SUPABASE_KEY,
        Authorization: `Bearer ${SUPABASE_KEY}`,
        "Content-Profile": "public",
        "Accept-Profile": "public",
        Prefer: "return=minimal",
      },
    });

    console.log("✅ Sent to Supabase");
  } catch (err) {
    const msg =
      err?.response?.data?.message ||
      err?.response?.data ||
      err?.message ||
      String(err);
    console.error("Error:", msg);
  }
}

// -------- FAST CHECK LOOP --------
sendData();
setInterval(sendData, INTERVAL_MS);

