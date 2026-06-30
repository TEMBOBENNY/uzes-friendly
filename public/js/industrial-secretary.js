import { db } from "./firebase.js";
import { protect } from "./guard.js";
import { sendPush } from "./fcm.js";
import { initSubHero } from "./subhero.js?v=4";
import { secretaryTabs } from "./nav.js";
import { UPLOAD_WORKER_URL } from "./config.js";
import { authHeaders } from "./upload.js";
import {
  collection, doc, getDoc, getDocs, setDoc, addDoc, updateDoc, deleteDoc,
  query, where, orderBy, serverTimestamp, writeBatch
} from "https://www.gstatic.com/firebasejs/10.12.2/firebase-firestore.js";

// Event delegation for all dynamically-generated action buttons
document.addEventListener("click", e => {
  const el = e.target.closest("[data-action^='is:']");
  if (!el) return;
  const d = el.dataset;
  switch (d.action) {
    case "is:approve":          window.doApprove(d.id, true); break;
    case "is:preview-letter":   window.previewLetter(d.id); break;
    case "is:show-reject":      window.showRejectForm(d.id); break;
    case "is:do-reject":        window.doReject(d.id); break;
    case "is:hide-reject":      window.hideRejectForm(d.id); break;
    case "is:del-ph":           window.deletePh(d.id); break;
    case "is:del-placement-ph": window.deletePlacementPh(d.id); break;
    case "is:assign":           window.assignVacancy(d.id); break;
    case "is:del-vacancy":      window.deleteVacancy(d.id); break;
    case "is:ts-approve":       window.approvePlacement(d.uid); break;
    case "is:ts-reject":        window.rejectPlacementNopenalty(d.uid); break;
  }
});

const DEPARTMENTS = [
  "Electrical and Electronic Engineering",
  "Mechanical Engineering",
  "Civil and Environmental Engineering",
  "Computer Science and Engineering",
  "Chemical Engineering and Food Technology",
  "Agricultural Engineering",
  "Survey Engineering",
];

let _user, _profile;
let _relayConfig = null;

// ── Dashboard ─────────────────────────────────────────────────────────────────
function getDashGreeting() {
  const h = new Date().getHours();
  if (h < 12) return "Good morning";
  if (h < 17) return "Good afternoon";
  return "Good evening";
}

function renderTSDash() {
  const dc = document.getElementById("dashContent");
  if (!dc) return;
  dc.dataset.loaded = "1";
  const name = _profile?.name || _user?.email || "Secretary";
  dc.innerHTML = `
    <div style="margin-bottom:14px;background:var(--green);color:#fff;padding:22px 24px;border-radius:14px;box-shadow:0 4px 14px rgba(0,85,165,.15)">
      <div style="font-size:20px;font-weight:800;color:#fff">${getDashGreeting()}, ${esc(name)}.</div>
      <div style="font-size:14px;margin-top:6px;color:#dbeafe">Industrial Training Secretary &nbsp;·&nbsp; Here's your role overview.</div>
    </div>
    <div class="card" style="padding:20px 22px;margin-bottom:12px">
      <div style="font-size:15px;font-weight:700;margin-bottom:12px;color:var(--text)">Industrial Training Secretary duties</div>
      <ul style="margin:0;padding-left:18px;line-height:1.8;font-size:14px;color:var(--text)">
        <li>Open and close the attachment / internship application session</li>
        <li>Review and approve pending attachment letter requests</li>
        <li>Approve or reject student placement confirmations (manual mode)</li>
        <li>Manage the placement letter template and custom placeholders</li>
        <li>Track all confirmed placements and reset student records when needed</li>
      </ul>
    </div>
    <div class="card" style="padding:20px 22px">
      <div style="font-size:15px;font-weight:700;margin-bottom:12px;color:var(--text)">Account</div>
      <ul style="margin:0;padding-left:18px;line-height:1.8;font-size:14px;color:var(--text)">
        <li>Update your profile signature used on generated placement letters</li>
        <li>Change your account password</li>
      </ul>
    </div>`;
}

