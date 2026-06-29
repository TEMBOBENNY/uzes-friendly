import { auth, db } from "./firebase.js";
import { protect } from "./guard.js";
import { initSubHero } from "./subhero.js?v=4";
import { adminTabs } from "./nav.js";
import { firebaseConfig, UPLOAD_WORKER_URL } from "./config.js";
import { uploadArchive, deleteUpload, deleteUploadPrefix, authHeaders } from "./upload.js";
import { audit } from "./audit.js";
import {
  collection, doc, getDoc, getDocs, setDoc, updateDoc, deleteDoc,
  query, where, orderBy, serverTimestamp, writeBatch
} from "https://www.gstatic.com/firebasejs/10.12.2/firebase-firestore.js";
import {
  sendPasswordResetEmail, reauthenticateWithCredential, EmailAuthProvider
} from "https://www.gstatic.com/firebasejs/10.12.2/firebase-auth.js";
import { initializeApp }
  from "https://www.gstatic.com/firebasejs/10.12.2/firebase-app.js";
import {
  initializeAuth, inMemoryPersistence, createUserWithEmailAndPassword,
  signOut as secondarySignOut, deleteUser
} from "https://www.gstatic.com/firebasejs/10.12.2/firebase-auth.js";

// Secondary Firebase app for creating accounts WITHOUT disturbing the admin's
// own login. In-memory persistence keeps it fully isolated from the primary
// app's auth storage — otherwise creating/signing-out here clobbers the admin's
// session and the profile write runs unauthenticated (→ orphaned Auth account
// with no profile doc: can't log in, doesn't show, email "already in use").
const secondaryApp  = initializeApp(firebaseConfig, "secondary");
const secondaryAuth = initializeAuth(secondaryApp, { persistence: inMemoryPersistence });

/**
 * Create an Auth account on the isolated secondary app, then run writeDocs(uid)
 * as the admin on the primary db. If the Firestore writes fail, the just-created
 * Auth account is rolled back so no orphaned (email-in-use) account is left behind.
 */
async function createAccount(email, password, writeDocs) {
  const cred = await createUserWithEmailAndPassword(secondaryAuth, email, password);
  try {
    await writeDocs(cred.user.uid);
  } catch (docErr) {
    try { await deleteUser(cred.user); } catch (_) {}   // roll back the orphan
    throw docErr;
  }
  try { await secondarySignOut(secondaryAuth); } catch (_) {}
  return cred.user.uid;
}

// ── Admin Auth-deletion helpers ───────────────────────────────────────────────
// Token is stored in Firestore settings/adminApi (admin-only) and cached here.
let _adminDeleteToken = null;
async function getAdminDeleteToken() {
  if (_adminDeleteToken !== null) return _adminDeleteToken;
  try {
    const snap = await getDoc(doc(db, "settings", "adminApi"));
    _adminDeleteToken = snap.exists() ? (snap.data().deleteToken || "") : "";
  } catch (_) { _adminDeleteToken = ""; }
  return _adminDeleteToken;
}

let _adminResetToken = null;
async function getAdminResetToken() {
  if (_adminResetToken !== null) return _adminResetToken;
  try {
    const snap = await getDoc(doc(db, "settings", "adminApi"));
    _adminResetToken = snap.exists() ? (snap.data().resetToken || "") : "";
  } catch (_) { _adminResetToken = ""; }
  return _adminResetToken;
}

// Called AFTER Firestore cleanup. Surfaces failures so the admin can fix config.
async function deleteFirebaseAuthUser(uid) {
  const token = await getAdminDeleteToken();
  if (!token) {
    alert("Firestore cleanup succeeded BUT the Firebase Auth account was NOT deleted.\n\nReason: Admin delete secret is not configured in System tab.\nThe user can still log in until you delete them from the Firebase Console.");
    return;
  }
  try {
    const res = await fetch(UPLOAD_WORKER_URL + "/admin/delete-auth-user", {
      method: "POST",
      headers: { "Content-Type": "application/json", ...await authHeaders() },
      body: JSON.stringify({ uid, token }),
    });
    const data = await res.json().catch(() => ({}));
    if (!res.ok) {
      alert("Firestore cleanup succeeded BUT the Firebase Auth account was NOT deleted.\n\nWorker error: " + (data.error || res.status) + "\n\nFix: open the System tab → Admin API → Test secret. If the test fails, check that the same secret is set as ADMIN_DELETE_SECRET in your Cloudflare Worker dashboard.");
    }
  } catch (err) {
    alert("Firestore cleanup succeeded BUT the Firebase Auth account was NOT deleted.\n\nNetwork error reaching Worker: " + err.message);
  }
}

// ── Constants ─────────────────────────────────────────────────────────────────
export const POSITIONS = [
  "Chairperson", "Vice Chairperson", "Secretary General", "Vice Secretary General",
  "Treasurer", "Information and Publicity Secretary",
  "Social and Cultural Secretary", "Committee Member"
];

export const DEPARTMENTS = [
  "Agricultural Engineering",
  "Civil and Environmental Engineering",
  "Electrical and Electronic Engineering",
  "Geomatic Engineering",
  "Mechanical Engineering"
];

export const YEAR_OPTIONS = [
  "1st Year", "2nd Year", "3rd Year", "4th Year", "5th Year", "Graduate"
];

