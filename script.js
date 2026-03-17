// SUPABASE CONFIG
const SUPABASE_URL = "https://mtizzberatdiejzpozds.supabase.co";
const SUPABASE_KEY = "sb_publishable_ClaMyLJYxVyKaVyGjynNRw_xnUZRrsF";

let supabaseClient;
let workers = [];
let selectedRow = null;
let latestSensorWorktime = null;

// INITIALIZE SUPABASE
function initSupabase() {
  if (!window.supabase) {
    console.error("Supabase library not loaded.");
    return;
  }
  supabaseClient = window.supabase.createClient(SUPABASE_URL, SUPABASE_KEY);
}

// Fetch ThingSpeak data and update hazard status for each worker
async function updateWorkerHazardStatus() {
  // Example: Fetch last entry from ThingSpeak channel
  const channelId = "US0fc09a36845fccdb0bb27123c4217de1";
  const url = `https://api.thingspeak.com/channels/${channelId}/feeds.json?results=1`;

  try {
    const resp = await fetch(url);
    const json = await resp.json();
    const feed = json?.feeds?.[0];
    if (!feed) return;

    // Example: Assume field1 is hazard indicator (customize as needed)
    const hazardValue = Number(feed.field1);
    const isHazard = Number.isFinite(hazardValue) ? hazardValue > 50 : false; // Threshold example
    workers.forEach((w) => {
      w.isHazard = isHazard;
    });
  } catch (e) {
    console.error("ThingSpeak fetch error", e);
    workers.forEach((w) => {
      w.isHazard = false;
    });
  }
}

// PAGE LOAD
window.addEventListener("DOMContentLoaded", () => {
  initSupabase();
  loadWorkers();
  startLiveStatusPolling();
  lockWorkTimeInputs();
  ensureGlobalAlertOverlay();
  initAttendancePage();
});

async function initAttendancePage() {
  // Only run on attendance.html
  const dropdown = document.getElementById("attendanceWorkerDropdown");
  const tableBody = document.getElementById("attendanceTableBody");
  if (!dropdown || !tableBody) return;
  await loadAttendanceWorkers();
  await loadAttendanceData();
}

async function loadAttendanceWorkers() {
  if (!supabaseClient) return;
  const dropdown = document.getElementById("attendanceWorkerDropdown");
  if (!dropdown) return;

  const { data, error } = await supabaseClient.from("workers").select("name").order("name", { ascending: true });
  if (error) {
    console.error("attendance workers load error", error);
    return;
  }

  dropdown.innerHTML = '<option value="">Select Worker</option>';
  (data || []).forEach((worker) => {
    if (!worker?.name) return;
    const opt = document.createElement("option");
    opt.value = worker.name;
    opt.textContent = worker.name;
    dropdown.appendChild(opt);
  });
}

function getSelectedAttendanceWorkerName() {
  const dropdown = document.getElementById("attendanceWorkerDropdown");
  return (dropdown?.value || "").trim();
}

async function attendanceCheckIn() {
  if (!supabaseClient) return;
  const name = getSelectedAttendanceWorkerName();
  if (!name) return alert("Select worker");

  const payload = {
    worker_name: name,
    check_in: new Date().toISOString(),
    status: "IN",
  };

  const { error } = await supabaseClient.from("attendance").insert([payload], { returning: "minimal" });
  if (error) {
    console.error("attendance checkin error", error);
    alert(`Check In failed: ${error.message || "Unknown error"}`);
    return;
  }

  loadAttendanceData();
}

async function attendanceCheckOut() {
  if (!supabaseClient) return;
  const name = getSelectedAttendanceWorkerName();
  if (!name) return alert("Select worker");

  const payload = {
    check_out: new Date().toISOString(),
    status: "OUT",
  };

  const { error } = await supabaseClient
    .from("attendance")
    .update(payload, { returning: "minimal" })
    .eq("worker_name", name)
    .eq("status", "IN");

  if (error) {
    console.error("attendance checkout error", error);
    alert(`Check Out failed: ${error.message || "Unknown error"}`);
    return;
  }

  loadAttendanceData();
}

function formatDateTimeMaybe(value) {
  if (!value) return "-";
  const d = new Date(value);
  if (Number.isNaN(d.getTime())) return "-";
  return d.toLocaleString();
}

