// SUPABASE CONFIG
const SUPABASE_URL = "https://mtizzberatdiejzpozds.supabase.co";
const SUPABASE_KEY = "sb_publishable_ClaMyLJYxVyKaVyGjynNRw_xnUZRrsF";

let supabaseClient;
let workers = [];
let selectedRow = null;

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
});

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
    work_time: getValue("workTime"),
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
      showDetails(worker, event);
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
      <div><b>Work Time:</b></div><div>${worker.work_time || "-"}</div>
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