// ── School of Engineering undergraduate courses (from SoE Handbook) ────────────
const SOE_COURSES = {
  "Bachelor of Engineering (Agricultural Engineering)": {
    "Year 1": ["MAT 1100","PHY 1010","BIO 1412","CHE 1000"],
    "Year 2": ["CEE 2219","EEE 2019","ENG 2129","ENG 2139","ENG 2159","MAT 2110","MEC 2009","MEC 2309"],
    "Year 3": ["AGG 3811","CEE 3311","AGA 3335","MEC 3401","MAT 3110","MEC 3352","AGC 3135","AEN 3412"],
    "Year 4": ["CEE 4311","AEN 4311","GEE 4812","MAT 4119","AEN 4512","ENG 4129","AEN 4112","AEN 4612","ENG 4143"],
    "Year 5": ["AEN 5211","AEN 5421","AEN 5321","AEN 5714","AEN 5132","ENG 5129","ENG 5143","CEE 4412","AEN 5122","AEN 5222","AEN 5522"],
  },
  "Bachelor of Engineering (Civil and Environmental Engineering)": {
    "Year 1": ["MAT 1100","PHY 1010","BIO 1412","CHE 1000"],
    "Year 2": ["CEE 2219","EEE 2019","ENG 2129","ENG 2139","ENG 2159","MAT 2110","MEC 2009","MEC 2309"],
    "Year 3": ["CEE 3111","CEE 3211","GGY 3051","GEO 3522","CEE 3311","MAT 3110","CEE 3112","CEE 3222"],
    "Year 4": ["CEE 4511","CEE 4211","CEE 4311","GEO 4812","MAT 4119","CEE 4612","CEE 4412","ENG 4129","ENG 4143"],
    "Year 5": ["CEE 5211","CEE 5714","CEE 5311","CEE 5111","CEE 5222","ENG 5129","ENG 5143","CEE 5612","CEE 5122","CEE 5232","CEE 5412","CEE 5132","CEE 5242","CEE 5332"],
  },
  "Bachelor of Engineering (Electrical and Electronic Engineering)": {
    "Year 1": ["MAT 1100","PHY 1010","BIO 1412","CHE 1000"],
    "Year 2": ["CEE 2219","EEE 2019","ENG 2129","ENG 2139","ENG 2159","MAT 2110","MEC 2009","MEC 2309"],
    "Year 3": ["EEE 3112","EEE 3121","EEE 3131","EEE 3132","EEE 3352","EEE 3571","ENG 3165","MAT 3110"],
    "Year 4": ["EEE 4021","EEE 4221","EEE 4242","EEE 4352","EEE 4362","EEE 4571","EEE 4135","ENG 4129","ENG 4143","MAT 4119"],
    "Year 5": ["EEE 5014","EEE 5240","EEE 5351","EEE 5451","EEE 5362","ENG 5129","ENG 5143"],
  },
  "Bachelor of Engineering (Geomatic Engineering)": {
    "Year 1": ["MAT 1100","PHY 1010","BIO 1412","CHE 1000"],
    "Year 2": ["CEE 2219","EEE 2019","ENG 2129","ENG 2139","ENG 2159","MAT 2110","MEC 2009","MEC 2309"],
    "Year 3": ["MAT 3110","GEO 3711","GEO 3622","GEO 3222","GEO 3511","GEO 3522","CEE 3711"],
    "Year 4": ["MAT 4119","CEE 4612","GEO 4411","GEO 4311","GEO 4122","GEO 4622","GEO 4712","ENG 4129","ENG 4143"],
    "Year 5": ["GEO 5411","GEO 5610","GEO 5804","CEE 5111","GEO 5812","ENG 5129","ENG 5143"],
  },
  "Bachelor of Engineering (Mechanical Engineering)": {
    "Year 1": ["MAT 1100","PHY 1010","BIO 1412","CHE 1000"],
    "Year 2": ["CEE 2219","EEE 2019","ENG 2129","ENG 2139","ENG 2159","MAT 2110","MEC 2009","MEC 2309"],
    "Year 3": ["MEC 3001","MEC 3351","MEC 3401","CEE 3311","MAT 3111","MEC 3102","MEC 3352","MEC 3705","MAT 3112"],
    "Year 4": ["MEC 4105","MEC 4301","MEC 4601","MAT 4111","MEC 4055","MEC 4402","MEC 4702","ENG 4122","ENG 4143"],
    "Year 5": ["MEC 5051","MEC 5105","MEC 5401","MEC 5904","MEC 5205","ENG 5122","ENG 5143","MEC 5159","MEC 5355","MEC 5455","MEC 5465","MEC 5552","MEC 5702","MEC 5855"],
  },
};

const SOE_PROG_TO_DEPT = {
  "Bachelor of Engineering (Agricultural Engineering)":          "Agricultural Engineering",
  "Bachelor of Engineering (Civil and Environmental Engineering)":"Civil and Environmental Engineering",
  "Bachelor of Engineering (Electrical and Electronic Engineering)":"Electrical and Electronic Engineering",
  "Bachelor of Engineering (Geomatic Engineering)":              "Geomatic Engineering",
  "Bachelor of Engineering (Mechanical Engineering)":            "Mechanical Engineering",
};