async function loadAttendanceData() {
  if (!supabaseClient) return;
  const tableBody = document.getElementById("attendanceTableBody");
  if (!tableBody) return;

  const { data, error } = await supabaseClient
    .from("attendance")
    .select("*")
    .order("check_in", { ascending: false })
    .limit(200);

  if (error) {
    console.error("attendance load error", error);
    return;
  }

  tableBody.innerHTML = "";
  (data || []).forEach((row) => {
    const tr = document.createElement("tr");
    const status = (row.status || "").toString().toUpperCase();
    const badgeClass = status === "IN" ? "in" : "out";
    tr.innerHTML = `
      <td>${row.worker_name || "-"}</td>
      <td>${formatDateTimeMaybe(row.check_in)}</td>
      <td>${formatDateTimeMaybe(row.check_out)}</td>
      <td><span class="badge ${badgeClass}">${status || "-"}</span></td>
    `;
    tableBody.appendChild(tr);
  });
}

function ensureGlobalAlertOverlay() {
  if (document.getElementById("globalAlertOverlay")) return;

  const overlay = document.createElement("div");
  overlay.id = "globalAlertOverlay";
  overlay.style.position = "fixed";
  overlay.style.inset = "0";
  overlay.style.zIndex = "99999";
  overlay.style.display = "none";
  overlay.style.alignItems = "center";
  overlay.style.justifyContent = "center";
  overlay.style.background = "rgba(0,0,0,0.72)";
  overlay.style.backdropFilter = "blur(2px)";
  overlay.style.padding = "18px";

  overlay.innerHTML = `
    <div style="width:min(780px, 96vw); background:#fff; border-radius:16px; box-shadow:0 18px 60px rgba(0,0,0,0.35); padding:18px;">
      <div style="display:flex; align-items:flex-start; justify-content:space-between; gap:12px; border-bottom:1px solid #eef2f6; padding-bottom:12px; margin-bottom:12px;">
        <div style="display:flex; gap:12px; align-items:center;">
          <div id="globalAlertIcon" style="width:44px; height:44px; border-radius:12px; display:flex; align-items:center; justify-content:center; font-size:22px; background:#ffe5e5; color:#c0392b;">!</div>
          <div>
            <div id="globalAlertTitle" style="font-weight:900; font-size:20px; color:#0a3d62;">ALERT</div>
            <div id="globalAlertSubtitle" style="color:#5b6b7a; margin-top:2px;">Immediate attention required</div>
          </div>
        </div>
        <button id="globalAlertAcknowledge" style="border:none; border-radius:10px; padding:10px 14px; cursor:pointer; background:#0a3d62; color:#fff; font-weight:800;">
          Acknowledge
        </button>
      </div>

      <div id="globalAlertMessage" style="font-size:18px; font-weight:800; color:#2c3e50; margin-bottom:10px;">—</div>

      <div style="display:flex; gap:14px; flex-wrap:wrap; margin-top:10px;">
        <div style="flex:1; min-width:180px; background:#f7fbff; border:1px solid #e6eef6; border-radius:12px; padding:12px;">
          <div style="font-weight:800; color:#0a3d62;">Alert Type</div>
          <div id="globalAlertType" style="margin-top:4px; font-size:16px; color:#2c3e50;">—</div>
        </div>
        <div style="flex:1; min-width:180px; background:#f7fbff; border:1px solid #e6eef6; border-radius:12px; padding:12px;">
          <div style="font-weight:800; color:#0a3d62;">Work Time</div>
          <div id="globalAlertWorkTime" style="margin-top:4px; font-size:16px; color:#2c3e50;">—</div>
        </div>
        <div style="flex:1; min-width:180px; background:#f7fbff; border:1px solid #e6eef6; border-radius:12px; padding:12px;">
          <div style="font-weight:800; color:#0a3d62;">Updated</div>
          <div id="globalAlertUpdated" style="margin-top:4px; font-size:16px; color:#2c3e50;">—</div>
        </div>
      </div>

      <div style="margin-top:12px; color:#6b7b8a; font-size:13px;">
        This alert is shown across all pages until the device returns to <b>OK</b>.
      </div>
    </div>
  `;

  document.body.appendChild(overlay);

  const ack = overlay.querySelector("#globalAlertAcknowledge");
  ack?.addEventListener("click", () => {
    // Hide locally, but it will re-appear if the alert is still active on next poll.
    overlay.style.display = "none";
  });
}