// ── Shared ────────────────────────────────────────────────────────────────────
function esc(s) {
  return String(s ?? "")
    .replace(/&/g,"&amp;").replace(/</g,"&lt;")
    .replace(/>/g,"&gt;").replace(/"/g,"&quot;");
}

async function getRelay() {
  if (_relayConfig) return _relayConfig;
  try {
    const s = await getDoc(doc(db, "settings", "emailRelay"));
    _relayConfig = s.exists() ? s.data() : {};
  } catch (_) { _relayConfig = {}; }
  return _relayConfig;
}

async function sendEmail(payload) {
  try {
    const res = await fetch(UPLOAD_WORKER_URL + "/email", {
      method: "POST",
      headers: { "Content-Type": "application/json", ...(await authHeaders()) },
      body: JSON.stringify(payload)
    });
    const data = await res.json().catch(() => ({}));
    if (!res.ok) throw new Error(data.error || "Email failed");
  } catch (err) {
    console.error("Email send failed:", err.message);
  }
}

// ── Bootstrap ─────────────────────────────────────────────────────────────────
protect(["executive", "admin"], async (user, profile) => {
  if (profile.role === "executive" && profile.position !== "Industrial Training Secretary") {
    location.replace("executive.html"); return;
  }
  _user = user; _profile = profile;


  initSubHero(user, profile, { page: "secretary", active: "tab-dash", tabs: secretaryTabs() });
  renderTSDash();   // explicit render so the dashboard never relies on shOnTab timing

  await initSession();
});

// Lazy-load each tab the first time the sub-hero reveals it.
const loaded = new Set();
window.shOnTab = (id) => {
  // Dashboard re-renders cheaply on every visit — no guard needed
  if (id === "tab-dash") { renderTSDash(); return; }
  if (loaded.has(id)) return;
  loaded.add(id);
  if (id === "tab-pending") {
    loadPending();
    // Eagerly load placements so data is ready when the sub-tab is clicked
    loadTSReview();
    // Wire the Letter Requests | Placements sub-tabs
    const pendTabs   = document.querySelectorAll('#tab-pending .ses-tab');
    const pendPanels = document.querySelectorAll('#tab-pending .ses-panel');
    pendTabs.forEach(btn => {
      btn.addEventListener('click', () => {
        const target = btn.dataset.ses;
        pendTabs.forEach(t   => t.classList.toggle('active', t.dataset.ses === target));
        pendPanels.forEach(p => p.classList.toggle('hidden', p.id !== target));
        if (target === 'pend-placements') loadTSReview();
      });
    });
  }
  if (id === "tab-approved")     loadApproved();
  if (id === "tab-confirmed")    loadConfirmedPlacements();
  if (id === "tab-template")     loadTemplate();
  if (id === "tab-placeholders") loadPlaceholders();
};

// ── Session Control ───────────────────────────────────────────────────────────
async function initSession() {
  let settings = {};
  try {
    const snap = await getDoc(doc(db, "attachmentSettings", "main"));
    if (snap.exists()) settings = snap.data();
  } catch (_) {}

  const toggle    = document.getElementById("sessionToggle");
  const statusTxt = document.getElementById("sessionStatusText");
  const toggleMsg = document.getElementById("sessionToggleMsg");

  const applyToggleUI = () => {
    const open = !!settings.sessionOpen;
    toggle.checked        = open;
    statusTxt.textContent = open ? "Open — students can submit requests" : "Closed";
  };
  applyToggleUI();

  toggle.addEventListener("change", async () => {
    const open = toggle.checked;
    statusTxt.textContent = "Saving…";
    toggle.disabled = true;
    try {
      await setDoc(doc(db, "attachmentSettings", "main"), {
        sessionOpen:     open,
        sessionOpen2to4: false,
        sessionOpen5th:  false
      }, { merge: true });
      settings.sessionOpen = open;
      applyToggleUI();
      toggleMsg.textContent = open ? "Session opened." : "Session closed.";
      setTimeout(() => { toggleMsg.textContent = ""; }, 3000);
    } catch (err) {
      toggle.checked = !open;
      applyToggleUI();
      toggleMsg.style.color = "#c0392b";
      toggleMsg.textContent = "Failed: " + err.message;
    } finally {
      toggle.disabled = false;
    }
  });

  // Contact details
  document.getElementById("secName").value  = settings.secretaryName  || "";
  document.getElementById("secEmail").value = settings.secretaryEmail || "";
  document.getElementById("secPhone").value = settings.secretaryPhone || "";

  document.getElementById("secSettingsForm").addEventListener("submit", async e => {
    e.preventDefault();
    const errEl = document.getElementById("secSettingsErr");
    const okEl  = document.getElementById("secSettingsOk");
    const btn   = document.getElementById("secSettingsBtn");
    errEl.textContent = ""; okEl.textContent = "";
    btn.disabled = true; btn.textContent = "Saving…";
    try {
      const data = {
        secretaryName:  document.getElementById("secName").value.trim(),
        secretaryEmail: document.getElementById("secEmail").value.trim(),
        secretaryPhone: document.getElementById("secPhone").value.trim(),
        updatedAt:      serverTimestamp(),
        updatedBy:      _user.uid
      };
      await setDoc(doc(db, "attachmentSettings", "main"), data, { merge: true });
      Object.assign(settings, data);
      okEl.textContent = "Settings saved.";
      setTimeout(() => { okEl.textContent = ""; }, 3000);
    } catch (err) {
      errEl.textContent = err.message;
    } finally {
      btn.disabled = false; btn.textContent = "Save settings";
    }
  });

  // Training period (start + end date)
  if (settings.sessionStartDate) document.getElementById("sessionStartDate").value = settings.sessionStartDate;
  if (settings.sessionEndDate)   document.getElementById("sessionEndDate").value   = settings.sessionEndDate;
  document.getElementById("saveStartDateBtn").addEventListener("click", async () => {
    const msg   = document.getElementById("startDateMsg");
    const start = document.getElementById("sessionStartDate").value;
    const end   = document.getElementById("sessionEndDate").value;
    msg.textContent = "Saving…"; msg.style.color = "var(--muted)";
    try {
      await setDoc(doc(db, "attachmentSettings", "main"),
        { sessionStartDate: start, sessionEndDate: end }, { merge: true });
      settings.sessionStartDate = start;
      settings.sessionEndDate   = end;
      msg.style.color = "var(--ok)"; msg.textContent = "Dates saved.";
      setTimeout(() => { msg.textContent = ""; msg.style.color = ""; }, 3000);
    } catch (err) {
      msg.style.color = "var(--danger)"; msg.textContent = err.message;
    }
  });

  // Placement vacancy management — lazy-load when Placements sub-tab is clicked
  let _placementLoaded = false;
  function initPlacementSubTab() {
    if (_placementLoaded) return;
    _placementLoaded = true;
    initDeptSlotsGrid();
    loadVacancies();
    // loadTSReview() is now in the Pending Requests tab (second section)
  }

  // Session sub-tabs
  const sesTabs = document.querySelectorAll('.ses-tab');
  const sesPanels = document.querySelectorAll('.ses-panel');
  sesTabs.forEach(btn => {
    btn.addEventListener('click', () => {
      const target = btn.dataset.ses;
      sesTabs.forEach(t => t.classList.toggle('active', t.dataset.ses === target));
      sesPanels.forEach(p => p.classList.toggle('hidden', p.id !== target));
      if (target === 'ses-placement') initPlacementSubTab();
    });
  });

  document.getElementById("addVacancyForm").addEventListener("submit", async e => {
    e.preventDefault();
    const errEl = document.getElementById("addVacancyErr");
    const btn   = document.getElementById("addVacancyBtn");
    const msg   = document.getElementById("addVacancyMsg");
    errEl.textContent = ""; msg.textContent = "";

    const province = document.getElementById("vacProvince").value;
    if (!province) { errEl.textContent = "Select a province."; return; }
    const district = document.getElementById("vacDistrict").value.trim();
    if (!district) { errEl.textContent = "Enter a district."; return; }

    const departmentsRequired = {};
    const slotsRemaining = {};
    document.querySelectorAll("#deptSlotsGrid input[data-dept]").forEach(input => {
      const slots = parseInt(input.value, 10) || 0;
      if (slots > 0) {
        const dept = input.dataset.dept;
        departmentsRequired[dept] = slots;
        slotsRemaining[dept]      = slots;
      }
    });
    if (Object.keys(departmentsRequired).length === 0) {
      errEl.textContent = "Enter at least one department slot."; return;
    }

    btn.disabled = true; btn.textContent = "Adding…";
    try {
      await addDoc(collection(db, "vacancies"), {
        companyName:          document.getElementById("vacCompany").value.trim(),
        type:                 document.getElementById("vacType").value,
        province,
        district,
        genderPreference:     document.getElementById("vacGender").value,
        acceptMode:           document.getElementById("vacAcceptMode").value,
        startDate:            document.getElementById("vacStartDate").value || "",
        endDate:              document.getElementById("vacEndDate").value   || "",
        departmentsRequired,
        slotsRemaining,
        status:               "open",
        createdAt:            serverTimestamp(),
        createdBy:            _user.uid
      });
      e.target.reset();
      initDeptSlotsGrid();
      msg.textContent = "Vacancy added.";
      setTimeout(() => { msg.textContent = ""; }, 3000);
      loadVacancies();
    } catch (err) {
      errEl.textContent = err.message;
    } finally {
      btn.disabled = false; btn.textContent = "Add vacancy";
    }
  });
}

// ── Pending Requests ──────────────────────────────────────────────────────────
async function loadPending() {
  const list = document.getElementById("pendingList");
  list.innerHTML = "<p class='muted'>Loading…</p>";
  try {
    const snap = await getDocs(query(
      collection(db, "attachmentRequests"),
      where("status", "==", "pending")
    ));
    if (snap.empty) { list.innerHTML = "<p class='muted'>No pending requests.</p>"; return; }
    const docs = snap.docs.slice().sort((a, b) => {
      const ta = a.data().submittedAt?.seconds ?? 0;
      const tb = b.data().submittedAt?.seconds ?? 0;
      return ta - tb;
    });
    list.innerHTML = docs.map(d => renderReqCard(d.id, d.data(), "pending")).join("");
  } catch (err) {
    list.innerHTML = `<p class='error'>Failed to load: ${err.message}</p>`;
  }

  document.getElementById("approveAllBtn").onclick = async () => {
    const msg = document.getElementById("approveAllMsg");
    if (!confirm("Approve ALL pending requests and send letters?")) return;
    msg.textContent = "Processing…"; msg.style.color = "var(--muted)";
    const cards = document.querySelectorAll("#pendingList .req-card");
    let count = 0;
    for (const card of cards) {
      const id = card.dataset.reqId;
      if (id) { await doApprove(id, false); count++; }
    }
    await loadPending();
    msg.style.color = "var(--ok)"; msg.textContent = `Approved ${count} request(s).`;
    setTimeout(() => { msg.textContent = ""; }, 4000);
  };
}

function renderReqCard(id, r, mode) {
  const date = r.submittedAt?.toDate().toLocaleDateString("en-ZM", { day:"2-digit", month:"short", year:"numeric" }) || "—";
  const customHtml = r.customFields && Object.keys(r.customFields).length
    ? Object.entries(r.customFields).map(([k, v]) =>
        `<div class="req-field"><span class="req-field-lbl">${esc(k)}</span><span>${esc(v)}</span></div>`).join("")
    : "";

  const statusColor = { pending:"#e67e22", approved:"#1e8a4c", rejected:"#c0392b" }[r.status] || "#555";

  const actions = mode === "pending" ? `
    <div class="req-actions">
      <div id="ra-btns-${id}" style="display:flex;gap:8px;flex-wrap:wrap;align-items:center">
        <button class="btn-approve" data-action="is:approve" data-id="${id}" id="ra-app-${id}">Approve &amp; send letter</button>
        <button class="btn-ghost" style="font-size:12px;padding:7px 14px" data-action="is:preview-letter" data-id="${id}">Preview letter</button>
        <button class="btn-reject-sm" data-action="is:show-reject" data-id="${id}">Reject</button>
      </div>
      <div id="ra-rej-${id}" style="display:none;width:100%" class="reject-form">
        <input class="reject-input" id="rej-reason-${id}" placeholder="Reason for rejection…">
        <button class="btn-reject-confirm" data-action="is:do-reject" data-id="${id}">Send rejection</button>
        <button class="btn-ghost" style="font-size:12px;padding:6px 10px" data-action="is:hide-reject" data-id="${id}">Cancel</button>
      </div>
      <p id="ra-err-${id}" class="action-err"></p>
    </div>` : `
    <div class="req-actions">
      <button class="btn-ghost" style="font-size:12px;padding:7px 14px" data-action="is:preview-letter" data-id="${id}">View letter</button>
    </div>`;

  return `<div class="req-card" id="req-card-${id}" data-req-id="${id}">
    <div class="req-card-head">
      <div>
        <div class="req-name">${esc(r.studentName)}</div>
        <div class="req-meta">
          <span>${esc(r.compNumber)} · ${esc(r.department)} · ${esc(r.yearOfStudy)}</span>
          <span>${esc(r.studentEmail)} · ${esc(r.phone)}</span>
          <span>Submitted: ${date}</span>
        </div>
      </div>
      <span class="status-pill" style="background:${statusColor}">${r.status.toUpperCase()}</span>
    </div>
    <div class="req-fields">
      ${customHtml || '<span class="muted small">No additional fields</span>'}
    </div>
    ${actions}
  </div>`;
}

window.showRejectForm = id => {
  document.getElementById(`ra-btns-${id}`).style.display = "none";
  document.getElementById(`ra-rej-${id}`).style.display  = "flex";
};
window.hideRejectForm = id => {
  document.getElementById(`ra-btns-${id}`).style.display = "flex";
  document.getElementById(`ra-rej-${id}`).style.display  = "none";
};

window.previewLetter = async id => {
  const errEl = document.getElementById(`ra-err-${id}`);
  try {
    const [reqSnap, settSnap] = await Promise.all([
      getDoc(doc(db, "attachmentRequests", id)),
      getDoc(doc(db, "attachmentSettings", "main"))
    ]);
    if (!reqSnap.exists()) { if (errEl) errEl.textContent = "Request not found."; return; }
    previewRequestFields(reqSnap.data(), settSnap.exists() ? settSnap.data() : {});
  } catch (err) {
    if (errEl) errEl.textContent = "Preview failed: " + err.message;
    else alert("Preview failed: " + err.message);
  }
};

window.doApprove = async (id, removeCard = true) => {
  const errEl = document.getElementById(`ra-err-${id}`);
  const btn   = document.getElementById(`ra-app-${id}`);
  if (errEl) errEl.textContent = "";
  if (btn)   { btn.disabled = true; btn.textContent = "Approving…"; }
  try {
    const reqSnap = await getDoc(doc(db, "attachmentRequests", id));
    if (!reqSnap.exists()) throw new Error("Request not found");
    const r = reqSnap.data();
    const settSnap = await getDoc(doc(db, "attachmentSettings", "main"));
    const settings = settSnap.exists() ? settSnap.data() : {};

    previewRequestFields(r, settings);

    await updateDoc(doc(db, "attachmentRequests", id), {
      status: "approved", reviewedAt: serverTimestamp(), reviewedBy: _user.uid
    });

    // Pick the right Google Doc template based on the student's year of study.
    const is5th = /\b5(th)?\b/i.test(r.yearOfStudy || "");
    const templateDocUrl = is5th
      ? (settings.templateDocUrl5th   || "")
      : (settings.templateDocUrl2to4  || "");

    await sendEmail({
      type:           "attachment_letter",
      to:             r.studentEmail,
      studentName:    r.studentName    || "",
      compNumber:     r.compNumber     || "",
      gender:         r.gender         || "",
      department:     r.department     || "",
      yearOfStudy:    r.yearOfStudy    || "",
      phone:          r.phone          || "",
      customFields:   r.customFields   || {},
      startDate:      settings.sessionStartDate || "",
      endDate:        settings.sessionEndDate   || "",
      secretaryName:  settings.secretaryName    || "",
      secretaryEmail: settings.secretaryEmail   || "",
      secretaryPhone: settings.secretaryPhone   || "",
      secretarySignatureB64: settings.secretarySignatureB64 || "",
      templateDocUrl
    });

    if (r.studentUid) {
      getDoc(doc(db, "students", r.studentUid)).then(snap => {
        const tok = snap.data()?.fcmToken;
        if (tok) sendPush(tok, "Letter Approved", "Your attachment letter has been approved! Check your email for the letter.");
      }).catch(() => {});
    }
    if (removeCard) document.getElementById(`req-card-${id}`)?.remove();
    checkPendingEmpty();
  } catch (err) {
    if (errEl) { errEl.textContent = "Error: " + err.message; }
    if (btn)   { btn.disabled = false; btn.textContent = "Approve & send letter"; }
  }
};

window.doReject = async id => {
  const reason = document.getElementById(`rej-reason-${id}`)?.value.trim();
  const errEl  = document.getElementById(`ra-err-${id}`);
  if (!reason) { if (errEl) errEl.textContent = "Enter a rejection reason."; return; }
  if (errEl) errEl.textContent = "";
  try {
    const [reqSnap, settSnap] = await Promise.all([
      getDoc(doc(db, "attachmentRequests", id)),
      getDoc(doc(db, "attachmentSettings", "main"))
    ]);
    const r    = reqSnap.exists()  ? reqSnap.data()  : {};
    const sett = settSnap.exists() ? settSnap.data() : {};
    await updateDoc(doc(db, "attachmentRequests", id), {
      status: "rejected", rejectionReason: reason,
      reviewedAt: serverTimestamp(), reviewedBy: _user.uid
    });
    await sendEmail({
      type:           "attachment_rejection",
      to:             r.studentEmail,
      studentName:    r.studentName,
      secretaryName:  sett.secretaryName  || "",
      secretaryEmail: sett.secretaryEmail || "",
      reason
    });
    if (r.studentUid) {
      getDoc(doc(db, "students", r.studentUid)).then(snap => {
        const tok = snap.data()?.fcmToken;
        if (tok) sendPush(tok, "Letter Not Approved", "Your attachment letter request was reviewed. Please check your dashboard for details.");
      }).catch(() => {});
    }
    document.getElementById(`req-card-${id}`)?.remove();
    checkPendingEmpty();
  } catch (err) {
    if (errEl) errEl.textContent = "Error: " + err.message;
  }
};

function checkPendingEmpty() {
  const list = document.getElementById("pendingList");
  if (list && !list.querySelector(".req-card")) {
    list.innerHTML = "<p class='muted'>No pending requests.</p>";
  }
}

// ── Approved / History ────────────────────────────────────────────────────────
async function loadApproved() {
  const list = document.getElementById("approvedList");
  list.innerHTML = "<p class='muted'>Loading…</p>";
  try {
    const snap = await getDocs(query(
      collection(db, "attachmentRequests"),
      where("status", "in", ["approved","rejected"])
    ));
    if (snap.empty) { list.innerHTML = "<p class='muted'>No history yet.</p>"; return; }
    const docs = snap.docs.slice().sort((a, b) => {
      const ta = a.data().reviewedAt?.seconds ?? 0;
      const tb = b.data().reviewedAt?.seconds ?? 0;
      return tb - ta;
    });
    list.innerHTML = docs.map(d => renderReqCard(d.id, d.data(), "history")).join("");
  } catch (err) {
    list.innerHTML = `<p class='error'>Failed to load: ${err.message}</p>`;
  }

  document.getElementById("resetApprovedBtn").onclick = async () => {
    if (!confirm("Delete ALL requests (pending, approved, rejected)? Students will be able to resubmit. This cannot be undone.")) return;
    const msg = document.getElementById("resetMsg");
    msg.textContent = "Deleting…"; msg.style.color = "var(--muted)";
    try {
      const snap = await getDocs(collection(db, "attachmentRequests"));
      const batch = writeBatch(db);
      snap.docs.forEach(d => batch.delete(d.ref));
      await batch.commit();
      list.innerHTML = "<p class='muted'>No history yet.</p>";
      msg.style.color = "var(--ok)"; msg.textContent = "History cleared — students can now resubmit.";
      setTimeout(() => { msg.textContent = ""; }, 4000);
    } catch (err) {
      msg.style.color = "var(--danger)"; msg.textContent = err.message;
    }
  };
}

// ── Confirmed Placements ──────────────────────────────────────────────────────
async function loadConfirmedPlacements() {
  const list = document.getElementById("confirmedPlacementList");
  if (!list) return;
  list.innerHTML = "<p class='muted'>Loading…</p>";

  const resetBtn = document.getElementById("resetConfirmedBtn");
  if (resetBtn) {
    resetBtn.onclick = async () => {
      if (!confirm("Reset ALL confirmed placements back to pending?\n\nThis clears all matches so the algorithm can re-run. This cannot be undone.")) return;
      const msg = document.getElementById("resetConfirmedMsg");
      msg.textContent = "Resetting…"; msg.style.color = "var(--muted)";
      try {
        const snap = await getDocs(query(collection(db, "placements"), where("placementStatus", "==", "confirmed")));
        const batch = writeBatch(db);
        snap.docs.forEach(d => batch.update(d.ref, {
          placementStatus: "pending",
          matchedCompanyId: null, matchedAt: null,
          approvalMethod: null, tsReviewerId: null,
          tsReviewerName: null, approvedAt: null
        }));
        await batch.commit();
        list.innerHTML = "<p class='muted'>No confirmed placements yet.</p>";
        msg.style.color = "var(--ok)"; msg.textContent = "All placements reset to pending.";
        setTimeout(() => { msg.textContent = ""; }, 4000);
      } catch (err) {
        msg.style.color = "var(--danger)"; msg.textContent = err.message;
      }
    };
  }
  try {
    const snap = await getDocs(
      query(collection(db, "placements"), where("placementStatus", "==", "confirmed"))
    );
    if (snap.empty) {
      list.innerHTML = "<p class='muted'>No confirmed placements yet.</p>";
      return;
    }
    const docs = snap.docs.slice().sort((a, b) => {
      const ta = a.data().approvedAt?.seconds ?? 0;
      const tb = b.data().approvedAt?.seconds ?? 0;
      return tb - ta;
    });

    // Batch-load unique vacancies
    const vacancyIds = [...new Set(docs.map(d => d.data().matchedCompanyId).filter(Boolean))];
    const vacancyMap = {};
    await Promise.all(vacancyIds.map(async id => {
      const v = await getDoc(doc(db, "vacancies", id));
      if (v.exists()) vacancyMap[id] = v.data();
    }));

    const cards = await Promise.all(docs.map(async d => {
      const p = d.data();
      const uid = d.id;
      let student = {};
      try {
        const s = await getDoc(doc(db, "students", uid));
        if (s.exists()) student = s.data();
      } catch (_) {}
      const company = vacancyMap[p.matchedCompanyId] || {};
      const date = p.approvedAt?.toDate().toLocaleDateString("en-ZM", { day:"2-digit", month:"short", year:"numeric" }) || "—";
      const methodBadge = p.approvalMethod === "auto"
        ? `<span class="status-pill" style="background:#2563eb">AUTO</span>`
        : `<span class="status-pill" style="background:#1e8a4c">MANUAL</span>`;
      const reviewer = p.approvalMethod === "manual" && p.tsReviewerName
        ? `<span>Reviewed by: <strong>${esc(p.tsReviewerName)}</strong></span>`
        : "";
      return `<div class="req-card" style="margin-bottom:10px">
        <div class="req-card-head">
          <div>
            <div class="req-name">${esc(student.name || uid)}</div>
            <div class="req-meta">
              <span>${esc(student.compNumber || "")} · ${esc(student.department || "")} · Year ${esc(student.yearOfStudy || "?")}</span>
              <span>Company: <strong>${esc(company.companyName || p.matchedCompanyId || "—")}</strong> · ${esc(company.province || "")} · ${esc(company.type || "")}</span>
              ${reviewer}
              <span>Confirmed: ${date}</span>
            </div>
          </div>
          ${methodBadge}
        </div>
      </div>`;
    }));
    list.innerHTML = cards.join("");
  } catch (err) {
    list.innerHTML = `<p class='error'>Failed to load: ${err.message}</p>`;
  }
}

// ── Letter fields preview ─────────────────────────────────────────────────────
// Opens a new window showing the exact values that will be inserted into the
// Google Doc template. The actual PDF is generated by Apps Script from the Doc —
// this preview just lets the secretary verify the data before approving.
function previewRequestFields(r, settings) {
  const fmtDate = ds => {
    if (!ds) return "";
    if (ds instanceof Date) return ds.toLocaleDateString("en-US", { month:"long", day:"numeric", year:"numeric" });
    const p = String(ds).split("-");
    if (p.length < 3) return ds;
    return new Date(+p[0], +p[1] - 1, +p[2]).toLocaleDateString("en-US", { month:"long", day:"numeric", year:"numeric" });
  };
  const today = fmtDate(new Date());
  const isMale  = (r.gender || "").toLowerCase() === "male";
  const title   = isMale ? "Mr."  : "Ms.";
  const heShe   = isMale ? "He"   : "She";
  const hisHer  = isMale ? "His"  : "Her";
  const himHer  = isMale ? "Him"  : "Her";
  const rows = [
    ["Date  {date}",                   today],
    ["Student name  {Student name}",   r.studentName  || ""],
    ["Student number  {Student number}", r.compNumber || ""],
    ["Title  {Title}",                 title],
    ["He/She  {He/She}",               heShe],
    ["His/Her  {His/Her}",             hisHer],
    ["Him/Her  {Him/Her}",             himHer],
    ["Department  {department}",       r.department   || ""],
    ["Year of study  {year of study}", r.yearOfStudy  || ""],
    ["Phone number  {phone number}",   r.phone        || ""],
    ["Training start  {start date}",   fmtDate(settings.sessionStartDate) || "— (not set)"],
    ["Training end  {closing date}",   fmtDate(settings.sessionEndDate)   || "— (not set)"],
    ["Secretary name",                 settings.secretaryName    || ""],
    ["Secretary email",                settings.secretaryEmail   || ""],
    ["Secretary phone",                settings.secretaryPhone   || ""],
    ...Object.entries(r.customFields || {})
  ].map(([k, v]) =>
    `<tr>
      <td style="padding:8px 14px;font-weight:600;background:#f5f7fa;border:1px solid #dde1e7;white-space:nowrap;font-size:13px;color:#555">${esc(k)}</td>
      <td style="padding:8px 14px;border:1px solid #dde1e7;font-size:13.5px">${esc(String(v))}</td>
    </tr>`
  ).join("");
  const html = `<!DOCTYPE html><html lang="en"><head><meta charset="UTF-8">
<title>Letter Fields Preview</title>
<style>
  body{font-family:Arial,sans-serif;padding:28px;background:#f0f2f5;margin:0}
  .card{background:#fff;border-radius:10px;padding:24px 28px;max-width:580px;margin:0 auto;box-shadow:0 2px 14px rgba(0,0,0,.1)}
  h2{margin:0 0 4px;color:#145a32;font-size:17px}
  p.note{font-size:12px;color:#888;margin:0 0 16px;line-height:1.5}
  table{border-collapse:collapse;width:100%}
</style></head><body>
<div class="card">
  <h2>Letter Fields Preview</h2>
  <p class="note">These values will be inserted into the Google Doc template by Apps Script and emailed as a PDF. The actual letter formatting is controlled by the Google Doc.</p>
  <table>${rows}</table>
</div></body></html>`;
  const w = window.open("", "_blank");
  if (w) { w.document.write(html); w.document.close(); }
}

// ── Template (Google Doc links — one per year group) ──────────────────────────
async function loadTemplate() {
  let settings = {};
  try {
    const snap = await getDoc(doc(db, "attachmentSettings", "main"));
    if (snap.exists()) settings = snap.data();
  } catch (_) {}

  const wireTemplate = (inputId, btnId, msgId, linkId, settingKey) => {
    const urlInput = document.getElementById(inputId);
    const openLink = document.getElementById(linkId);
    const setLink  = (url) => {
      urlInput.value = url || "";
      if (url) { openLink.href = url; openLink.style.opacity = ""; openLink.style.pointerEvents = ""; }
      else      { openLink.href = "#"; openLink.style.opacity = "0.5"; openLink.style.pointerEvents = "none"; }
    };
    setLink(settings[settingKey] || "");

    document.getElementById(btnId).onclick = async () => {
      const msg = document.getElementById(msgId);
      const url = urlInput.value.trim();
      msg.textContent = "Saving…"; msg.style.color = "#888";
      try {
        await setDoc(doc(db, "attachmentSettings", "main"), { [settingKey]: url }, { merge: true });
        settings[settingKey] = url;
        setLink(url);
        msg.style.color = "#1e8a4c"; msg.textContent = "URL saved.";
        setTimeout(() => { msg.textContent = ""; msg.style.color = ""; }, 3000);
      } catch (err) {
        msg.style.color = "#c0392b"; msg.textContent = err.message;
      }
    };
  };

  wireTemplate("templateDocUrl2to4", "saveTemplateUrl2to4Btn", "templateUrl2to4Msg",
    "openTemplateLink2to4", "templateDocUrl2to4");
  wireTemplate("templateDocUrl5th",  "saveTemplateUrl5thBtn",  "templateUrl5thMsg",
    "openTemplateLink5th",  "templateDocUrl5th");

  // Placement templates (stored in siteContent/placementLetterTemplates)
  let placementTemplates = {};
  try {
    const snap = await getDoc(doc(db, "siteContent", "placementLetterTemplates"));
    if (snap.exists()) placementTemplates = snap.data();
  } catch (_) {}

  const wirePlacementTemplate = (inputId, btnId, msgId, linkId, fieldKey) => {
    const urlInput = document.getElementById(inputId);
    const openLink = document.getElementById(linkId);
    const setLink  = (url) => {
      urlInput.value = url || "";
      if (url) { openLink.href = url; openLink.style.opacity = ""; openLink.style.pointerEvents = ""; }
      else      { openLink.href = "#"; openLink.style.opacity = "0.5"; openLink.style.pointerEvents = "none"; }
    };
    setLink(placementTemplates[fieldKey] || "");

    document.getElementById(btnId).onclick = async () => {
      const msg = document.getElementById(msgId);
      const url = urlInput.value.trim();
      msg.textContent = "Saving…"; msg.style.color = "#888";
      try {
        await setDoc(doc(db, "siteContent", "placementLetterTemplates"),
          { [fieldKey]: url }, { merge: true });
        placementTemplates[fieldKey] = url;
        setLink(url);
        msg.style.color = "#1e8a4c"; msg.textContent = "URL saved.";
        setTimeout(() => { msg.textContent = ""; msg.style.color = ""; }, 3000);
      } catch (err) {
        msg.style.color = "#c0392b"; msg.textContent = err.message;
      }
    };
  };

  wirePlacementTemplate("placementTemplateDocAttachment", "savePlacementTemplateAttachmentBtn",
    "placementTemplateAttachmentMsg", "openPlacementTemplateAttachment", "attachmentDocUrl");
  wirePlacementTemplate("placementTemplateDocInternship", "savePlacementTemplateInternshipBtn",
    "placementTemplateInternshipMsg",  "openPlacementTemplateInternship",  "internshipDocUrl");
}

// ── Placeholders ──────────────────────────────────────────────────────────────
let _placeholders = [];

async function loadPlaceholders() {
  const list = document.getElementById("phList");
  list.innerHTML = "<p class='muted'>Loading…</p>";
  try {
    const snap = await getDocs(query(collection(db, "attachmentPlaceholders"), orderBy("order")));
    _placeholders = snap.docs.map(d => ({ id: d.id, ...d.data() }));
    renderPhList();
  } catch (err) {
    list.innerHTML = `<p class='error'>${err.message}</p>`;
  }

  document.getElementById("addPhForm").addEventListener("submit", async e => {
    e.preventDefault();
    const errEl = document.getElementById("phAddErr");
    errEl.textContent = "";
    const key      = document.getElementById("phKey").value.trim().toLowerCase().replace(/\s+/g,"_");
    const label    = document.getElementById("phLabel").value.trim();
    const required = document.getElementById("phRequired").value === "true";
    if (!key || !label) { errEl.textContent = "Key and label are required."; return; }
    if (_placeholders.some(p => p.key === key)) { errEl.textContent = "That key already exists."; return; }
    try {
      const maxOrder = _placeholders.reduce((m, p) => Math.max(m, p.order || 0), 0);
      await addDoc(collection(db, "attachmentPlaceholders"), { key, label, required, order: maxOrder + 1 });
      document.getElementById("phKey").value = "";
      document.getElementById("phLabel").value = "";
      await loadPlaceholders();
    } catch (err) {
      errEl.textContent = err.message;
    }
  });

  // Placement placeholders
  await loadPlacementPlaceholders();
}

function renderPhList() {
  const list = document.getElementById("phList");
  if (!_placeholders.length) { list.innerHTML = "<p class='muted'>No custom placeholders yet.</p>"; return; }
  list.innerHTML = _placeholders.map(p => `
    <div class="ph-row" id="ph-row-${p.id}">
      <span class="ph-key">{${esc(p.key)}}</span>
      <span class="ph-lbl">${esc(p.label)}</span>
      ${p.required ? '<span class="ph-req-badge">required</span>' : ''}
      <button class="btn-del-ph" data-action="is:del-ph" data-id="${p.id}">Remove</button>
    </div>`).join("");
}

window.deletePh = async id => {
  if (!confirm("Remove this placeholder?")) return;
  try {
    await deleteDoc(doc(db, "attachmentPlaceholders", id));
    _placeholders = _placeholders.filter(p => p.id !== id);
    renderPhList();
  } catch (err) {
    alert(err.message);
  }
};

// ── Placement placeholders ────────────────────────────────────────────────────
let _placementPlaceholders = [];

async function loadPlacementPlaceholders() {
  const list = document.getElementById("placementPhList");
  if (!list) return;
  list.innerHTML = "<p class='muted'>Loading…</p>";
  try {
    const snap = await getDocs(query(collection(db, "placementPlaceholders"), orderBy("order")));
    _placementPlaceholders = snap.docs.map(d => ({ id: d.id, ...d.data() }));
    renderPlacementPhList();
  } catch (err) {
    list.innerHTML = `<p class='error'>${err.message}</p>`;
    return;
  }

  const phForm = document.getElementById("addPlacementPhForm");
  if (phForm.dataset.wired) return;
  phForm.dataset.wired = "1";
  phForm.addEventListener("submit", async e => {
    e.preventDefault();
    const errEl = document.getElementById("placementPhAddErr");
    errEl.textContent = "";
    const key      = document.getElementById("placementPhKey").value.trim().toLowerCase().replace(/\s+/g,"_");
    const label    = document.getElementById("placementPhLabel").value.trim();
    const required = document.getElementById("placementPhRequired").value === "true";
    if (!key || !label) { errEl.textContent = "Key and label are required."; return; }
    if (_placementPlaceholders.some(p => p.key === key)) { errEl.textContent = "That key already exists."; return; }
    try {
      const maxOrder = _placementPlaceholders.reduce((m, p) => Math.max(m, p.order || 0), 0);
      await addDoc(collection(db, "placementPlaceholders"), { key, label, required, order: maxOrder + 1 });
      document.getElementById("placementPhKey").value = "";
      document.getElementById("placementPhLabel").value = "";
      await loadPlacementPlaceholders();
    } catch (err) {
      errEl.textContent = err.message;
    }
  });
}

function renderPlacementPhList() {
  const list = document.getElementById("placementPhList");
  if (!_placementPlaceholders.length) {
    list.innerHTML = "<p class='muted'>No custom placement placeholders yet.</p>"; return;
  }
  list.innerHTML = _placementPlaceholders.map(p => `
    <div class="ph-row" id="pph-row-${p.id}">
      <span class="ph-key">{${esc(p.key)}}</span>
      <span class="ph-lbl">${esc(p.label)}</span>
      ${p.required ? '<span class="ph-req-badge">required</span>' : ''}
      <button class="btn-del-ph" data-action="is:del-placement-ph" data-id="${p.id}">Remove</button>
    </div>`).join("");
}

window.deletePlacementPh = async id => {
  if (!confirm("Remove this placeholder?")) return;
  try {
    await deleteDoc(doc(db, "placementPlaceholders", id));
    _placementPlaceholders = _placementPlaceholders.filter(p => p.id !== id);
    renderPlacementPhList();
  } catch (err) {
    alert(err.message);
  }
};

// ── Placement vacancy management ──────────────────────────────────────────────
function initDeptSlotsGrid() {
  const grid = document.getElementById("deptSlotsGrid");
  if (!grid) return;
  grid.innerHTML = DEPARTMENTS.map(dept => `
    <div style="display:flex;align-items:center;gap:8px">
      <label style="font-size:12px;font-weight:600;flex:1">${esc(dept)}</label>
      <input type="number" min="0" value="0" data-dept="${esc(dept)}"
        style="width:64px;padding:7px 8px;font-size:14px;border:1px solid var(--line);border-radius:8px;text-align:center">
    </div>`).join("");
}

async function loadVacancies() {
  const list = document.getElementById("vacancyList");
  if (!list) return;
  list.innerHTML = "<p class='muted small'>Loading…</p>";
  try {
    const snap = await getDocs(query(collection(db, "vacancies"), orderBy("createdAt", "desc")));
    if (snap.empty) {
      list.innerHTML = "<p class='muted small'>No vacancies yet. Add one below.</p>";
      return;
    }
    list.innerHTML = snap.docs.map(d => renderVacancyCard(d.id, d.data())).join("");
  } catch (err) {
    list.innerHTML = `<p class='error'>Failed to load: ${err.message}</p>`;
  }
}

function renderVacancyCard(id, v) {
  const required = Object.values(v.departmentsRequired || {}).reduce((s, n) => s + n, 0);
  const remaining = Object.values(v.slotsRemaining || {}).reduce((s, n) => s + n, 0);
  const deptLines = Object.entries(v.slotsRemaining || {})
    .map(([d, n]) => `${esc(d)}: ${n}`)
    .join(" · ");
  const statusBg = remaining === 0 ? "#1e8a4c" : "#e67e22";
  const statusTxt = remaining === 0 ? "FULL" : `${remaining}/${required} OPEN`;

  return `<div class="req-card" style="margin-bottom:10px">
    <div class="req-card-head">
      <div>
        <div class="req-name">${esc(v.companyName)}</div>
        <div class="req-meta">
          <span>${esc(v.province)} · ${esc(v.district)} · ${esc(v.type)}</span>
          <span>Gender: ${esc(v.genderPreference || "All")} · ${v.acceptMode === "auto" ? "Auto-confirm" : "Manual review"}</span>
          ${v.startDate ? `<span>Period: ${esc(v.startDate)} → ${esc(v.endDate || "—")}</span>` : ""}
          ${deptLines ? `<span style="font-size:11px">${deptLines}</span>` : ""}
        </div>
      </div>
      <span class="status-pill" style="background:${statusBg}">${statusTxt}</span>
    </div>
    <div class="req-actions">
      ${remaining > 0
        ? `<button class="btn-approve" id="assign-${id}" data-action="is:assign" data-id="${id}">Assign Now</button>`
        : `<span class="muted small" style="font-size:12px;color:var(--ok)">All slots filled</span>`
      }
      <button class="btn-danger-sm" style="font-size:12px;padding:6px 12px" data-action="is:del-vacancy" data-id="${id}">Delete</button>
      <p id="assign-err-${id}" class="action-err" style="width:100%;margin:4px 0 0"></p>
    </div>
  </div>`;
}

window.assignVacancy = async (vacancyId) => {
  const btn   = document.getElementById(`assign-${vacancyId}`);
  const errEl = document.getElementById(`assign-err-${vacancyId}`);
  if (btn)   { btn.disabled = true; btn.textContent = "Matching…"; }
  if (errEl) { errEl.textContent = ""; errEl.style.color = "var(--danger)"; }

  try {
    const vacSnap = await getDoc(doc(db, "vacancies", vacancyId));
    if (!vacSnap.exists()) throw new Error("Vacancy not found.");
    const vacancy = vacSnap.data();

    const paymentsSnap = await getDocs(collection(db, "payments"));
    const payments = paymentsSnap.docs.map(d => d.data());

    const { runMatchingAlgorithm, commitMatches } = await import("./placement-utils.js");
    const matches = await runMatchingAlgorithm(vacancyId, vacancy, payments);
    const totalMatched = matches.reduce((s, m) => s + m.students.length, 0);

    if (totalMatched === 0) {
      if (errEl) errEl.textContent = "No eligible students found for this vacancy.";
      if (btn)   { btn.disabled = false; btn.textContent = "Assign Now"; }
      return;
    }

    await commitMatches(vacancyId, matches);
    if (errEl) { errEl.style.color = "var(--ok)"; errEl.textContent = `Matched ${totalMatched} student(s).`; }
    if (btn)   btn.textContent = "Assigned ✓";
    setTimeout(() => loadVacancies(), 2000);
  } catch (err) {
    if (errEl) errEl.textContent = "Error: " + err.message;
    if (btn)   { btn.disabled = false; btn.textContent = "Assign Now"; }
  }
};

window.deleteVacancy = async (vacancyId) => {
  if (!confirm("Delete this vacancy? Matched students will NOT be automatically unmatched — manage them separately.")) return;
  try {
    await deleteDoc(doc(db, "vacancies", vacancyId));
    loadVacancies();
  } catch (err) {
    alert("Delete failed: " + err.message);
  }
};

// ── TS Review (manual accept mode) ───────────────────────────────────────────

async function loadTSReview() {
  const list = document.getElementById("tsReviewList");
  if (!list) return;
  list.innerHTML = "<p class='muted small'>Loading…</p>";
  try {
    const snap = await getDocs(
      query(collection(db, "placements"), where("placementStatus", "==", "awaiting_ts_approval"))
    );
    if (snap.empty) {
      list.innerHTML = "<p class='muted small'>No placements awaiting review.</p>";
      return;
    }

    // Batch-load unique vacancies
    const vacancyIds = [...new Set(snap.docs.map(d => d.data().matchedCompanyId).filter(Boolean))];
    const vacancyMap = {};
    await Promise.all(vacancyIds.map(async id => {
      const v = await getDoc(doc(db, "vacancies", id));
      if (v.exists()) vacancyMap[id] = v.data();
    }));

    // Render each pending review
    const cards = await Promise.all(snap.docs.map(async d => {
      const placement = d.data();
      const uid = d.id;
      let student = {};
      try {
        const s = await getDoc(doc(db, "students", uid));
        if (s.exists()) student = s.data();
      } catch (_) {}
      const company = vacancyMap[placement.matchedCompanyId] || {};
      return renderTSReviewCard(uid, placement, student, company);
    }));
    list.innerHTML = cards.join("");
  } catch (err) {
    list.innerHTML = `<p class='error'>Failed to load: ${err.message}</p>`;
  }
}

function renderTSReviewCard(uid, placement, student, company) {
  const cf = placement.customFields || {};
  const customRows = Object.entries(cf)
    .map(([k, v]) => `<span class="pay-detail"><span class="detail-label">${esc(k)}</span>${esc(v)}</span>`)
    .join("");
  const cvLink = placement.cvUrl
    ? `<a href="${esc(placement.cvUrl)}" target="_blank" class="btn-ghost" style="font-size:12px;padding:7px 14px;text-decoration:none;display:inline-flex;align-items:center;gap:4px">📄 REVIEW CV</a>`
    : "";
  return `<div class="req-card" style="margin-bottom:10px">
    <div class="req-card-head">
      <div>
        <div class="req-name">${esc(student.name || uid)}</div>
        <div class="req-meta">
          <span>${esc(student.compNumber || "")} · ${esc(student.department || "")} · Year ${esc(student.yearOfStudy || "?")}</span>
          <span>Company: <strong>${esc(company.companyName || placement.matchedCompanyId)}</strong> · ${esc(company.province || "")} · ${esc(company.type || "")}</span>
          ${customRows}
        </div>
      </div>
      <span class="status-pill" style="background:#e67e22">AWAITING REVIEW</span>
    </div>
    ${cvLink ? `<div style="display:flex;justify-content:flex-end;padding:6px 0 4px">${cvLink}</div>` : ""}
    <div class="req-actions">
      <button class="btn-approve" id="ts-approve-${uid}" data-action="is:ts-approve" data-uid="${uid}">Approve &amp; Send Letter</button>
      <button class="btn-danger-sm" id="ts-reject-${uid}" data-action="is:ts-reject" data-uid="${uid}">Reject (no penalty)</button>
      <p id="ts-review-err-${uid}" class="action-err" style="width:100%;margin:4px 0 0"></p>
    </div>
  </div>`;
}

window.approvePlacement = async (uid) => {
  const btn   = document.getElementById(`ts-approve-${uid}`);
  const errEl = document.getElementById(`ts-review-err-${uid}`);
  if (btn) { btn.disabled = true; btn.textContent = "Approving…"; }
  if (errEl) errEl.textContent = "";
  try {
    // Load placement, student, company, template, relay in parallel
    const placementSnap = await getDoc(doc(db, "placements", uid));
    if (!placementSnap.exists()) throw new Error("Placement not found.");
    const placement = placementSnap.data();

    const [studentSnap, companySnap, templSnap] = await Promise.all([
      getDoc(doc(db, "students", uid)),
      getDoc(doc(db, "vacancies", placement.matchedCompanyId)),
      getDoc(doc(db, "siteContent", "placementLetterTemplates"))
    ]);

    const student = studentSnap.exists() ? studentSnap.data() : {};
    const company = companySnap.exists() ? companySnap.data() : {};

    let templateDocUrl = "";
    if (templSnap.exists()) {
      const t = templSnap.data();
      templateDocUrl = company.type === "Internship"
        ? (t.internshipDocUrl || "") : (t.attachmentDocUrl || "");
    }

    const payload = {
      type: "placement_letter",
      to: student.email || "",
      studentName: student.name || "",
      studentNumber: student.compNumber || "",
      department: student.department || "",
      yearOfStudy: student.yearOfStudy || "",
      gender: student.gender || "",
      phone: placement.phone || student.phone || "",
      companyName: company.companyName || "",
      province: company.province || "",
      district: company.district || "",
      placementType: company.type || "",
      himselfHerself: student.gender === "Male" ? "himself" : "herself",
      startDate: company.startDate || "",
      endDate: company.endDate || "",
      templateDocUrl,
      customFields: placement.customFields || {}
    };

    // Update Firestore FIRST — email is best-effort.
    await updateDoc(doc(db, "placements", uid), {
      placementStatus: "confirmed",
      approvalMethod:  "manual",
      tsReviewerId:    _user.uid,
      tsReviewerName:  _profile?.name || _user.email || "",
      approvedAt:      serverTimestamp(),
      cvUrl: ""
    });

    // Show immediate success in the card before the async list refresh runs
    const card = btn?.closest(".req-card");
    if (card) card.innerHTML = `<div style="padding:12px 14px;color:var(--ok);font-weight:600">✓ Placement confirmed — letter being sent to ${esc(student.email || "student")}.</div>`;

    if (student.fcmToken) sendPush(student.fcmToken, "Placement Confirmed!", `Your ${company.type || "industrial"} placement at ${company.companyName || "a company"} has been confirmed.`);

    sendEmail(payload);

    // Background refresh — failure is OK; user already saw the ✓ success above
    loadTSReview().catch(() => {});
    // Also refresh confirmed tab if it's currently open
    const confirmedTab = document.getElementById("tab-confirmed");
    if (confirmedTab && !confirmedTab.classList.contains("hidden")) loadConfirmedPlacements();
  } catch (err) {
    if (errEl) errEl.textContent = err.message;
    if (btn)   { btn.disabled = false; btn.textContent = "Approve & Send Letter"; }
  }
};

window.rejectPlacementNopenalty = async (uid) => {
  if (!confirm("Return this student to pending? They will NOT receive a rejection penalty and can be matched again.")) return;
  const btn   = document.getElementById(`ts-reject-${uid}`);
  const errEl = document.getElementById(`ts-review-err-${uid}`);
  if (btn) { btn.disabled = true; btn.textContent = "Rejecting…"; }
  if (errEl) errEl.textContent = "";
  try {
    // Restore vacancy slot for the student's department
    const placementSnap = await getDoc(doc(db, "placements", uid));
    if (!placementSnap.exists()) throw new Error("Placement not found.");
    const placement = placementSnap.data();

    const studentSnap = await getDoc(doc(db, "students", uid));
    const dept = studentSnap.exists() ? studentSnap.data().department : null;

    if (dept && placement.matchedCompanyId) {
      const vacRef = doc(db, "vacancies", placement.matchedCompanyId);
      const vacSnap = await getDoc(vacRef);
      if (vacSnap.exists()) {
        const slots = { ...vacSnap.data().slotsRemaining };
        slots[dept] = (slots[dept] || 0) + 1;
        await updateDoc(vacRef, { slotsRemaining: slots });
      }
    }

    await updateDoc(doc(db, "placements", uid), {
      placementStatus: "pending",
      matchedCompanyId: null,
      matchedAt: null,
      customFields: null
      // rejectionCount intentionally NOT changed
    });

    loadTSReview();
    loadVacancies(); // refresh slot counts
  } catch (err) {
    if (errEl) errEl.textContent = err.message;
    if (btn)   { btn.disabled = false; btn.textContent = "Reject (no penalty)"; }
  }
};