// Sanitize comp number as Firestore document ID (slashes → underscores)
function sanitizeCompNo(v) {
  return String(v).trim().toUpperCase().replace(/\//g, "_");
}

// ── DOM refs ──────────────────────────────────────────────────────────────────
const stuList = document.getElementById("stuList");
const stuForm = document.getElementById("stuForm");
const stuErr  = document.getElementById("stuErr");
const stuBtn  = document.getElementById("stuBtn");

const execList = document.getElementById("execList");
const execForm = document.getElementById("execForm");
const execErr  = document.getElementById("execErr");
const execBtn  = document.getElementById("execBtn");

let adminUser, adminProfile;
let systemVerified = false; // cleared each page load — re-auth required per session

// ── Bootstrap ─────────────────────────────────────────────────────────────────
protect(["admin"], (user, profile) => {
  adminUser = user; adminProfile = profile;
  initSubHero(user, profile, { page: "admin", active: "tab-dash", tabs: adminTabs() });
  renderAdminDash();      // explicit render so the dashboard never relies on shOnTab timing
  loadStudents();         // preload for fast tab switch
  buildPositionOptions(); // populate exec form (cheap, no query)
  initBulkUpload();       // wires buttons (no query)
  document.getElementById("stuSearch").addEventListener("input", renderStudents);
  // Executives list and System settings load lazily when their tabs open.
});

let execsLoaded    = false;
let settingsLoaded = false;

// ── Tabs (driven by the sub-hero bar) ──────────────────────────────────────────
// Gate the System tab behind a password re-auth before it opens.
window.shGuardTab = (id) => {
  if (id === "tab-system" && !systemVerified) { showSystemVerify(); return false; }
  return true;
};
// Lazy-load each tab the first time it opens.
window.shOnTab = (id) => {
  if (id === "tab-dash") renderAdminDash();
  if (id === "tab-students" && !studsLoaded) { studsLoaded = true; /* already loaded in bootstrap */ }
  if (id === "tab-executives" && !execsLoaded) { execsLoaded = true; loadExecutives(); }
  if (id === "tab-system" && !settingsLoaded) { settingsLoaded = true; initSettings(); }
};

let studsLoaded = false;

function renderAdminDash() {
  const dc = document.getElementById("dashContent");
  if (!dc || dc.dataset.loaded) return;
  dc.dataset.loaded = "1";
  const greeting = getDashGreeting();
  dc.innerHTML = `
    <div style="margin-bottom:14px;background:var(--green);color:#fff;padding:22px 24px;border-radius:14px;box-shadow:0 4px 14px rgba(0,85,165,.15)">
      <div style="font-size:20px;font-weight:800;color:#fff">${greeting}, UZES Patron.</div>
      <div style="font-size:14px;margin-top:6px;color:#dbeafe">Patron &nbsp;·&nbsp; Here's your role overview.</div>
    </div>
    <div class="card" style="padding:20px 22px">
      <div style="font-size:15px;font-weight:700;margin-bottom:12px;color:var(--text)">What you can do</div>
      <ul style="margin:0;padding-left:18px;line-height:1.8;font-size:14px;color:var(--text)">
        <li>Manage student accounts — add, edit, delete, or import via CSV</li>
        <li>Manage executive accounts and assign positions</li>
        <li>Reset executive passwords and toggle account access</li>
        <li>Configure system settings — email relay, admin API secret, environment</li>
        <li>Run year-end reset to clear financial records and Cloudflare proofs</li>
        <li>View the audit log for sensitive admin actions</li>
      </ul>
    </div>`;
}

function getDashGreeting() {
  const h = new Date().getHours();
  if (h < 12) return "Good morning";
  if (h < 17) return "Good afternoon";
  return "Good evening";
}

// ── System tab 2FA (password re-auth) ─────────────────────────────────────────
function showSystemVerify() {
  const modal  = document.getElementById("sysVerifyModal");
  const pwInput = document.getElementById("sysVerifyPw");
  const errEl  = document.getElementById("sysVerifyErr");
  const form   = document.getElementById("sysVerifyForm");

  document.getElementById("sysVerifyEmail").value = adminUser.email;
  pwInput.value = ""; errEl.textContent = "";
  modal.style.display = "flex";
  setTimeout(() => pwInput.focus(), 60);

  async function handleVerify(e) {
    e.preventDefault();
    errEl.textContent = "";
    const btn = form.querySelector("button[type=submit]");
    btn.disabled = true; btn.textContent = "Verifying…";
    try {
      const cred = EmailAuthProvider.credential(adminUser.email, pwInput.value);
      await reauthenticateWithCredential(adminUser, cred);
      systemVerified = true;
      closeVerify();
      window.shShowTab("tab-system");
    } catch (err) {
      errEl.textContent =
        err.code === "auth/wrong-password" || err.code === "auth/invalid-credential"
          ? "Incorrect password." : err.message;
    } finally {
      btn.disabled = false; btn.textContent = "Verify";
    }
  }

  function closeVerify() {
    modal.style.display = "none";
    form.removeEventListener("submit", handleVerify);
  }

  form.addEventListener("submit", handleVerify);
  document.getElementById("sysVerifyCancel").onclick = closeVerify;
}

// ── Helpers ───────────────────────────────────────────────────────────────────
function badge(role) {
  const colors = { admin: "#8e44ad", executive: "#0b6b3a", student: "#2980b9" };
  return `<span class="badge" style="background:${colors[role]||'#555'}">${role}</span>`;
}
function statusDot(active) {
  return `<span class="dot" style="background:${active===false?'#c0392b':'#1e8a4c'}"></span>`;
}
function friendlyErr(err) {
  const map = {
    "auth/email-already-in-use": "That email already has an account.",
    "auth/invalid-email":        "Invalid email address.",
    "auth/weak-password":        "Password must be at least 6 characters."
  };
  return map[err.code] || err.message;
}

// ═══════════════════════════════════════════════════════════════════════════════
//  STUDENTS
// ═══════════════════════════════════════════════════════════════════════════════

let allStudents = [];

async function loadStudents() {
  stuList.innerHTML = "<p class='muted'>Loading…</p>";
  try {
    // New `students` collection + any not-yet-migrated students still in `users`.
    const [sSnap, uSnap] = await Promise.all([
      getDocs(collection(db, "students")),
      getDocs(collection(db, "users")),
    ]);
    const byId = {};
    sSnap.docs.forEach(d => { byId[d.id] = { id: d.id, __col: "students", ...d.data() }; });
    uSnap.docs.forEach(d => {
      if (d.data().role === "student" && !byId[d.id]) byId[d.id] = { id: d.id, __col: "users", ...d.data() };
    });
    allStudents = Object.values(byId).sort((a, b) => (a.name || "").localeCompare(b.name || ""));
    renderStudents();
  } catch (e) {
    stuList.innerHTML = `<p class='error'>Failed to load: ${e.message}</p>`;
  }
}

// Filters by name, computer number or email (live, as the admin types).
function renderStudents() {
  if (!allStudents.length) { stuList.innerHTML = "<p class='muted'>No student accounts yet.</p>"; return; }
  const box = document.getElementById("stuSearch");
  const q = (box ? box.value : "").trim().toLowerCase();
  const list = q
    ? allStudents.filter(u =>
        (u.name || "").toLowerCase().includes(q) ||
        (u.compNumber || "").toLowerCase().includes(q) ||
        (u.email || "").toLowerCase().includes(q))
    : allStudents;
  if (!list.length) { stuList.innerHTML = `<p class='muted'>No students match "${esc(q)}".</p>`; return; }
  stuList.innerHTML = list.map(u => studentRowHTML(u.id, u)).join("");
}

function studentRowHTML(id, u) {
  const eid = esc(id), ecol = esc(u.__col || "students");
  return `<div class="user-row" data-id="${eid}">
    ${statusDot(u.active)} ${badge(u.role)}
    <div>
      <div class="user-name">${esc(u.name) || "—"}</div>
      <div class="user-meta">
        ${esc(u.compNumber) || "—"} · ${esc(u.yearOfStudy) || "—"} · ${esc(u.gender) || "—"}
      </div>
      <div class="user-meta">${esc(u.department) || "—"} · ${esc(u.email)}</div>
    </div>
    <div class="row-actions">
      <button class="btn-sm" onclick="editStu('${eid}','${ecol}')">Edit</button>
      <button class="btn-sm" onclick="toggleActive('${eid}','${ecol}',${u.active!==false})">
        ${u.active===false ? "Enable" : "Disable"}
      </button>
      <button class="btn-sm danger" onclick="resetPw('${esc(u.email)}')">Reset PW</button>
      <button class="btn-sm danger" onclick="deleteStu('${eid}','${ecol}','${esc(u.name||"")}')">Delete</button>
    </div>
  </div>`;
}

stuForm.addEventListener("submit", async (e) => {
  e.preventDefault();
  stuErr.textContent = "";
  stuBtn.disabled = true; stuBtn.textContent = "Saving…";

  const editingId  = stuForm.dataset.editing;
  const name        = stuForm.stuName.value.trim();
  const compNumber  = stuForm.compNumber.value.trim().toUpperCase();
  const gender      = stuForm.stuGender.value;
  const yearOfStudy = stuForm.stuYear.value;
  const department  = stuForm.stuDept.value;

  try {
    if (editingId) {
      const col   = stuForm.dataset.editingCol || "students";
      const email = stuForm.stuEmail.value.trim();
      await updateDoc(doc(db, col, editingId), { name, compNumber, gender, yearOfStudy, department, email });
      await setDoc(doc(db, "compIndex", sanitizeCompNo(compNumber)), { email, uid: editingId });
      clearStuForm();
    } else {
      const email    = stuForm.stuEmail.value.trim();
      const password = stuForm.stuPassword.value;
      await createAccount(email, password, async (uid) => {
        await setDoc(doc(db, "students", uid), {
          role: "student", name, compNumber, email, gender, yearOfStudy, department,
          active: true, createdAt: serverTimestamp(), createdBy: adminUser.uid
        });
        await setDoc(doc(db, "compIndex", sanitizeCompNo(compNumber)), { email, uid });
      });
      stuForm.reset();
    }
    await loadStudents();
  } catch (err) {
    stuErr.textContent = friendlyErr(err);
  } finally {
    stuBtn.disabled = false;
    stuBtn.textContent = stuForm.dataset.editing ? "Save changes" : "Create student account";
  }
});

window.editStu = async (uid, col) => {
  col = col || "students";
  const snap = await getDoc(doc(db, col, uid));
  if (!snap.exists()) return;
  const u = snap.data();
  stuForm.stuName.value    = u.name        || "";
  stuForm.compNumber.value = u.compNumber  || "";
  stuForm.stuGender.value  = u.gender      || "";
  stuForm.stuYear.value    = u.yearOfStudy || "";
  stuForm.stuDept.value    = u.department  || "";
  stuForm.stuEmail.value    = u.email || "";
  stuForm.stuEmail.disabled = false;
  stuForm.stuEmail.required = true;
  // Hide password — can't change via client SDK; use Reset PW instead
  document.getElementById("stuPasswordWrap").style.display = "none";
  stuForm.stuPassword.required = false;
  stuForm.dataset.editing = uid;
  stuForm.dataset.editingCol = col;
  stuBtn.textContent = "Save changes";
  document.getElementById("stuCancel").style.display  = "";
  document.getElementById("stuFormHead").textContent  = "Edit student account";
  stuForm.scrollIntoView({ behavior: "smooth" });
};

function clearStuForm() {
  stuForm.reset();
  delete stuForm.dataset.editing;
  delete stuForm.dataset.editingCol;
  stuForm.stuEmail.disabled = false;
  stuForm.stuEmail.required = true;
  document.getElementById("stuPasswordWrap").style.display = "";
  stuForm.stuPassword.required = true;
  stuBtn.textContent = "Create student account";
  document.getElementById("stuCancel").style.display  = "none";
  document.getElementById("stuFormHead").textContent  = "Add student account";
  stuErr.textContent = "";
}
document.getElementById("stuCancel").addEventListener("click", clearStuForm);

// ═══════════════════════════════════════════════════════════════════════════════
//  EXECUTIVES
// ═══════════════════════════════════════════════════════════════════════════════

function buildPositionOptions() {
  const sel = document.getElementById("execPosition");
  sel.innerHTML = POSITIONS.map(p => `<option value="${p}">${p}</option>`).join("");
}

async function loadExecutives() {
  execList.innerHTML = "<p class='muted'>Loading…</p>";
  try {
    // New `executives` collection + any not-yet-migrated execs still in `users`.
    const [eSnap, uSnap] = await Promise.all([
      getDocs(collection(db, "executives")),
      getDocs(collection(db, "users")),
    ]);
    const byId = {};
    eSnap.docs.forEach(d => {
      if (d.data().role === "executive") byId[d.id] = { id: d.id, __col: "executives", ...d.data() };
    });
    uSnap.docs.forEach(d => {
      if (d.data().role === "executive" && !byId[d.id]) byId[d.id] = { id: d.id, __col: "users", ...d.data() };
    });
    const execs = Object.values(byId).sort((a, b) => (a.name || "").localeCompare(b.name || ""));
    if (!execs.length) { execList.innerHTML = "<p class='muted'>No executive accounts yet.</p>"; return; }
    execList.innerHTML = execs.map(u => execRowHTML(u.id, u)).join("");
  } catch (e) {
    execList.innerHTML = `<p class='error'>Failed to load: ${e.message}</p>`;
  }
}

function execRowHTML(id, u) {
  const eid = esc(id), ecol = esc(u.__col || "executives");
  return `<div class="user-row" data-id="${eid}">
    ${statusDot(u.active)} ${badge(u.role)}
    <div>
      <div class="user-name">${esc(u.name) || "—"}</div>
      <div class="user-meta">${esc(u.position) || "No position"} · ${esc(u.email)}</div>
    </div>
    <div class="row-actions">
      <button class="btn-sm" onclick="editExec('${eid}','${ecol}')">Edit</button>
      <button class="btn-sm" onclick="toggleActive('${eid}','${ecol}',${u.active!==false})">
        ${u.active===false ? "Enable" : "Disable"}
      </button>
      <button class="btn-sm danger" onclick="resetPw('${esc(u.email)}')">Reset PW</button>
      <button class="btn-sm danger" onclick="deleteExec('${eid}','${ecol}','${esc(u.name||"")}')">Delete</button>
    </div>
  </div>`;
}

execForm.addEventListener("submit", async (e) => {
  e.preventDefault();
  execErr.textContent = "";
  execBtn.disabled = true; execBtn.textContent = "Saving…";
  const editingId = execForm.dataset.editing;
  const name      = execForm.execName.value.trim();
  const position  = execForm.execPosition.value;

  try {
    if (editingId) {
      const col = execForm.dataset.editingCol || "executives";
      await updateDoc(doc(db, col, editingId), { name, position });
      clearExecForm();
    } else {
      const email    = execForm.execEmail.value.trim();
      const password = execForm.execPassword.value;
      await createAccount(email, password, async (uid) => {
        await setDoc(doc(db, "executives", uid), {
          role: "executive", name, position, email,
          active: true, createdAt: serverTimestamp(), createdBy: adminUser.uid
        });
      });
      execForm.reset();
    }
    await loadExecutives();
  } catch (err) {
    execErr.textContent = friendlyErr(err);
  } finally {
    execBtn.disabled = false;
    // Read dataset.editing AFTER clearExecForm() may have deleted it
    execBtn.textContent = execForm.dataset.editing ? "Save changes" : "Create executive account";
  }
});

window.editExec = async (uid, col) => {
  col = col || "executives";
  const snap = await getDoc(doc(db, col, uid));
  if (!snap.exists()) return;
  const u = snap.data();
  execForm.execName.value     = u.name     || "";
  execForm.execPosition.value = u.position || POSITIONS[0];
  // Show email as read-only
  execForm.execEmail.value    = u.email || "";
  execForm.execEmail.disabled = true;
  execForm.execEmail.required = false;
  // Hide password
  document.getElementById("execPasswordWrap").style.display = "none";
  execForm.execPassword.required = false;
  execForm.dataset.editing = uid;
  execForm.dataset.editingCol = col;
  execBtn.textContent = "Save changes";
  document.getElementById("execCancel").style.display  = "";
  document.getElementById("execFormHead").textContent  = "Edit executive account";
  execForm.scrollIntoView({ behavior: "smooth" });
};

function clearExecForm() {
  execForm.reset();
  delete execForm.dataset.editing;
  delete execForm.dataset.editingCol;
  execForm.execEmail.disabled = false;
  execForm.execEmail.required = true;
  document.getElementById("execPasswordWrap").style.display = "";
  execForm.execPassword.required = true;
  execBtn.textContent = "Create executive account";
  document.getElementById("execCancel").style.display  = "none";
  document.getElementById("execFormHead").textContent  = "Add executive account";
  execErr.textContent = "";
}
document.getElementById("execCancel").addEventListener("click", clearExecForm);

// ═══════════════════════════════════════════════════════════════════════════════
//  SHARED GLOBAL HELPERS (inline onclick)
// ═══════════════════════════════════════════════════════════════════════════════

window.toggleActive = async (uid, col, currentlyActive) => {
  if (!confirm(`${currentlyActive ? "Disable" : "Enable"} this account?`)) return;
  await updateDoc(doc(db, col || "users", uid), { active: !currentlyActive });
  loadStudents();
  if (execsLoaded) loadExecutives();
};

window.resetPw = async (email) => {
  if (!confirm(`Send a password reset email to ${email}?`)) return;
  try {
    await sendPasswordResetEmail(auth, email, {
      url: "https://uzes-friendly-web.web.app/"
    });
    alert("Password reset email sent to " + email + ".\n\nIf it doesn't arrive within a few minutes, ask the user to check their spam/junk folder.");
  } catch (e) { alert("Failed: " + e.message); }
};

window.deleteStu = async (uid, col, name) => {
  col = col || "students";
  if (!confirm(`Permanently delete student "${name}"?\n\nThis removes their profile and login account. Payment records are kept for the financial archive.`)) return;
  try {
    const snap = await getDoc(doc(db, col, uid));
    const compNo = snap.data()?.compNumber;
    await deleteDoc(doc(db, col, uid));
    if (compNo) await deleteDoc(doc(db, "compIndex", sanitizeCompNo(compNo)));
    deleteFirebaseAuthUser(uid); // best-effort — runs after Firestore is already clean
    audit("student_deleted", { targetUid: uid, col });
    await loadStudents();
  } catch (e) { alert("Delete failed: " + e.message); }
};

window.deleteExec = async (uid, col, name) => {
  col = col || "executives";
  if (!confirm(`Permanently delete executive "${name}"?\n\nThis removes their profile, signature, any About page listing (including photos in Cloudflare), and their login account.`)) return;
  try {
    const snap = await getDoc(doc(db, col, uid));
    const u = snap.data() || {};
    const r2ToDelete = [];
    if (u.signatureUrl) r2ToDelete.push(u.signatureUrl);

    // Remove any public exec profile(s) created for this person — matched by
    // email when available, otherwise by name (case-insensitive).
    const uname  = (u.name || name || "").trim().toLowerCase();
    const uemail = (u.email || "").trim().toLowerCase();
    const profSnap = await getDocs(collection(db, "execProfiles"));
    const matches = profSnap.docs.filter(d => {
      const p = d.data();
      const pemail = (p.email || "").trim().toLowerCase();
      const pname  = (p.name  || "").trim().toLowerCase();
      return (uemail && pemail && pemail === uemail) || (uname && pname && pname === uname);
    });
    for (const d of matches) {
      if (d.data().photoUrl) r2ToDelete.push(d.data().photoUrl);
      await deleteDoc(d.ref);
    }

    await deleteDoc(doc(db, col, uid));
    if (r2ToDelete.length) deleteUpload(r2ToDelete); // best-effort R2 cleanup
    deleteFirebaseAuthUser(uid); // best-effort — runs after Firestore is already clean
    audit("exec_deleted", { targetUid: uid, col });
    await loadExecutives();
  } catch (e) { alert("Delete failed: " + e.message); }
};

// ═══════════════════════════════════════════════════════════════════════════════
//  BULK UPLOAD
// ═══════════════════════════════════════════════════════════════════════════════

const VALID_DEPTS   = new Set(DEPARTMENTS);
const VALID_GENDERS = new Set(["Male", "Female"]);
const VALID_YEARS   = new Set(YEAR_OPTIONS);

function initBulkUpload() {
  document.getElementById("bulkBtn").addEventListener("click", async () => {
    const file = document.getElementById("bulkFile").files[0];
    if (!file) { alert("Please select a CSV or Excel file first."); return; }
    document.getElementById("bulkBtn").disabled = true;
    try { await processBulkFile(file); }
    finally { document.getElementById("bulkBtn").disabled = false; }
  });

  document.getElementById("templateBtn").addEventListener("click", () => {
    const header  = "Name,Email,Comp#,Password,Gender,Year,Department";
    const example = '"Chanda Mwale","chanda@example.com","23/0012345/01","changeme123","Male","2nd Year","Electrical and Electronic Engineering"';
    const blob = new Blob([header + "\n" + example], { type: "text/csv" });
    const a = Object.assign(document.createElement("a"), {
      href: URL.createObjectURL(blob), download: "UZES_Students_Template.csv"
    });
    a.click(); URL.revokeObjectURL(a.href);
  });

  document.getElementById("updateYearBtn").addEventListener("click", async () => {
    if (!confirm("Open a one-time year-of-study edit window for all students?\n\nEach student will be able to update their year once, then it locks again. This cannot be undone until the next time you press this button.")) return;
    const btn = document.getElementById("updateYearBtn");
    btn.disabled = true; btn.textContent = "Activating…";
    try {
      await setDoc(doc(db, "siteSettings", "yearUpdate"), {
        active: true,
        startedAt: serverTimestamp()
      });
      alert("Year update activated. Students can now update their year of study once from their dashboard.");
    } catch (e) {
      alert("Failed to activate: " + e.message);
    } finally {
      btn.disabled = false; btn.textContent = "Update Year";
    }
  });
}

function normaliseHeader(h) {
  const k = String(h).toLowerCase().replace(/[^a-z]/g, "");
  if (k === "name")                                                    return "name";
  if (k === "email")                                                   return "email";
  if (["comp","compno","compnumber","computernumber",
       "registrationnumber","regno"].includes(k))                      return "compNumber";
  if (k === "password")                                                return "password";
  if (k === "gender")                                                  return "gender";
  if (["year","yearofstudy","studyyear"].includes(k))                  return "yearOfStudy";
  if (["department","dept"].includes(k))                               return "department";
  return null;
}

function normaliseYear(v) {
  const s = String(v).trim();
  const numMap = { "1":"1st Year","2":"2nd Year","3":"3rd Year","4":"4th Year","5":"5th Year" };
  return numMap[s] || s;
}

async function processBulkFile(file) {
  document.getElementById("bulkProgress").style.display = "";
  document.getElementById("bulkLog").innerHTML = "";
  document.getElementById("bulkBar").style.width = "0%";
  document.getElementById("bulkStatus").textContent = "Parsing file…";

  let rows = [];
  try {
    if (file.name.toLowerCase().endsWith(".csv")) {
      rows = parseCSV(await file.text());
    } else {
      const buf = await file.arrayBuffer();
      const wb  = window.XLSX.read(buf, { type: "array" });
      const ws  = wb.Sheets[wb.SheetNames[0]];
      const raw = window.XLSX.utils.sheet_to_json(ws, { header: 1 });
      if (raw.length < 2) { showBulkError("File appears empty."); return; }
      const headers = raw[0].map(normaliseHeader);
      rows = raw.slice(1)
        .filter(r => r.some(c => c !== undefined && c !== ""))
        .map(row => {
          const obj = {};
          headers.forEach((h, i) => { if (h) obj[h] = String(row[i] ?? "").trim(); });
          return obj;
        });
    }
  } catch (err) { showBulkError("Failed to parse file: " + err.message); return; }

  if (!rows.length) { showBulkError("No data rows found."); return; }

  const required = ["name","email","compNumber","password","gender","yearOfStudy","department"];
  const missing  = required.filter(k => !(k in rows[0]));
  if (missing.length) {
    showBulkError(`Missing columns: ${missing.join(", ")}. Check your file headers.`); return;
  }

  const total = rows.length;
  let succeeded = 0, failed = 0, skipped = 0;
  const log = [];

  for (let i = 0; i < rows.length; i++) {
    const r = rows[i];
    r.yearOfStudy = normaliseYear(r.yearOfStudy);
    const label = `Row ${i + 2}: ${r.name || "?"} (${r.compNumber || "?"})`;

    const errs = [];
    if (!r.name)                           errs.push("Name missing");
    if (!r.email || !r.email.includes("@")) errs.push("Invalid email");
    if (!r.compNumber)                     errs.push("Comp# missing");
    if (!r.password || r.password.length < 6) errs.push("Password must be ≥6 characters");
    if (!VALID_GENDERS.has(r.gender))      errs.push(`Gender "${r.gender}" must be Male or Female`);
    if (!VALID_YEARS.has(r.yearOfStudy))   errs.push(`Year "${r.yearOfStudy}" — valid values: ${YEAR_OPTIONS.join(", ")}`);
    if (!VALID_DEPTS.has(r.department))    errs.push(`Department "${r.department}" doesn't match valid options`);

    if (errs.length) {
      log.push({ ok: false, label, msg: errs.join("; ") }); failed++;
      updateBulkProgress(i + 1, total, succeeded, failed); continue;
    }

    try {
      // Skip if student number already registered (prevents duplicates on re-import)
      const existing = await getDoc(doc(db, "compIndex", sanitizeCompNo(r.compNumber)));
      if (existing.exists()) {
        log.push({ ok: true, label, msg: "Skipped — student number already registered" }); skipped++;
        updateBulkProgress(i + 1, total, succeeded, failed); continue;
      }
      await createAccount(r.email, r.password, async (uid) => {
        await setDoc(doc(db, "students", uid), {
          role: "student", name: r.name, compNumber: r.compNumber.toUpperCase(),
          email: r.email, gender: r.gender, yearOfStudy: r.yearOfStudy, department: r.department,
          active: true, createdAt: serverTimestamp(), createdBy: adminUser.uid
        });
        await setDoc(doc(db, "compIndex", sanitizeCompNo(r.compNumber)), {
          email: r.email, uid
        });
      });
      log.push({ ok: true, label, msg: "Created successfully" }); succeeded++;
    } catch (err) {
      log.push({ ok: false, label, msg: friendlyErr(err) }); failed++;
    }

    updateBulkProgress(i + 1, total, succeeded, failed);
    await new Promise(resolve => setTimeout(resolve, 250));
  }

  document.getElementById("bulkLog").innerHTML =
    `<p style="font-weight:600;margin-bottom:8px">Results: ${succeeded} created, ${skipped} skipped, ${failed} failed</p>` +
    log.map(l =>
      `<div class="bulk-log-row">
        <span>${l.ok ? "✅" : "❌"}</span>
        <span><strong>${l.label}</strong> — ${l.msg}</span>
      </div>`
    ).join("");

  await loadStudents();
}

function updateBulkProgress(done, total, succeeded, failed) {
  document.getElementById("bulkBar").style.width = Math.round(done / total * 100) + "%";
  document.getElementById("bulkStatus").textContent =
    `${done}/${total} processed — ${succeeded} created, ${failed} failed`;
}
function showBulkError(msg) {
  document.getElementById("bulkLog").innerHTML = `<p class="error">${msg}</p>`;
  document.getElementById("bulkProgress").style.display = "none";
}

function parseCSV(text) {
  const lines = text.split(/\r?\n/);
  if (!lines.length) return [];
  const headers = parseCSVLine(lines[0]).map(normaliseHeader);
  const rows = [];
  for (let i = 1; i < lines.length; i++) {
    if (!lines[i].trim()) continue;
    const vals = parseCSVLine(lines[i]);
    const row  = {};
    headers.forEach((h, j) => { if (h) row[h] = (vals[j] || "").trim(); });
    rows.push(row);
  }
  return rows;
}

// ═══════════════════════════════════════════════════════════════════════════════
//  SYSTEM SETTINGS
// ═══════════════════════════════════════════════════════════════════════════════

async function initSettings() {
  const form    = document.getElementById("settingsForm");
  const trialCb = document.getElementById("trialMode");
  const errEl   = document.getElementById("settingsErr");
  const okEl    = document.getElementById("settingsOk");

  // Load trial mode flag from Firestore (URL/token are now Worker env vars)
  try {
    const snap = await getDoc(doc(db, "settings", "emailRelay"));
    if (snap.exists()) trialCb.checked = snap.data().isTrial === true;
  } catch (_) {}

  form.addEventListener("submit", async (e) => {
    e.preventDefault();
    errEl.textContent = ""; okEl.textContent = "";
    const btn = form.querySelector("button[type=submit]");
    btn.disabled = true; btn.textContent = "Saving…";
    try {
      await setDoc(doc(db, "settings", "emailRelay"), {
        isTrial: trialCb.checked
      }, { merge: true });
      okEl.textContent = "Settings saved.";
    } catch (err) {
      errEl.textContent = "Failed: " + err.message;
    } finally {
      btn.disabled = false; btn.textContent = "Save settings";
    }
  });

  document.getElementById("resetYearBtn").addEventListener("click", runYearReset);
  document.getElementById("seedLibraryBtn").addEventListener("click", seedLibraryCourses);
  initSecretaryCard();

  // Admin API tokens (for Firebase Auth deletion and password reset)
  try {
    const apiSnap = await getDoc(doc(db, "settings", "adminApi"));
    if (apiSnap.exists()) {
      document.getElementById("adminDeleteToken").value = apiSnap.data().deleteToken || "";
      document.getElementById("adminResetToken").value  = apiSnap.data().resetToken  || "";
    }
  } catch (_) {}

  // ── Test the admin secret against the Worker (no destructive action) ──
  const testBtn = document.getElementById("testAdminApiBtn");
  if (testBtn) {
    testBtn.addEventListener("click", async () => {
      const result = document.getElementById("testAdminApiResult");
      const token = document.getElementById("adminDeleteToken").value.trim();
      if (!token) {
        result.style.color = "var(--danger)";
        result.textContent = "Enter a secret first.";
        return;
      }
      result.style.color = "var(--muted)";
      result.textContent = "Testing…";
      try {
        const res = await fetch(UPLOAD_WORKER_URL + "/admin/test-secret", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ token }),
        });
        const data = await res.json().catch(() => ({}));
        if (res.ok && data.ok) {
          result.style.color = "var(--ok)";
          result.textContent = "✓ Secret matches the Worker. Firebase Auth deletion will work.";
        } else if (res.status === 401) {
          result.style.color = "var(--danger)";
          result.textContent = "✗ Secret does NOT match. Update ADMIN_DELETE_SECRET in the Cloudflare Worker dashboard, or paste the correct secret here.";
        } else {
          result.style.color = "var(--danger)";
          result.textContent = "✗ Test failed: " + (data.error || res.status);
        }
      } catch (err) {
        result.style.color = "var(--danger)";
        result.textContent = "✗ Could not reach the Worker: " + err.message;
      }
    });
  }

  document.getElementById("saveAdminApiBtn").addEventListener("click", async () => {
    const errEl = document.getElementById("adminApiErr");
    const okEl  = document.getElementById("adminApiOk");
    const btn   = document.getElementById("saveAdminApiBtn");
    errEl.textContent = ""; okEl.textContent = "";
    btn.disabled = true; btn.textContent = "Saving…";
    try {
      const deleteToken = document.getElementById("adminDeleteToken").value.trim();
      const resetToken  = document.getElementById("adminResetToken").value.trim();
      await setDoc(doc(db, "settings", "adminApi"), { deleteToken, resetToken }, { merge: true });
      _adminDeleteToken = deleteToken;
      _adminResetToken  = resetToken;
      okEl.textContent = "Saved.";
    } catch (err) {
      errEl.textContent = "Failed: " + err.message;
    } finally {
      btn.disabled = false; btn.textContent = "Save";
    }
  });
}