function setGlobalAlertOverlay(status) {
  const overlay = document.getElementById("globalAlertOverlay");
  if (!overlay) return;

  const alertRaw = (status?.alert ?? "UNKNOWN").toString();
  const alertUp = alertRaw.trim().toUpperCase();
  const isOk = alertUp === "OK" || alertUp === "NORMAL" || alertUp === "SAFE";

  if (isOk) {
    overlay.style.display = "none";
    return;
  }

  const message = status?.message ?? `⚠ ALERT: ${alertRaw}`;
  const worktime = status?.worktime ?? "—";
  const time = status?.source_created_at || status?.created_at;

  const isCritical = alertUp.includes("SOS") || alertUp.includes("HEART");
  const icon = alertUp.includes("SOS")
    ? "🚨"
    : alertUp.includes("HEART")
      ? "❤️"
      : alertUp.includes("GAS")
        ? "⚠"
        : alertUp.includes("TEMP")
          ? "🌡"
          : "!";

  const color = isCritical ? "#d32f2f" : "#f39c12";
  const soft = isCritical ? "#ffe5e5" : "#fff2d6";

  const iconEl = document.getElementById("globalAlertIcon");
  const titleEl = document.getElementById("globalAlertTitle");
  const subEl = document.getElementById("globalAlertSubtitle");
  const msgEl = document.getElementById("globalAlertMessage");
  const typeEl = document.getElementById("globalAlertType");
  const wtEl = document.getElementById("globalAlertWorkTime");
  const updEl = document.getElementById("globalAlertUpdated");

  if (iconEl) {
    iconEl.textContent = icon;
    iconEl.style.background = soft;
    iconEl.style.color = color;
  }
  if (titleEl) titleEl.textContent = isCritical ? "CRITICAL ALERT" : "ALERT";
  if (subEl) subEl.textContent = isCritical ? "SMS will be sent for SOS/HEART" : "Please check worker condition";
  if (msgEl) msgEl.textContent = message;
  if (typeEl) typeEl.textContent = alertRaw;
  if (wtEl) wtEl.textContent = String(worktime);
  if (updEl) updEl.textContent = time ? new Date(time).toLocaleString() : "—";

  overlay.style.display = "flex";
}

function lockWorkTimeInputs() {
  // Make work time non-editable anywhere it exists in the UI.
  const el = document.getElementById("workTime");
  if (!el) return;
  el.setAttribute("readonly", "true");
  el.setAttribute("disabled", "true");
  el.placeholder = "Auto-updated from sensors";
}

function isRavi(worker) {
  const name = (worker?.name ?? "").toString().trim().toLowerCase();
  return name === "ravi" || name.includes("ravi");
}

function getDisplayedWorkTime(worker) {
  // Requirement: only Ravi gets live worktime; everyone else is always 0.
  if (!isRavi(worker)) return 0;
  const n = Number(latestSensorWorktime);
  return Number.isFinite(n) ? n : 0;
}

function setLiveStatusUI(status) {
  const dot = document.getElementById("liveStatusDot");
  const msg = document.getElementById("liveStatusMessage");
  const upd = document.getElementById("liveStatusUpdated");
  if (!dot || !msg || !upd) return; // only exists on workers.html

  const alert = (status?.alert ?? "UNKNOWN").toString();
  const message = status?.message ?? "—";
  const time = status?.source_created_at || status?.created_at;

  const alertUp = alert.toUpperCase();
  const isOk = alertUp === "OK" || alertUp === "NORMAL" || alertUp === "SAFE";
  const isCritical = alertUp.includes("SOS") || alertUp.includes("HEART");
  const color = isOk ? "#18a558" : isCritical ? "#d32f2f" : "#f39c12";

  dot.style.background = color;
  dot.style.boxShadow = `0 0 0 4px ${color}1f`;
  msg.textContent = message;
  upd.textContent = time ? new Date(time).toLocaleString() : "—";

  const wt = Number(status?.worktime);
  latestSensorWorktime = Number.isFinite(wt) ? wt : latestSensorWorktime;
}

