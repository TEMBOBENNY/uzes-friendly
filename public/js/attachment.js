import { db } from "./firebase.js";
import { protect } from "./guard.js";
import { initSubHero } from "./subhero.js?v=4";
import { studentTabs } from "./nav.js";
import {
  collection, doc, getDoc, getDocs, addDoc,
  query, where, orderBy, serverTimestamp
} from "https://www.gstatic.com/firebasejs/10.12.2/firebase-firestore.js";

let _user, _profile;

const states = ["attLoading","attGateUnpaid","attSessionClosed","attPending","attApproved","attFormSection","attSuccess"];
function show(id) { states.forEach(s => { const el = document.getElementById(s); if (el) el.style.display = s === id ? "" : "none"; }); }

// ── Exported init (called from student.js when Attachment tab first opens) ────
export async function initAttachment(user, profile) {
  _user = user; _profile = profile;

  // Membership check
  try {
    const memSnap = await getDocs(query(
      collection(db, "payments"),
      where("studentUid", "==", user.uid),
      where("category", "==", "Membership Dues"),
      where("status", "==", "confirmed")
    ));
    if (memSnap.empty) { show("attGateUnpaid"); return; }
  } catch (_) { show("attGateUnpaid"); return; }

  // Session settings
  let settings = {};
  try {
    const snap = await getDoc(doc(db, "attachmentSettings", "main"));
    if (snap.exists()) settings = snap.data();
  } catch (_) {}

  if (!settings.sessionOpen) {
    const el = id => document.getElementById(id);
    el("closedSecName").textContent  = settings.secretaryName  || "Industrial Training Secretary";
    const emailEl = el("closedSecEmail");
    emailEl.textContent = settings.secretaryEmail || "—";
    if (settings.secretaryEmail) emailEl.href = `mailto:${settings.secretaryEmail}`;
    el("closedSecPhone").textContent = settings.secretaryPhone || "—";
    show("attSessionClosed");
    return;
  }

  // Check for existing request from this student
  let existingStatus = null;
  try {
    const reqSnap = await getDocs(query(
      collection(db, "attachmentRequests"),
      where("studentUid", "==", user.uid)
    ));
    if (!reqSnap.empty) {
      const sorted = reqSnap.docs.slice().sort((a, b) =>
        (b.data().submittedAt?.seconds ?? 0) - (a.data().submittedAt?.seconds ?? 0)
      );
      existingStatus = sorted[0].data().status;
    }
  } catch (_) {}

  if (existingStatus === "pending")  { show("attPending");  return; }
  if (existingStatus === "approved") { show("attApproved"); return; }

  // Load custom placeholders
  let placeholders = [];
  try {
    const phSnap = await getDocs(query(collection(db, "attachmentPlaceholders"), orderBy("order")));
    phSnap.forEach(d => placeholders.push({ id: d.id, ...d.data() }));
  } catch (_) {}

  buildForm(profile, user, placeholders, settings);
  show("attFormSection");
}

// ── Standalone bootstrap: only runs when opening attachment.html directly ─────
if (location.pathname.includes("attachment.html")) {
  protect(["student"], async (user, profile) => {
    initSubHero(user, profile, { page: "attachment", active: "attach", tabs: studentTabs("attachment") });
    await initAttachment(user, profile);
  });
}

function buildForm(profile, user, placeholders, settings) {
  document.getElementById("af-name").value  = profile.name || "";
  document.getElementById("af-comp").value  = profile.compNumber || "";
  document.getElementById("af-dept").value  = profile.department || "";
  document.getElementById("af-year").value  = profile.yearOfStudy || "";
  document.getElementById("af-email").value = user.email || "";
  document.getElementById("af-phone").value = profile.phone || "";

  // Lock fields the student cannot change — admin updates these via CSV upload
  ["af-name","af-comp","af-dept","af-year","af-email"].forEach(id => {
    const el = document.getElementById(id);
    if (el) { el.readOnly = true; el.classList.add("readonly-field"); }
  });

  const customEl = document.getElementById("af-custom-fields");
  if (placeholders.length) {
    customEl.innerHTML = `<p class="req-section">Additional details requested by the secretary</p>
      <div class="form-grid-2">${placeholders.map(p => `
        <div${p.fullWidth ? ' class="full"' : ''}>
          <label for="afc-${p.id}">${esc(p.label)}${p.required ? ' <span class="muted small">*</span>' : ''}</label>
          <input id="afc-${p.id}" data-key="${esc(p.key)}" ${p.required ? "required" : ""} placeholder="${esc(p.label)}">
        </div>`).join("")}
      </div>`;
  }

  document.getElementById("attForm").addEventListener("submit", async e => {
    e.preventDefault();
    const errEl = document.getElementById("attErr");
    const okEl  = document.getElementById("attOk");
    const btn   = document.getElementById("attSubmitBtn");
    errEl.textContent = ""; okEl.textContent = "";

    const studentName = document.getElementById("af-name").value.trim();
    const compNumber  = document.getElementById("af-comp").value.trim();
    const department  = document.getElementById("af-dept").value.trim();
    const yearOfStudy = document.getElementById("af-year").value.trim();
    const phone       = document.getElementById("af-phone").value.trim();

    if (!studentName) { errEl.textContent = "Please enter your full name."; return; }
    if (!compNumber)  { errEl.textContent = "Please enter your computer/registration number."; return; }
    if (!department)  { errEl.textContent = "Please enter your department."; return; }
    if (!yearOfStudy) { errEl.textContent = "Please enter your year of study."; return; }
    if (!phone)       { errEl.textContent = "Please enter your phone number."; return; }

    // Collect custom placeholder values
    const customFields = {};
    placeholders.forEach(p => {
      const el = document.getElementById(`afc-${p.id}`);
      if (el) customFields[p.key] = el.value.trim();
    });

    btn.disabled = true; btn.textContent = "Submitting…";
    try {
      await addDoc(collection(db, "attachmentRequests"), {
        studentUid:   _user.uid,
        studentName,
        studentEmail: _user.email || "",
        compNumber,
        gender:       _profile.gender || "",
        department,
        yearOfStudy,
        phone,
        customFields,
        status:       "pending",
        submittedAt:  serverTimestamp()
      });
      show("attSuccess");
    } catch (err) {
      errEl.textContent = "Failed to submit: " + err.message;
      btn.disabled = false; btn.textContent = "Submit request";
    }
  });
}

function esc(s) {
  return String(s ?? "")
    .replace(/&/g,"&amp;").replace(/</g,"&lt;")
    .replace(/>/g,"&gt;").replace(/"/g,"&quot;");
}