// ═══════════════════════════════════════════════════════════════════════════════
//  ACADEMIC YEAR RESET  (archive → clear financials → delete proofs)
// ═══════════════════════════════════════════════════════════════════════════════

function fmtTs(ts) {
  return ts?.toDate ? ts.toDate().toLocaleString("en-ZM") : "";
}

// Build a multi-sheet .xlsx workbook from the financial records → returns a File.
function buildArchiveWorkbook(payments, incomes, expenses) {
  const XLSX = window.XLSX;

  const payRows = [["Date submitted","Receipt#","Student","Comp#","Category",
    "Amount (K)","Method","Ref/Line","Status","Confirmed by","Confirmed at","Notes"]];
  payments.forEach(p => payRows.push([
    fmtTs(p.submittedAt), p.receiptNo ? String(p.receiptNo).padStart(4,"0") : "",
    p.studentName||"", p.compNumber||"", p.category||"", Number(p.amount||0),
    p.method||"", p.txRef||"", p.status||"", p.reviewerName||"", fmtTs(p.reviewedAt), p.notes||""
  ]));

  const incRows = [["Date","Source","Category","Amount (K)","Notes","Added by"]];
  incomes.forEach(r => incRows.push([
    r.date || fmtTs(r.addedAt), r.source||"", r.category||"", Number(r.amount||0),
    r.notes||"", r.addedByName||r.addedBy||""
  ]));

  const expRows = [["Date","Purpose","Amount (K)","Status","Requested by","Notes"]];
  expenses.forEach(e => expRows.push([
    fmtTs(e.requestedAt), e.purpose||"", Number(e.amount||0), e.status||"",
    e.requestedByName||e.requestedBy||"", e.notes||""
  ]));

  const confirmed = payments.filter(p => p.status === "confirmed");
  const payTotal  = confirmed.reduce((s,p)=>s+(p.amount||0),0);
  const incTotal  = incomes.reduce((s,r)=>s+(r.amount||0),0);
  const expTotal  = expenses.filter(e=>e.status==="approved").reduce((s,e)=>s+(e.amount||0),0);
  const sumRows = [
    ["UZES Financial Archive"],
    ["Generated", new Date().toLocaleString("en-ZM")],
    [],
    ["Confirmed student payments (K)", payTotal],
    ["Other income (K)", incTotal],
    ["Total income (K)", payTotal + incTotal],
    ["Approved expenses (K)", expTotal],
    ["Net balance (K)", payTotal + incTotal - expTotal],
    [],
    ["Payment records", payments.length],
    ["Other income records", incomes.length],
    ["Expense records", expenses.length],
  ];

  const wb = XLSX.utils.book_new();
  XLSX.utils.book_append_sheet(wb, XLSX.utils.aoa_to_sheet(sumRows), "Summary");
  XLSX.utils.book_append_sheet(wb, XLSX.utils.aoa_to_sheet(payRows), "Payments");
  XLSX.utils.book_append_sheet(wb, XLSX.utils.aoa_to_sheet(incRows), "Other Income");
  XLSX.utils.book_append_sheet(wb, XLSX.utils.aoa_to_sheet(expRows), "Expenses");

  const out  = XLSX.write(wb, { bookType: "xlsx", type: "array" });
  const blob = new Blob([out], { type: "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet" });
  const name = `UZES_Archive_${new Date().toISOString().slice(0,10)}.xlsx`;
  return new File([blob], name, { type: blob.type });
}