async function loadLatestWorkerStatus() {
  if (!supabaseClient) return null;
  // Prefer ordering by source_created_at if it exists; otherwise fall back to created_at only.
  let res = await supabaseClient
    .from("worker_status")
    .select("*")
    .order("source_created_at", { ascending: false })
    .order("created_at", { ascending: false })
    .limit(1);

  if (res.error) {
    // If source_created_at column doesn't exist yet, retry with created_at.
    res = await supabaseClient
      .from("worker_status")
      .select("*")
      .order("created_at", { ascending: false })
      .limit(1);
  }

  if (res.error) {
    console.error("worker_status load error", res.error);
    return null;
  }

  return res.data?.[0] || null;
}

let _liveStatusTimer = null;
async function startLiveStatusPolling() {
  // Only start on pages that have the status bar.
  // But always keep the global alert overlay updated on every page.
  if (_liveStatusTimer) return;

  const tick = async () => {
    const status = await loadLatestWorkerStatus();
    if (status) {
      setLiveStatusUI(status);
      setGlobalAlertOverlay(status);
    }
  };

  await tick();
  _liveStatusTimer = setInterval(tick, 3000);
}

// LOAD WORKERS
async function loadWorkers() {
  if (!supabaseClient) return;

  const { data, error } = await supabaseClient
    .from("workers")
    .select("*")
    .order("created_at", { ascending: false });

  if (error) {
    console.error(error);
    alert("Error loading workers");
    return;
  }

  workers = data || [];
  await updateWorkerHazardStatus();
  displayWorkers();
}

// OPEN FORM
function openForm() {
  const el = document.getElementById("workerForm");
  if (el) el.style.display = "block";
}

function openform() {
  openForm();
}

// CLOSE FORM
function closeForm() {
  const el = document.getElementById("workerForm");
  if (el) el.style.display = "none";
}

// UTILS
function readFileAsDataUrl(file) {
  return new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.onload = () => resolve(reader.result);
    reader.onerror = () => reject(new Error("File reading failed"));
    reader.readAsDataURL(file);
  });
}

async function getPhotoFromForm() {
  const fileInput = document.getElementById("photoFile");
  if (fileInput?.files?.length) {
    try {
      return await readFileAsDataUrl(fileInput.files[0]);
    } catch (e) {
      console.error("Photo file read error", e);
    }
  }
  return document.getElementById("photoUrl")?.value || "";
}

// ADD WORKER
async function addWorker() {
  if (!supabaseClient) {
    alert("Supabase is not initialized yet.");
    return;
  }

  const getValue = (id) => document.getElementById(id)?.value || "";
  const photo = await getPhotoFromForm();

  const newWorker = {
    name: getValue("name"),
    age: Number(getValue("age")) || null,
    role: getValue("role"),
    mobile: getValue("mobile"),
    email: getValue("email"),
    gender: getValue("gender"),
    blood_group: getValue("bloodGroup"),
    // Work time is not user-writable; default stored value is 0 for all workers.
    // Ravi's displayed work time is live-updated from sensors (worker_status.worktime).
    work_time: 0,
    checkup: getValue("checkup"),
    health: getValue("health") || "Fit",
    history: getValue("history"),
    created_at: new Date().toISOString(),
  };

  if (photo) newWorker.photo = photo;

  const { error } = await supabaseClient
    .from("workers")
    .insert([newWorker], { returning: "minimal" });

  if (error) {
    console.error("Add worker error:", error);
    alert(`Insert failed: ${error.message || error.code || "Unknown error"}`);
    return;
  }

  clearForm();
  closeForm();
  alert("Worker Added Successfully");
  loadWorkers();
}

// CLEAR FORM
function clearForm() {
  const setValue = (id, value) => {
    const el = document.getElementById(id);
    if (el) el.value = value;
  };

  setValue("name", "");
  setValue("age", "");
  setValue("role", "");
  setValue("photoUrl", "");
  setValue("mobile", "");
  setValue("email", "");
  setValue("gender", "");
  setValue("bloodGroup", "");
  setValue("workTime", "");
  setValue("checkup", "");
  setValue("health", "Fit");
  setValue("history", "");
  const photoFile = document.getElementById("photoFile");
  if (photoFile) photoFile.value = "";
}