async function runYearReset() {
  const statusEl = document.getElementById("resetStatus");
  const errEl    = document.getElementById("resetErr");
  const btn      = document.getElementById("resetYearBtn");
  errEl.textContent = ""; statusEl.textContent = "";

  const phrase = prompt(
    "This PERMANENTLY clears all financial records and payment proofs after archiving " +
    "them to Cloudflare.\n\nType  RESET  (capitals) to confirm:"
  );
  if (phrase === null) return;
  if (phrase.trim() !== "RESET") { alert("Reset cancelled — you didn't type RESET."); return; }

  btn.disabled = true;
  try {
    statusEl.textContent = "Loading financial records…";
    const [paySnap, incSnap, expSnap] = await Promise.all([
      getDocs(collection(db, "payments")),
      getDocs(collection(db, "otherIncome")),
      getDocs(collection(db, "expenses")),
    ]);
    const payments = paySnap.docs.map(d => ({ id: d.id, ...d.data() }));
    const incomes  = incSnap.docs.map(d => ({ id: d.id, ...d.data() }));
    const expenses = expSnap.docs.map(d => ({ id: d.id, ...d.data() }));

    if (!payments.length && !incomes.length && !expenses.length) {
      statusEl.textContent = "";
      alert("There are no financial records to reset.");
      btn.disabled = false;
      return;
    }

    // 1) Build the Excel archive
    statusEl.textContent = "Building Excel archive…";
    const file = buildArchiveWorkbook(payments, incomes, expenses);

    // 2) Upload it to Cloudflare FIRST. If this fails we stop — nothing is deleted.
    statusEl.textContent = "Uploading archive to Cloudflare…";
    const archiveUrl = await uploadArchive(file, "Archive");

    // 3) Delete ALL proof files from R2 by clearing the whole uzes-proofs/ folder.
    //    (Prefix delete is more reliable than per-URL — it leaves no orphans.)
    statusEl.textContent = "Deleting payment proofs from Cloudflare…";
    const proofsDeleted = await deleteUploadPrefix("uzes-proofs/", await getAdminDeleteToken());

    // 4) Clear all financial docs from Firestore
    statusEl.textContent = "Clearing financial records…";
    await Promise.all([
      ...paySnap.docs.map(d => deleteDoc(d.ref)),
      ...incSnap.docs.map(d => deleteDoc(d.ref)),
      ...expSnap.docs.map(d => deleteDoc(d.ref)),
    ]);

    audit("year_reset", { payments: payments.length, incomes: incomes.length, expenses: expenses.length, proofsDeleted });

    statusEl.innerHTML =
      `✅ Reset complete — archived ${payments.length} payment(s), ${incomes.length} income and ` +
      `${expenses.length} expense record(s); deleted ${proofsDeleted} proof file(s) from Cloudflare. ` +
      `<a href="${archiveUrl}" target="_blank" rel="noopener">Download the Excel archive</a>`;
    alert("Academic year reset complete.\n\nThe Excel archive is saved in Cloudflare (Archive folder). " +
          "All financial records and payment proofs have been cleared.");
  } catch (e) {
    errEl.textContent = "Reset failed: " + e.message + " — no records were deleted if the archive step failed.";
  } finally {
    btn.disabled = false;
  }
}

// ═══════════════════════════════════════════════════════════════════════════════
//  LIBRARY — seed course catalogue
// ═══════════════════════════════════════════════════════════════════════════════

async function seedLibraryCourses() {
  const statusEl = document.getElementById("seedLibraryStatus");
  const btn      = document.getElementById("seedLibraryBtn");
  statusEl.textContent = "";
  btn.disabled = true; btn.textContent = "Seeding…";

  try {
    // 1) delete all existing docs in the collection
    statusEl.textContent = "Clearing existing courses…";
    const existingSnap = await getDocs(collection(db, "libraryCourses"));
    const DEL_BATCH_SIZE = 400;
    for (let i = 0; i < existingSnap.docs.length; i += DEL_BATCH_SIZE) {
      const batch = writeBatch(db);
      existingSnap.docs.slice(i, i + DEL_BATCH_SIZE).forEach(d => batch.delete(d.ref));
      await batch.commit();
    }

    // 2) build all course records
    statusEl.textContent = "Writing new courses…";
    const YEAR_NUMS = { "Year 1":"1st Year","Year 2":"2nd Year","Year 3":"3rd Year","Year 4":"4th Year","Year 5":"5th Year" };
    const records = [];
    for (const [progFull, yearMap] of Object.entries(SOE_COURSES)) {
      const dept = SOE_PROG_TO_DEPT[progFull];
      for (const [yearKey, codes] of Object.entries(yearMap)) {
        const yearLabel = YEAR_NUMS[yearKey] || yearKey;
        for (const code of codes) {
          const slug = (code + "_" + dept.slice(0,4) + "_" + yearKey.replace(" ","")).replace(/\s+/g,"_");
          records.push({
            courseCode:  code,
            courseName:  code,
            programme:   progFull,
            department:  dept,
            year:        yearLabel,
            slug:        slug,
            school:      "School of Engineering",
          });
        }
      }
    }

    // 3) write in batches of 490 (Firestore limit is 500)
    const WRITE_BATCH_SIZE = 490;
    for (let i = 0; i < records.length; i += WRITE_BATCH_SIZE) {
      const batch = writeBatch(db);
      records.slice(i, i + WRITE_BATCH_SIZE).forEach(r => {
        const ref = doc(collection(db, "libraryCourses"));
        batch.set(ref, r);
      });
      await batch.commit();
    }

    statusEl.style.color = "var(--ok, #1a7f4b)";
    statusEl.textContent = `✅ Done — seeded ${records.length} course entries.`;
  } catch (e) {
    statusEl.style.color = "var(--err, #c0392b)";
    statusEl.textContent = "Failed: " + e.message;
  } finally {
    btn.disabled = false; btn.textContent = "Seed library courses";
  }
}