// DISPLAY WORKERS
function displayWorkers() {
  const table = document.getElementById("workerTable");
  if (!table) return;

  const listContainer = document.querySelector(".worker-list");
  if (listContainer) {
    listContainer.style.maxHeight = "60vh";
    listContainer.style.overflowY = "auto";
    listContainer.style.flex = "1 1 0";
    listContainer.style.minWidth = "350px";
  }

  table.style.width = "100%";
  table.style.tableLayout = "fixed";

  table.innerHTML = `
    <tr>
      <th>Photo</th>
      <th>Name</th>
      <th>Role</th>
      <th>Health</th>
      <th>Action</th>
    </tr>
  `;

  workers.forEach((worker, index) => {
    const color = worker.isHazard ? "red" : "#1b7f3a";
    const photoSrc = worker.photo || "logo.png";
    const displayWorkTime = getDisplayedWorkTime(worker);

    const row = document.createElement("tr");
    row.className = "worker-row";
    row.innerHTML = `
      <td style="width:72px;">
        <img src="${photoSrc}" style="width:56px; height:auto; max-height:72px; object-fit:cover; border-radius:6px; border:1px solid #ccc;">
      </td>
      <td style="font-weight:bold;color:#0a3d62; font-size:14px;">${worker.name || "-"}</td>
      <td>${worker.role || "-"}</td>
      <td style="color:${color}; font-weight:bold;">
        ${worker.health || "-"}${worker.isHazard ? " (Hazard)" : ""}
      </td>
      <td>
        <button onclick="deleteWorker(${index})">Delete</button>
      </td>
    `;

    row.addEventListener("click", (event) => {
      if (event.target?.tagName === "BUTTON") return;
      // Inject live work time into the object for the profile rendering only.
      const workerForProfile = { ...worker, work_time: displayWorkTime };
      showDetails(workerForProfile, event);
      if (selectedRow) selectedRow.classList.remove("selected-row");
      row.classList.add("selected-row");
      selectedRow = row;
    });

    table.appendChild(row);
  });
}

// DELETE WORKER
async function deleteWorker(index) {
  const worker = workers[index];
  if (!worker) return;
  if (!supabaseClient) return;

  if (!confirm(`Delete worker ${worker.name || ""}?`)) return;

  const { error } = await supabaseClient.from("workers").delete().eq("id", worker.id);
  if (error) {
    console.error(error);
    alert("Delete failed");
    return;
  }

  loadWorkers();
}

// SEARCH WORKER
function searchWorker() {
  const input = (document.getElementById("searchInput")?.value || "").toLowerCase();
  const rows = document.querySelectorAll("#workerTable tr");

  rows.forEach((row, i) => {
    if (i === 0) return; // header
    const name = row.cells?.[1]?.innerText?.toLowerCase?.() || "";
    row.style.display = name.includes(input) ? "" : "none";
  });
}