function parseCSVLine(line) {
  const result = [];
  let cur = "", inQ = false;
  for (const c of line) {
    if (c === '"') { inQ = !inQ; continue; }
    if (c === "," && !inQ) { result.push(cur); cur = ""; continue; }
    cur += c;
  }
  result.push(cur);
  return result;
}

// ═══════════════════════════════════════════════════════════════════════════════
//  INDUSTRIAL TRAINING SECRETARY — dedicated lecturer account management
// ═══════════════════════════════════════════════════════════════════════════════
async function initSecretaryCard() {
  const statusEl = document.getElementById("secAccountStatus");

  // Find existing secretary account
  let existing = null;
  try {
    const snap = await getDocs(query(
      collection(db, "executives"),
      where("position", "==", "Industrial Training Secretary")
    ));
    if (!snap.empty) existing = { id: snap.docs[0].id, ...snap.docs[0].data() };
  } catch (err) {
    statusEl.innerHTML = `<p class="error">Failed to load: ${err.message}</p>`;
    return;
  }

  if (existing) {
    renderSecretaryExists(existing, statusEl);
  } else {
    renderSecretaryCreate(statusEl);
  }
}

function renderSecretaryExists(sec, statusEl) {
  const activeLabel = sec.active === false
    ? '<span style="color:var(--danger);font-weight:700">Disabled</span>'
    : '<span style="color:var(--ok);font-weight:700">Active</span>';

  statusEl.innerHTML = `
    <div style="display:flex;flex-direction:column;gap:6px;font-size:13px;margin-bottom:14px">
      <div><span class="muted small" style="text-transform:uppercase;letter-spacing:.4px;font-weight:700">Name</span><br>${esc(sec.name || "—")}</div>
      <div><span class="muted small" style="text-transform:uppercase;letter-spacing:.4px;font-weight:700">Email</span><br>${esc(sec.email || "—")}</div>
      <div><span class="muted small" style="text-transform:uppercase;letter-spacing:.4px;font-weight:700">Status</span><br>${activeLabel}</div>
    </div>
    <div style="display:flex;gap:8px;flex-wrap:wrap;align-items:center">
      <button id="secToggleBtn" class="btn-sm ${sec.active === false ? "" : "danger"}"
        onclick="toggleSecretary('${sec.id}', ${sec.active !== false})">
        ${sec.active === false ? "Reactivate account" : "Disable account"}
      </button>
      <button class="btn-sm" onclick="showSecPwReset('${sec.id}')">Reset password</button>
    </div>
    <div id="secPwResetForm" style="display:none;margin-top:12px;max-width:320px">
      <label for="secNewPw" style="font-size:13px">New password</label>
      <input id="secNewPw" type="password" placeholder="Min 6 characters" style="margin-bottom:8px">
      <div style="display:flex;gap:8px;align-items:center;flex-wrap:wrap">
        <button class="btn-primary" style="width:auto;padding:8px 18px;margin-top:0" onclick="doSecPwReset('${sec.id}')">Set password</button>
        <button class="btn-ghost" style="font-size:12px;margin-top:0" onclick="document.getElementById('secPwResetForm').style.display='none'">Cancel</button>
        <p id="secPwResetMsg" style="font-size:12px;margin:0"></p>
      </div>
    </div>
    <p id="secToggleMsg" style="font-size:12px;margin-top:8px;min-height:14px"></p>`;
}