// SHOW DETAILS (floating panel)
function showDetails(worker, event) {
  let panel = document.getElementById("workerProfile");

  if (!panel) {
    panel = document.createElement("div");
    panel.id = "workerProfile";
    panel.className = "worker-profile";
    panel.style.position = "absolute";
    panel.style.zIndex = "2000";
    panel.style.background = "#fff";
    panel.style.boxShadow = "0 10px 30px rgba(0,0,0,0.2)";
    panel.style.borderRadius = "12px";
    panel.style.padding = "14px";
    panel.style.width = "340px";
    panel.style.maxHeight = "420px";
    panel.style.overflowY = "auto";
    panel.style.cursor = "default";
    panel.style.fontSize = "15px";
    panel.style.lineHeight = "1.45";
    panel.style.transition = "opacity 200ms ease, transform 200ms ease";
    panel.style.opacity = "0";
    panel.style.transform = "translateY(8px)";
    panel.style.backdropFilter = "blur(1px)";
    document.body.appendChild(panel);
  }

  const clickX = event?.pageX ?? (event?.clientX ? event.clientX + window.scrollX : 20);
  const clickY = event?.pageY ?? (event?.clientY ? event.clientY + window.scrollY : 80);

  const width = panel.offsetWidth || 340;
  const height = panel.offsetHeight || 420;
  const margin = 10;

  let left = clickX + 16;
  let top = clickY - 10;

  if (left + width + margin > window.scrollX + window.innerWidth) left = clickX - width - 16;
  if (left < window.scrollX + margin) left = window.scrollX + margin;
  if (top + height + margin > window.scrollY + window.innerHeight) top = clickY - height - 16;
  if (top < window.scrollY + margin) top = clickY + 16;

  panel.style.left = `${left}px`;
  panel.style.top = `${top}px`;
  panel.style.display = "block";
  panel.style.opacity = "0";
  panel.style.transform = "translateY(8px)";

  const hazardColor = worker.isHazard ? "red" : "green";
  const hazardLabel = worker.isHazard ? "Hazardous/Danger" : "Safe/Normal";

  panel.innerHTML = `
    <div style="position:relative; margin-bottom:10px; padding-bottom:4px; border-bottom:1px solid #e0e0e0;">
      <button onclick="closeProfile()" style="position:absolute; top:8px; right:8px; width:28px; height:28px; border:none; border-radius:50%; font-size:16px; cursor:pointer; background:#f0f0f0; color:#333; line-height:28px; text-align:center; padding:0;">&times;</button>
      <div style="font-weight:800; font-size:18px; margin-top:0;">Worker Details</div>
    </div>
    <div style="display:flex; gap:10px; margin-bottom:10px; align-items:flex-start;">
      <img src="${worker.photo || "logo.png"}" style="width:160px; height:auto; max-height:170px; object-fit:contain; border-radius:9px; border:1px solid #ccc; background:#f5f5f5;">
      <div style="flex:1; display:flex; flex-direction:column; gap:5px; font-size:15px;">
        <div style="font-weight:700; font-size:18px;">${worker.name || "-"}</div>
        <div><b>Role:</b> ${worker.role || "-"}</div>
        <div><b>Health:</b> ${worker.health || "-"}</div>
      </div>
    </div>
    <div style="display:grid; grid-template-columns: 94px 1fr; gap:4px 8px; font-size:15px; margin-bottom:6px;">
      <div><b>Age:</b></div><div>${worker.age || "-"}</div>
      <div><b>Mobile:</b></div><div>${worker.mobile || "-"}</div>
      <div><b>Email:</b></div><div>${worker.email || "-"}</div>
      <div><b>Work Time:</b></div><div>${worker.work_time ?? "-"}</div>
      <div><b>Checkup:</b></div><div>${worker.checkup || "-"}</div>
      <div><b>History:</b></div><div>${worker.history || "-"}</div>
    </div>
    <div style="margin-top:10px; text-align:center;">
      <span style="display:inline-block; width:18px; height:18px; border-radius:50%; background:${hazardColor}; border:2px solid #fff;"></span>
      <span style="font-weight:bold; color:${hazardColor}; margin-left:8px;">${hazardLabel}</span>
    </div>
  `;

  requestAnimationFrame(() => {
    panel.style.opacity = "1";
    panel.style.transform = "translateY(0)";
  });
}

// CLOSE PROFILE
function closeProfile() {
  const panel = document.getElementById("workerProfile");
  if (panel) panel.style.display = "none";
}

// LOGIN FUNCTION
function login() {
  const supervisor = document.getElementById("supervisorName")?.value;
  const phone = document.getElementById("phoneNumber")?.value;
  const hospital = document.getElementById("hospitalNumber")?.value;

  if (!supervisor || !phone || !hospital) {
    alert("Please fill all details");
    return;
  }
  if (phone.length < 10) {
    alert("Please enter a valid phone number");
    return;
  }
  if (hospital.length < 10) {
    alert("Please enter a valid hospital contact number");
    return;
  }

  alert("Login Successful");
  window.location.href = "home.html";
}

// Expose handlers for inline onclick="" usage across pages
window.openform = openform;
window.openForm = openForm;
window.closeForm = closeForm;
window.addWorker = addWorker;
window.deleteWorker = deleteWorker;
window.searchWorker = searchWorker;
window.showDetails = showDetails;
window.closeProfile = closeProfile;
window.login = login;
window.attendanceCheckIn = attendanceCheckIn;
window.attendanceCheckOut = attendanceCheckOut;