function renderSecretaryCreate(statusEl) {
  statusEl.innerHTML = `
    <p class="muted small" style="margin-bottom:12px">No secretary account found. Create one below.</p>
    <form id="secCreateForm" style="max-width:400px" autocomplete="off">
      <label for="secCName">Full name</label>
      <input id="secCName" required placeholder="e.g. Dr. Mwale B." style="margin-bottom:10px">
      <label for="secCEmail">Email address</label>
      <input id="secCEmail" type="email" required placeholder="e.g. attachment@unza.zm" style="margin-bottom:10px">
      <label for="secCPw">Temporary password</label>
      <input id="secCPw" type="password" required placeholder="Min 6 characters" minlength="6" style="margin-bottom:10px">
      <p id="secCreateErr" class="error" style="margin-bottom:6px"></p>
      <button type="submit" id="secCreateBtn" class="btn-primary" style="width:auto;padding:10px 22px;margin-top:0">
        Create secretary account
      </button>
    </form>`;

  document.getElementById("secCreateForm").addEventListener("submit", async e => {
    e.preventDefault();
    const errEl = document.getElementById("secCreateErr");
    const btn   = document.getElementById("secCreateBtn");
    errEl.textContent = ""; btn.disabled = true; btn.textContent = "Creating…";
    const name  = document.getElementById("secCName").value.trim();
    const email = document.getElementById("secCEmail").value.trim();
    const pw    = document.getElementById("secCPw").value;
    try {
      await createAccount(email, pw, async uid => {
        await setDoc(doc(db, "executives", uid), {
          name, email,
          role: "executive",
          position: "Industrial Training Secretary",
          active: true,
          createdAt: serverTimestamp(),
          createdBy: adminUser.uid
        });
      });
      // Reload card to show existing state
      await initSecretaryCard();
    } catch (err) {
      errEl.textContent = err.message;
      btn.disabled = false; btn.textContent = "Create secretary account";
    }
  });
}

function esc(s) { return String(s ?? "").replace(/&/g,"&amp;").replace(/</g,"&lt;").replace(/>/g,"&gt;").replace(/"/g,"&quot;"); }

window.toggleSecretary = async (id, currentlyActive) => {
  const btn = document.getElementById("secToggleBtn");
  const msg = document.getElementById("secToggleMsg");
  btn.disabled = true;
  try {
    await updateDoc(doc(db, "executives", id), { active: !currentlyActive });
    msg.style.color = "var(--ok)";
    msg.textContent = currentlyActive ? "Account disabled." : "Account reactivated.";
    setTimeout(() => initSecretaryCard(), 1200);
  } catch (err) {
    msg.style.color = "var(--danger)"; msg.textContent = err.message;
    btn.disabled = false;
  }
};

window.showSecPwReset = () => {
  document.getElementById("secPwResetForm").style.display = "";
  document.getElementById("secNewPw").focus();
};

window.doSecPwReset = async id => {
  const pw  = document.getElementById("secNewPw").value;
  const msg = document.getElementById("secPwResetMsg");
  if (pw.length < 6) { msg.style.color = "var(--danger)"; msg.textContent = "Min 6 characters."; return; }
  msg.style.color = "var(--muted)"; msg.textContent = "Saving…";
  try {
    // Use the Worker admin endpoint to update the password
    const token = await getAdminResetToken();
    const resp = await fetch(UPLOAD_WORKER_URL + "/admin/reset-password", {
      method: "POST", headers: { "Content-Type": "application/json", ...await authHeaders() },
      body: JSON.stringify({ uid: id, newPassword: pw, secret: token })
    });
    if (!resp.ok) throw new Error("Worker returned " + resp.status + " — password reset via Firebase Console instead");
    msg.style.color = "var(--ok)"; msg.textContent = "Password updated.";
    document.getElementById("secPwResetForm").style.display = "none";
    document.getElementById("secNewPw").value = "";
  } catch (err) {
    msg.style.color = "var(--danger)"; msg.textContent = err.message;
  }
};
