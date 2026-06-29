import { auth, db } from "./firebase.js";
import { protect } from "./guard.js";
import { initSubHero } from "./subhero.js?v=4";
import { executiveTabs } from "./nav.js";
import { uploadProof, deleteUpload, authHeaders } from "./upload.js";
import {
  collection, doc, getDoc, getDocs, addDoc, deleteDoc, updateDoc, setDoc,
  query, where, orderBy, serverTimestamp, runTransaction, writeBatch
} from "https://www.gstatic.com/firebasejs/10.12.2/firebase-firestore.js";
import {
  reauthenticateWithCredential, EmailAuthProvider, updatePassword
} from "https://www.gstatic.com/firebasejs/10.12.2/firebase-auth.js";
import { ORG, UPLOAD_WORKER_URL } from "./config.js";
import { sendPush } from "./fcm.js";

async function getTrialMode() {
  try {
    const snap = await getDoc(doc(db, "settings", "emailRelay"));
    return snap.exists() ? (snap.data().isTrial === true) : false;
  } catch (_) { return false; }
}

const pendingList = document.getElementById("pendingList");
const allList     = document.getElementById("allList");

// Signature UI
const sigInput   = document.getElementById("sigInput");
const sigPreview = document.getElementById("sigPreview");
const sigPlace   = document.getElementById("sigPlaceholder");
const saveSigBtn = document.getElementById("saveSigBtn");
const sigErr     = document.getElementById("sigErr");
const sigOk      = document.getElementById("sigOk");

let currentUser, currentProfile;
let pendingSigFile = null;
let isT             = false; // Treasurer or Admin
let isCA            = false; // Chairperson, Vice Chairperson, or Admin
let isContentMgr    = false; // Information & Publicity or Admin
let isActivitiesMgr = false; // Info & Publicity, Social & Cultural, or Admin

protect(["executive", "admin"], (user, profile) => {
  currentUser = user; currentProfile = profile;
  // Redirect Industrial Training Secretary to their own page
  if (profile.role === "executive" && profile.position === "Industrial Training Secretary") {
    location.replace("industrial-secretary.html"); return;
  }
  isT  = profile.position === "Treasurer" || profile.role === "admin";
  isCA = ["Chairperson", "Vice Chairperson"].includes(profile.position) || profile.role === "admin";

  isContentMgr    = profile.position === "Information and Publicity Secretary" || profile.role === "admin";
  isActivitiesMgr = ["Information and Publicity Secretary", "Social and Cultural Secretary"].includes(profile.position) || profile.role === "admin";
  const isLibrarian = ["Secretary General","Vice Secretary General"].includes(profile.position)
                      || profile.role === "admin";
  const isPlacementMgr = ["Secretary General","Vice Secretary General"].includes(profile.position)
                         || profile.role === "admin";

  const hash = location.hash.replace("#", "");
  const active = hash && document.getElementById(hash) ? hash : "tab-dash";

  initSubHero(user, profile, {
    page: "executive",
    active,
    tabs: executiveTabs({ content: isContentMgr, activities: isActivitiesMgr, library: isLibrarian, placements: isPlacementMgr })
  });
  renderExecDash();      // explicit render so the dashboard never relies on shOnTab timing

  loadPending();         // default visible tab only
  initSignature();       // reads cached profile — no query
  initFinances();        // wires forms — no query
  initChangePw();        // wires form — no query
  initVerifyScanner();   // reveals Verify Receipt button + wires scanner modal
});

// ── Dashboard ─────────────────────────────────────────────────────────────────
function esc(s) {
  return String(s ?? "").replace(/&/g,"&amp;").replace(/</g,"&lt;").replace(/>/g,"&gt;").replace(/"/g,"&quot;");
}

function getDashGreeting() {
  const h = new Date().getHours();
  if (h < 12) return "Good morning";
  if (h < 17) return "Good afternoon";
  return "Good evening";
}

// Position-specific duties (read directly from rules + UI capabilities).
const ROLE_DESCS = {
  "Chairperson": [
    "Lead executive committee meetings and set the agenda",
    "Manage public website content — announcements and about pages",
    "Represent UZES in official engagements",
  ],
  "Vice Chairperson": [
    "Support the Chairperson and stand in during absence",
    "Assist with committee coordination and member affairs",
  ],
  "Treasurer": [
    "Confirm student payments and generate official receipts",
    "Record income and expenses in the Finances ledger",
    "Reject invalid payment proofs with reason notes",
  ],
  "Secretary General": [
    "Create and manage company vacancies for student placements",
    "Run the matching algorithm to assign students to companies",
    "Review and approve manual-mode placement confirmations",
    "Moderate the Library — uploads, edits, and course management",
  ],
  "Vice Secretary General": [
    "Assist the Secretary General with vacancy management",
    "Review and approve manual-mode placement confirmations",
    "Moderate the Library — uploads, edits, and course management",
  ],
  "Information and Publicity Secretary": [
    "Manage public website content — announcements, about pages",
    "Post and edit society activities and events",
    "Handle external communications and social media",
  ],
  "Social and Cultural Secretary": [
    "Organise social events and cultural activities",
    "Post activities and events on the public website",
  ],
  "Committee Member": [
    "Support the executive committee on assigned tasks",
    "Attend committee meetings and contribute to decisions",
  ],
};

const COMMON_EXEC = [
  "View pending payments and the full payments history",
  "Verify receipts via the QR scanner",
  "Update your profile signature and account settings",
];

function renderExecDash() {
  const dc = document.getElementById("dashContent");
  if (!dc) return;
  dc.dataset.loaded = "1";
  const pos = currentProfile?.position || "";
  const name = currentProfile?.name || currentUser?.email || "Executive";
  const greeting = getDashGreeting();
  const bullets = ROLE_DESCS[pos] || [];
  dc.innerHTML = `
    <div style="margin-bottom:14px;background:var(--green);color:#fff;padding:22px 24px;border-radius:14px;box-shadow:0 4px 14px rgba(0,85,165,.15)">
      <div style="font-size:20px;font-weight:800;color:#fff">${greeting}, ${esc(name)}.</div>
      <div style="font-size:14px;margin-top:6px;color:#dbeafe">${esc(pos || "Executive")} &nbsp;·&nbsp; Here's your role overview.</div>
    </div>
    ${bullets.length ? `
    <div class="card" style="padding:20px 22px;margin-bottom:12px">
      <div style="font-size:15px;font-weight:700;margin-bottom:12px;color:var(--text)">${esc(pos)} duties</div>
      <ul style="margin:0;padding-left:18px;line-height:1.8;font-size:14px;color:var(--text)">
        ${bullets.map(b => `<li>${esc(b)}</li>`).join("")}
      </ul>
    </div>` : ""}
    <div class="card" style="padding:20px 22px">
      <div style="font-size:15px;font-weight:700;margin-bottom:12px;color:var(--text)">As an executive you can also</div>
      <ul style="margin:0;padding-left:18px;line-height:1.8;font-size:14px;color:var(--text)">
        ${COMMON_EXEC.map(b => `<li>${esc(b)}</li>`).join("")}
      </ul>
    </div>`;
}

// ── Signature upload ──────────────────────────────────────────────────────────
function initSignature() {
  if (currentProfile.signatureUrl) {
    sigPreview.src = currentProfile.signatureUrl;
    sigPreview.style.display = "block";
    sigPlace.style.display = "none";
  }
  sigInput.addEventListener("change", () => {
    const file = sigInput.files[0];
    if (!file) return;
    pendingSigFile = file;
    const reader = new FileReader();
    reader.onload = (e) => {
      sigPreview.src = e.target.result;
      sigPreview.style.display = "block";
      sigPlace.style.display = "none";
    };
    reader.readAsDataURL(file);
    saveSigBtn.disabled = false;
    sigOk.textContent = "";
  });
  saveSigBtn.addEventListener("click", async () => {
    if (!pendingSigFile) return;
    sigErr.textContent = ""; sigOk.textContent = "";
    saveSigBtn.disabled = true; saveSigBtn.textContent = "Uploading…";
    try {
      const oldUrl = currentProfile.signatureUrl || "";
      const url = await uploadProof(pendingSigFile, null, "uzes-signatures");
      await updateDoc(doc(db, currentProfile.__collection || "users", currentUser.uid), { signatureUrl: url });
      if (oldUrl && oldUrl !== url) deleteUpload(oldUrl); // remove the old signature from R2
      currentProfile.signatureUrl = url;
      pendingSigFile = null;
      sigOk.textContent = "Signature saved successfully.";
    } catch (err) {
      sigErr.textContent = err.message;
      saveSigBtn.disabled = false;
    } finally {
      saveSigBtn.textContent = "Save signature";
    }
  });
}

// ── Change password ───────────────────────────────────────────────────────────
function initChangePw() {
  document.getElementById("changePwForm").addEventListener("submit", async (e) => {
    e.preventDefault();
    const cpErr = document.getElementById("cpErr");
    const cpOk  = document.getElementById("cpOk");
    const cpBtn = document.getElementById("cpBtn");
    cpErr.textContent = ""; cpOk.textContent = "";

    const currentPw = document.getElementById("cpCurrentPw").value;
    const newPw     = document.getElementById("cpNewPw").value;
    const confirmPw = document.getElementById("cpConfirmPw").value;

    if (newPw.length < 6) { cpErr.textContent = "New password must be at least 6 characters."; return; }
    if (newPw !== confirmPw) { cpErr.textContent = "Passwords do not match."; return; }

    cpBtn.disabled = true; cpBtn.textContent = "Saving…";
    try {
      const credential = EmailAuthProvider.credential(currentUser.email, currentPw);
      await reauthenticateWithCredential(currentUser, credential);
      await updatePassword(currentUser, newPw);
      e.target.reset();
      cpOk.textContent = "Password changed successfully.";
    } catch (err) {
      const msgs = {
        "auth/wrong-password":     "Current password is incorrect.",
        "auth/invalid-credential": "Current password is incorrect.",
        "auth/too-many-requests":  "Too many attempts. Please try again later."
      };
      cpErr.textContent = msgs[err.code] || err.message;
    } finally {
      cpBtn.disabled = false; cpBtn.textContent = "Change password";
    }
  });
}

// ── Tabs (lazy-load Reports and Finances) ─────────────────────────────────────
let allLoaded        = false;
let reportsLoaded    = false;
let financesLoaded   = false;
let contentLoaded    = false;
let activitiesLoaded = false;
let sgPlacementsLoaded = false;

// Lazy-load each tab the first time the sub-hero reveals it.
// window.shOnTab is read by subhero.js show() on every tab switch.
// IMPORTANT: this must be assigned at module level (before protect() fires)
// so it is available when initSubHero() calls show(active) synchronously.
window.shOnTab = async (id) => {
  if (id === "tab-dash") renderExecDash();
  if (id === "tab-all" && !allLoaded) {
    allLoaded = true;
    loadAll();
  }
  if (id === "tab-reports" && !reportsLoaded) {
    reportsLoaded = true;
    const { renderReports } = await import("./reports.js?v=5");
    renderReports("reportsContainer");
  }
  if (id === "tab-finances" && !financesLoaded) {
    financesLoaded = true;
    loadIncomes();
    loadExpenses();
  }
  if (id === "tab-content" && !contentLoaded) {
    contentLoaded = true;
    const { initContent } = await import("./content.js");
    initContent(currentUser, currentProfile);
  }
  if (id === "tab-activities" && !activitiesLoaded) {
    activitiesLoaded = true;
    const { initActivitiesEditor } = await import("./activities-editor.js");
    initActivitiesEditor(currentUser, currentProfile);
  }
  if (id === "tab-library-mod") {
    // Always reload on every visit (no guard) so the list stays fresh.
    switchLibModTab(_libModTab || "pending");
  }
  if (id === "tab-placements" && !sgPlacementsLoaded) {
    sgPlacementsLoaded = true;
    initSGPlacements();
  }
};

// ── Shared helpers ────────────────────────────────────────────────────────────
function fmtDate(ts) {
  if (!ts) return "—";
  return ts.toDate().toLocaleDateString("en-ZM",
    { day: "2-digit", month: "short", year: "numeric", hour: "2-digit", minute: "2-digit" });
}
function fmtShort(ts) {
  if (!ts) return "—";
  return ts.toDate().toLocaleDateString("en-ZM", { day: "2-digit", month: "short", year: "numeric" });
}

window.viewProof = function(url) {
  let m = document.getElementById("_pv");
  if (!m) {
    document.body.insertAdjacentHTML("beforeend",
      `<div id="_pv" style="position:fixed;inset:0;background:rgba(0,0,0,.82);z-index:9999;display:none;align-items:center;justify-content:center;padding:16px">
        <div style="background:#fff;border-radius:12px;max-width:min(96vw,680px);max-height:92vh;overflow:hidden;position:relative">
          <button id="_pvClose" style="position:absolute;top:10px;right:12px;border:none;background:rgba(255,255,255,.9);cursor:pointer;font-size:18px;color:#333;border-radius:50%;width:30px;height:30px;z-index:1;padding:0;line-height:30px">✕</button>
          <img id="_pvImg" src="" alt="Payment Proof" style="display:block;max-width:100%;max-height:90vh;object-fit:contain">
        </div>
      </div>`);
    m = document.getElementById("_pv");
    const close = () => { m.style.display = "none"; document.getElementById("_pvImg").src = ""; };
    document.getElementById("_pvClose").addEventListener("click", close);
    m.addEventListener("click", e => { if (e.target === m) close(); });
    document.addEventListener("keydown", e => { if (e.key === "Escape" && m.style.display !== "none") close(); });
  }
  document.getElementById("_pvImg").src = url;
  m.style.display = "flex";
};

function methodBadge(m) {
  const colors = {
    "Airtel Money": "#e40000", "MTN Money": "#ffc400",
    "Zamtel Money": "#006f3c", "Zed Mobile": "#005baa", "Cash": "#555"
  };
  return `<span class="badge" style="background:${colors[m]||'#888'};color:${m==='MTN Money'?'#000':'#fff'}">${m}</span>`;
}

function statusPill(s) {
  const c = { pending: "#e67e22", confirmed: "#1e8a4c", rejected: "#c0392b",
               approved: "#1e8a4c" }[s] || "#555";
  return `<span class="status-pill" style="background:${c}">${s.toUpperCase()}</span>`;
}

// ── Payment card ──────────────────────────────────────────────────────────────
function payCard(d, showActions) {
  const p = d.data();
  return `<div class="pay-card" id="card-${d.id}">
    <div class="pay-card-head">
      <div>
        <span class="student-name">${p.studentName || "Unknown"}</span>
        <span class="muted small"> · ${p.compNumber || "—"} · ${p.studentEmail || ""}</span>
      </div>
      ${statusPill(p.status)}
    </div>
    <div class="pay-card-body">
      <div class="pay-detail"><span class="detail-label">Category</span>${p.category}</div>
      <div class="pay-detail"><span class="detail-label">Amount</span><strong>K ${p.amount?.toFixed(2)}</strong> — ${p.amountInWords}</div>
      <div class="pay-detail"><span class="detail-label">Method</span>${methodBadge(p.method)}</div>
      ${p.txRef ? `<div class="pay-detail"><span class="detail-label">Ref / Line</span>${p.txRef}</div>` : ""}
      ${p.notes ? `<div class="pay-detail"><span class="detail-label">Notes</span>${p.notes}</div>` : ""}
      <div class="pay-detail"><span class="detail-label">Submitted</span>${fmtDate(p.submittedAt)}</div>
      ${p.status !== "pending" ? `<div class="pay-detail"><span class="detail-label">Reviewed by</span>${p.reviewerName || "—"} (${p.reviewerPosition || "—"}) on ${fmtDate(p.reviewedAt)}</div>` : ""}
      ${p.rejectionReason ? `<div class="pay-detail"><span class="detail-label">Rejection reason</span>${p.rejectionReason}</div>` : ""}
      <div class="pay-detail">
        <span class="detail-label">Proof</span>
        <button class="proof-link" style="border:none;background:none;cursor:pointer;padding:0;font-size:inherit;color:inherit;text-decoration:underline" onclick="viewProof('${p.proofUrl}')">View uploaded proof ↗</button>
      </div>
    </div>
    ${showActions && p.status === "pending" ? `
    <div class="pay-card-actions">
      <div class="reject-wrap" id="reject-wrap-${d.id}" style="display:none">
        <input type="text" class="reject-input" id="reject-reason-${d.id}"
          placeholder="Reason for rejection (required)">
        <button class="btn-danger-sm" onclick="confirmReject('${d.id}')">Confirm rejection</button>
        <button class="btn-sm" onclick="cancelReject('${d.id}')">Cancel</button>
      </div>
      <div id="action-btns-${d.id}">
        <button class="btn-confirm" onclick="confirmPayment('${d.id}')">✓ Confirm payment</button>
        <button class="btn-reject" onclick="showReject('${d.id}')">✕ Reject</button>
      </div>
      <p class="action-err error" id="action-err-${d.id}"></p>
    </div>` : ""}
  </div>`;
}

// ── Pending payments ───────────────────────────────────────────────────────────
async function loadPending() {
  pendingList.innerHTML = "<p class='muted'>Loading…</p>";
  try {
    const snap = await getDocs(query(
      collection(db, "payments"), where("status", "==", "pending"), orderBy("submittedAt", "asc")
    ));
    if (snap.empty) { pendingList.innerHTML = "<p class='muted'>No pending payments.</p>"; return; }
    pendingList.innerHTML = snap.docs.map(d => payCard(d, true)).join("");
  } catch (e) { pendingList.innerHTML = `<p class='error'>${e.message}</p>`; }
}

// ── All payments ───────────────────────────────────────────────────────────────
let _allDocs = [];

function renderAllFiltered(q) {
  const term = q.trim().toLowerCase();
  const visible = term
    ? _allDocs.filter(d => {
        const p = d.data();
        return (p.studentName || "").toLowerCase().includes(term)
            || (p.compNumber  || "").toLowerCase().includes(term);
      })
    : _allDocs;
  allList.innerHTML = visible.length
    ? visible.map(d => payCard(d, false)).join("")
    : `<p class='muted'>No payments match "${q}".</p>`;
}

async function loadAll() {
  allList.innerHTML = "<p class='muted'>Loading…</p>";
  try {
    const snap = await getDocs(query(collection(db, "payments"), orderBy("submittedAt", "desc")));
    if (snap.empty) { allList.innerHTML = "<p class='muted'>No payments yet.</p>"; _allDocs = []; return; }
    _allDocs = snap.docs;
    const searchEl = document.getElementById("allSearchInput");
    renderAllFiltered(searchEl ? searchEl.value : "");
    if (searchEl && !searchEl.dataset.wired) {
      searchEl.dataset.wired = "1";
      searchEl.addEventListener("input", e => renderAllFiltered(e.target.value));
    }
  } catch (e) { allList.innerHTML = `<p class='error'>${e.message}</p>`; }
}

// ── Secure random verification token (32 hex chars, unpredictable) ────────────
function generateVerifyToken() {
  const bytes = new Uint8Array(16);
  crypto.getRandomValues(bytes);
  return Array.from(bytes, b => b.toString(16).padStart(2, "0")).join("");
}

// ── Confirm payment ────────────────────────────────────────────────────────────
window.confirmPayment = async (payId) => {
  const btn   = document.querySelector(`#action-btns-${payId} .btn-confirm`);
  const errEl = document.getElementById(`action-err-${payId}`);
  if (!confirm("Confirm this payment? A receipt will be generated and emailed to the student.")) return;
  btn.disabled = true; btn.textContent = "Processing…";
  errEl.textContent = "";
  try {
    const verifyToken = generateVerifyToken();
    let receiptNo;
    await runTransaction(db, async (tx) => {
      const counterRef  = doc(db, "counters", "receipts");
      const counterSnap = await tx.get(counterRef);
      const prevSeq = counterSnap.exists() ? counterSnap.data().seq : 0;
      receiptNo = prevSeq >= 9999 ? 1 : prevSeq + 1;
      tx.set(counterRef, { seq: receiptNo });
      tx.update(doc(db, "payments", payId), {
        status: "confirmed", reviewedBy: currentUser.uid,
        reviewerName: currentProfile.name || currentUser.email,
        reviewerPosition: currentProfile.position || (currentProfile.role === "admin" ? "Patron" : "Executive"),
        reviewedAt: serverTimestamp(), receiptNo, receiptSentAt: serverTimestamp(),
        verifyToken
      });
    });

    const paySnap = await getDoc(doc(db, "payments", payId));
    const p = paySnap.data();
    const verifyUrl = `https://uzes-friendly-web.web.app/verify.html?no=${receiptNo}&tok=${verifyToken}`;

    // Write public verification record (best-effort — non-blocking)
    setDoc(doc(db, "verifications", String(receiptNo)), {
      tok: verifyToken,
      receiptNo,
      studentName: p.studentName,
      compNumber:  p.compNumber,
      category:    p.category,
      amount:      p.amount,
      method:      p.method,
      txRef:       p.txRef || "",
      reviewerName:     p.reviewerName,
      reviewerPosition: p.reviewerPosition,
      confirmedAt:      serverTimestamp()
    }).catch(e => console.warn("Verification record:", e.message));

    getTrialMode().then(async isTrial => {
      try {
        const signatureB64 = await urlToBase64(currentProfile.signatureUrl || "");
        await fetch(UPLOAD_WORKER_URL + "/send-email", {
          method: "POST",
          headers: { "Content-Type": "application/json", ...await authHeaders() },
          body: JSON.stringify({
            to: p.studentEmail, studentName: p.studentName, compNumber: p.compNumber,
            amount: p.amount, amountInWords: p.amountInWords, category: p.category,
            method: p.method, txRef: p.txRef, receiptNo: p.receiptNo,
            reviewerName: p.reviewerName, reviewerPosition: p.reviewerPosition,
            signatureB64,
            reviewedAt: new Date().toLocaleDateString("en-ZM", { day:"2-digit", month:"long", year:"numeric" }),
            isTrial,
            verifyUrl,
            org: ORG
          })
        });
      } catch (_) {}
    });

    document.getElementById(`card-${payId}`).remove();
    if (pendingList.querySelectorAll(".pay-card").length === 0) {
      pendingList.innerHTML = "<p class='muted'>No pending payments.</p>";
    }
    if (allLoaded) loadAll();   // only refresh the All-payments tab if it's been opened

    if (p.studentUid) {
      getDoc(doc(db, "students", p.studentUid)).then(snap => {
        const tok = snap.data()?.fcmToken;
        if (tok) sendPush(tok, "Payment Confirmed", `Your ${p.category} payment of K${p.amount} has been approved.`);
      }).catch(() => {});
    }
  } catch (err) {
    errEl.textContent = "Error: " + err.message;
    btn.disabled = false; btn.textContent = "✓ Confirm payment";
  }
};

async function urlToBase64(url) {
  if (!url) return "";
  try {
    const resp = await fetch(url);
    const blob = await resp.blob();
    return new Promise(resolve => {
      const reader = new FileReader();
      reader.onloadend = () => resolve(reader.result);
      reader.readAsDataURL(blob);
    });
  } catch (_) { return ""; }
}

// ── Reject payment ─────────────────────────────────────────────────────────────
window.showReject = (payId) => {
  document.getElementById(`action-btns-${payId}`).style.display = "none";
  document.getElementById(`reject-wrap-${payId}`).style.display = "flex";
};
window.cancelReject = (payId) => {
  document.getElementById(`action-btns-${payId}`).style.display = "";
  document.getElementById(`reject-wrap-${payId}`).style.display = "none";
};
window.confirmReject = async (payId) => {
  const reason = document.getElementById(`reject-reason-${payId}`).value.trim();
  const errEl  = document.getElementById(`action-err-${payId}`);
  if (!reason) { errEl.textContent = "Please enter a rejection reason."; return; }
  errEl.textContent = "";
  try {
    const paySnap = await getDoc(doc(db, "payments", payId));
    const p = paySnap.exists() ? paySnap.data() : {};

    await updateDoc(doc(db, "payments", payId), {
      status: "rejected", rejectionReason: reason, reviewedBy: currentUser.uid,
      reviewerName: currentProfile.name || currentUser.email,
      reviewerPosition: currentProfile.position || (currentProfile.role === "admin" ? "Patron" : "Executive"),
      reviewedAt: serverTimestamp()
    });

    authHeaders().then(async hdrs => {
      try {
        await fetch(UPLOAD_WORKER_URL + "/send-email", {
          method: "POST",
          headers: { "Content-Type": "application/json", ...hdrs },
          body: JSON.stringify({
            type: "reject", to: p.studentEmail,
            studentName: p.studentName, amount: p.amount, category: p.category, reason,
            reviewerName: currentProfile.name || currentUser.email,
            reviewerPosition: currentProfile.position || (currentProfile.role === "admin" ? "Patron" : "Executive")
          })
        });
      } catch (_) {}
    });

    document.getElementById(`card-${payId}`).remove();
    if (pendingList.querySelectorAll(".pay-card").length === 0) {
      pendingList.innerHTML = "<p class='muted'>No pending payments.</p>";
    }
    if (allLoaded) loadAll();   // only refresh the All-payments tab if it's been opened

    if (p.studentUid) {
      getDoc(doc(db, "students", p.studentUid)).then(snap => {
        const tok = snap.data()?.fcmToken;
        if (tok) sendPush(tok, "Payment Not Approved", `Your ${p.category} payment was not approved. Reason: ${reason}`);
      }).catch(() => {});
    }
  } catch (err) { errEl.textContent = "Error: " + err.message; }
};

// ══════════════════════════════════════════════════════════════════════════════
//  FINANCES TAB
// ══════════════════════════════════════════════════════════════════════════════

function initFinances() {
  // Show/hide sections based on role
  if (!isT)  document.getElementById("addIncomeCard").style.display  = "none";
  if (!isT)  document.getElementById("addExpenseCard").style.display = "none";
  if (!isCA) document.getElementById("pendingExpensesCard").style.display = "none";

  if (isT) {
    document.getElementById("incomeForm").addEventListener("submit", handleAddIncome);
    document.getElementById("expenseForm").addEventListener("submit", handleAddExpense);
  }
}

// ── Other income ──────────────────────────────────────────────────────────────
async function loadIncomes() {
  const el = document.getElementById("incomeList");
  el.innerHTML = "<p class='muted'>Loading…</p>";
  try {
    const snap = await getDocs(query(collection(db, "otherIncome"), orderBy("addedAt", "desc")));
    if (snap.empty) { el.innerHTML = "<p class='muted'>No other income recorded yet.</p>"; return; }
    el.innerHTML = snap.docs.map(d => {
      const r = { id: d.id, ...d.data() };
      return `<div class="fin-row">
        <div class="fin-row-main">
          <span class="fin-source">${r.source || "—"}</span>
          <span class="badge" style="background:#1a6fb5">${r.category || "Other"}</span>
        </div>
        <div class="fin-row-detail">
          <strong style="color:var(--ok)">K ${(r.amount||0).toFixed(2)}</strong>
          &nbsp;·&nbsp;${r.date || fmtShort(r.addedAt)}
          &nbsp;·&nbsp;Added by ${r.addedByName || "—"}
          ${r.notes ? ` &nbsp;·&nbsp; <em>${r.notes}</em>` : ""}
        </div>
        ${isT ? `<div class="fin-row-actions">
          <button class="btn-sm danger" onclick="deleteIncome('${r.id}')">Delete</button>
        </div>` : ""}
      </div>`;
    }).join("");
  } catch (e) { el.innerHTML = `<p class='error'>${e.message}</p>`; }
}

async function handleAddIncome(e) {
  e.preventDefault();
  const btn = document.getElementById("incomeBtn");
  const err = document.getElementById("incomeErr");
  err.textContent = ""; btn.disabled = true; btn.textContent = "Saving…";
  try {
    await addDoc(collection(db, "otherIncome"), {
      source:      document.getElementById("incomeSource").value.trim(),
      category:    document.getElementById("incomeCategory").value,
      amount:      parseFloat(document.getElementById("incomeAmount").value),
      date:        document.getElementById("incomeDate").value,
      notes:       document.getElementById("incomeNotes").value.trim(),
      addedBy:     currentUser.uid,
      addedByName: currentProfile.name || currentUser.email,
      addedAt:     serverTimestamp()
    });
    document.getElementById("incomeForm").reset();
    await loadIncomes();
  } catch (ex) { err.textContent = ex.message; }
  finally { btn.disabled = false; btn.textContent = "Add income record"; }
}

window.deleteIncome = async (id) => {
  if (!confirm("Delete this income record?")) return;
  try { await deleteDoc(doc(db, "otherIncome", id)); await loadIncomes(); }
  catch (e) { alert("Failed: " + e.message); }
};

// ── Expenses ──────────────────────────────────────────────────────────────────
function computeExpenseStatus(exp) {
  const decisions = Object.values(exp.approvals || {});
  if (decisions.some(d => d.decision === "rejected")) return "rejected";
  const chairOk = decisions.some(d => d.position === "Chairperson"      && d.decision === "approved");
  const viceOk  = decisions.some(d => d.position === "Vice Chairperson" && d.decision === "approved");
  if (chairOk && viceOk) return "approved";
  return "pending";
}

function renderExpenseRow(exp, showApproveButtons) {
  const sc       = { pending:"#e67e22", approved:"#1e8a4c", rejected:"#c0392b" }[exp.status] || "#555";
  const decisions = Object.values(exp.approvals || {});
  const myVote    = exp.approvals?.[currentUser.uid];
  const canAct    = showApproveButtons && exp.status === "pending" && !myVote;

  return `<div class="fin-row">
    <div class="fin-row-main">
      <span class="fin-source">${exp.purpose || "—"}</span>
      <span class="status-pill" style="background:${sc}">${exp.status.toUpperCase()}</span>
    </div>
    <div class="fin-row-detail">
      <strong style="color:var(--danger)">K ${(exp.amount||0).toFixed(2)}</strong>
      &nbsp;·&nbsp;Requested by ${exp.requestedByName || "—"} on ${fmtShort(exp.requestedAt)}
      ${exp.notes ? ` &nbsp;·&nbsp; <em>${exp.notes}</em>` : ""}
    </div>
    ${decisions.length ? `<div class="approval-chips">
      ${decisions.map(a => `
        <span class="approval-chip ${a.decision}">
          ${a.position}: ${a.decision === "approved" ? "✓" : "✕"} ${a.name}
        </span>`).join("")}
    </div>` : ""}
    ${myVote ? `<div class="fin-row-detail" style="margin-top:6px;font-style:italic">
      You ${myVote.decision} this request.
    </div>` : ""}
    ${canAct ? `<div class="fin-row-actions">
      <button class="btn-confirm" style="padding:7px 16px;font-size:13px"
        onclick="approveExpense('${exp.id}')">✓ Approve</button>
      <button class="btn-reject" style="padding:7px 16px;font-size:13px"
        onclick="rejectExpense('${exp.id}')">✕ Reject</button>
    </div>` : ""}
  </div>`;
}

async function loadExpenses() {
  const pendingEl = document.getElementById("pendingExpensesList");
  const allEl     = document.getElementById("expenseList");
  pendingEl.innerHTML = "<p class='muted'>Loading…</p>";
  allEl.innerHTML     = "<p class='muted'>Loading…</p>";
  try {
    const snap = await getDocs(query(collection(db, "expenses"), orderBy("requestedAt", "desc")));
    const all  = snap.docs.map(d => ({ id: d.id, ...d.data() }));

    const myPending = all.filter(e =>
      e.status === "pending" && isCA && !e.approvals?.[currentUser.uid]
    );
    pendingEl.innerHTML = myPending.length
      ? myPending.map(e => renderExpenseRow(e, true)).join("")
      : "<p class='muted'>No expense requests awaiting your approval.</p>";

    allEl.innerHTML = all.length
      ? all.map(e => renderExpenseRow(e, false)).join("")
      : "<p class='muted'>No expense records yet.</p>";
  } catch (e) {
    pendingEl.innerHTML = `<p class='error'>${e.message}</p>`;
    allEl.innerHTML     = "";
  }
}

async function handleAddExpense(e) {
  e.preventDefault();
  const btn = document.getElementById("expenseBtn");
  const err = document.getElementById("expenseErr");
  err.textContent = ""; btn.disabled = true; btn.textContent = "Submitting…";
  try {
    await addDoc(collection(db, "expenses"), {
      purpose:         document.getElementById("expensePurpose").value.trim(),
      amount:          parseFloat(document.getElementById("expenseAmount").value),
      notes:           document.getElementById("expenseNotes").value.trim(),
      status:          "pending",
      requestedBy:     currentUser.uid,
      requestedByName: currentProfile.name || currentUser.email,
      requestedAt:     serverTimestamp(),
      approvals:       {}
    });
    document.getElementById("expenseForm").reset();
    await loadExpenses();
  } catch (ex) { err.textContent = ex.message; }
  finally { btn.disabled = false; btn.textContent = "Submit expense request"; }
}

async function recordExpenseDecision(expId, decision) {
  try {
    // Add current user's decision to the approvals map
    await updateDoc(doc(db, "expenses", expId), {
      [`approvals.${currentUser.uid}`]: {
        name:     currentProfile.name || currentUser.email,
        position: currentProfile.position || "Executive",
        decision,
        at: serverTimestamp()
      }
    });

    // Re-fetch and check if overall status should change
    const snap = await getDoc(doc(db, "expenses", expId));
    const newStatus = computeExpenseStatus(snap.data());
    if (newStatus !== "pending") {
      await updateDoc(doc(db, "expenses", expId), { status: newStatus });
    }

    await loadExpenses();
  } catch (e) { alert("Failed: " + e.message); }
}

window.approveExpense = (expId) => {
  if (confirm("Approve this expense request?")) recordExpenseDecision(expId, "approved");
};
window.rejectExpense = (expId) => {
  if (confirm("Reject this expense request?")) recordExpenseDecision(expId, "rejected");
};

// ══════════════════════════════════════════════════════════════════════════════
//  LIBRARY MODERATION (Secretary General / Vice Secretary General / Admin)
// ══════════════════════════════════════════════════════════════════════════════

function libEsc(s) {
  return String(s ?? "")
    .replace(/&/g,"&amp;").replace(/</g,"&lt;")
    .replace(/>/g,"&gt;").replace(/"/g,"&quot;");
}

const _libIco = d =>
  `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.75" stroke-linecap="round" stroke-linejoin="round" width="22" height="22" style="vertical-align:-5px;color:var(--green)">${d}</svg>`;
const _libIcoSm = d =>
  `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" width="14" height="14" style="vertical-align:-2px">${d}</svg>`;
function libFileIcon(ext) {
  if (ext === "pdf") return _libIco('<path d="M14 2H6a2 2 0 0 0-2 2v16a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V8z"/><polyline points="14 2 14 8 20 8"/><line x1="16" y1="13" x2="8" y2="13"/><line x1="16" y1="17" x2="8" y2="17"/>');
  if (["png","jpg","jpeg","gif","webp"].includes(ext)) return _libIco('<rect x="3" y="3" width="18" height="18" rx="2" ry="2"/><circle cx="8.5" cy="8.5" r="1.5"/><polyline points="21 15 16 10 5 21"/>');
  if (["zip","rar","7z"].includes(ext)) return _libIco('<path d="M14 2H6a2 2 0 0 0-2 2v16a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V8z"/><polyline points="14 2 14 8 20 8"/><line x1="12" y1="18" x2="12" y2="12"/><line x1="9.5" y1="15" x2="14.5" y2="15"/>');
  return _libIco('<path d="M14 2H6a2 2 0 0 0-2 2v16a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V8z"/><polyline points="14 2 14 8 20 8"/>');
}
const _icoView  = _libIcoSm('<path d="M1 12s4-8 11-8 11 8 11 8-4 8-11 8-11-8-11-8z"/><circle cx="12" cy="12" r="3"/>');
const _icoOk    = _libIcoSm('<polyline points="20 6 9 17 4 12"/>');
const _icoUndo  = _libIcoSm('<polyline points="1 4 1 10 7 10"/><path d="M3.51 15a9 9 0 1 0 .49-4"/>');
const _icoDel   = _libIcoSm('<polyline points="3 6 5 6 21 6"/><path d="M19 6v14a2 2 0 0 1-2 2H7a2 2 0 0 1-2-2V6m3 0V4a1 1 0 0 1 1-1h4a1 1 0 0 1 1 1v2"/>');

let _libModTab = "pending";
const _libModCache = new Map();

window.libModViewFile = function(fid) {
  const f = _libModCache.get(fid);
  if (!f?.fileUrl) { alert("File not available"); return; }
  const k = btoa(f.fileUrl);
  const n = encodeURIComponent(f.originalName || "file");
  window.open(`/view.html?k=${encodeURIComponent(k)}&n=${n}`, "_blank");
};

window.switchLibModTab = function(tab) {
  _libModTab = tab;
  document.querySelectorAll(".lib-mod-tab").forEach(b => b.classList.remove("active-mod-tab"));
  document.getElementById("lib-mod-tab-" + tab)?.classList.add("active-mod-tab");
  const listEl    = document.getElementById("libModList");
  const bulkEl    = document.getElementById("libBulkUpload");
  const coursesEl = document.getElementById("libCoursesPanel");
  if (tab === "bulk") {
    if (listEl) listEl.style.display = "none";
    if (bulkEl) { bulkEl.style.display = ""; initBulkUpload(); }
    if (coursesEl) coursesEl.style.display = "none";
  } else if (tab === "courses") {
    if (listEl) listEl.style.display = "none";
    if (bulkEl) bulkEl.style.display = "none";
    if (coursesEl) { coursesEl.style.display = ""; initCourseManagement(); }
  } else {
    if (listEl) listEl.style.display = "";
    if (bulkEl) bulkEl.style.display = "none";
    if (coursesEl) coursesEl.style.display = "none";
    loadLibraryMod(tab);
  }
};

async function loadLibraryMod(tab) {
  _libModTab = tab;
  const listEl = document.getElementById("libModList");
  if (!listEl) return;
  listEl.innerHTML = "<p class='muted'>Loading…</p>";
  try {
    const q = tab === "pending"
      ? query(collection(db,"libraryFiles"), where("moderationStatus","==","under_review"))
      : query(collection(db,"libraryFiles"), where("isFlagged","==",true));
    const snap = await getDocs(q);
    if (snap.empty) {
      listEl.innerHTML = `<p class="muted">No ${tab === "pending" ? "pending review" : "flagged"} files. All clear.</p>`;
      return;
    }
    snap.docs.forEach(d => _libModCache.set(d.id, { id:d.id, ...d.data() }));
    listEl.innerHTML = snap.docs.map(d => renderLibModCard({ id:d.id, ...d.data() })).join("");
  } catch (err) {
    listEl.innerHTML = `<p class="error">Failed to load: ${libEsc(err.message)}</p>`;
  }
}

function renderLibModCard(f) {
  const ext  = (f.originalName||"").split(".").pop().toLowerCase();
  const icon = libFileIcon(ext);
  const fid  = libEsc(f.id);
  const rk   = libEsc(f.r2Key || "");

  const approveBtn = (!f.isFlagged && f.moderationStatus === "under_review")
    ? `<button class="btn-confirm" style="padding:7px 16px;font-size:13px" onclick="libModApprove('${fid}')">${_icoOk} Approve</button>`
    : "";
  const restoreBtn = f.isFlagged
    ? `<button class="btn-sm" onclick="libModRestore('${fid}')">${_icoUndo} Restore</button>`
    : "";

  return `<div class="pay-card" id="lm-${fid}">
    <div class="pay-card-head">
      <div>
        <span class="student-name">${icon} ${libEsc(f.originalName||"Untitled")}</span>
        <span class="muted small"> · ${libEsc(f.courseName||"—")} · ${libEsc(f.year||"—")}</span>
      </div>
      ${f.isFlagged
        ? `<span class="status-pill" style="background:var(--danger)">FLAGGED</span>`
        : `<span class="status-pill" style="background:#e67e22">PENDING</span>`}
    </div>
    <div class="pay-card-body">
      <div class="pay-detail"><span class="detail-label">Programme</span>${libEsc(f.programme||"—")}</div>
      <div class="pay-detail"><span class="detail-label">Subfolder</span>${libEsc(f.subfolder||"—")}</div>
      <div class="pay-detail"><span class="detail-label">Uploaded by</span>${libEsc(f.uploaderName||"—")}</div>
      <div class="pay-detail"><span class="detail-label">AI score</span>${f.aiScore??"-"}/100 — ${libEsc(f.aiReason||"—")}</div>
    </div>
    <div class="pay-card-actions" style="flex-direction:row;gap:8px;flex-wrap:wrap;padding-top:12px">
      ${f.fileUrl
        ? `<button class="btn-sm" onclick="libModViewFile('${fid}')">${_icoView} View file</button>`
        : ""}
      ${approveBtn}${restoreBtn}
      <button class="btn-reject" style="padding:7px 16px;font-size:13px" onclick="libModDelete('${fid}','${rk}')">${_icoDel} Delete</button>
    </div>
  </div>`;
}

window.libModApprove = async function(fileId) {
  if (!confirm("Approve this file? It will be visible to all members.")) return;
  try {
    await updateDoc(doc(db,"libraryFiles",fileId), {
      moderationStatus:"approved", isFlagged:false,
      reviewedBy:currentUser.uid, reviewedAt:serverTimestamp(),
    });
    document.getElementById(`lm-${fileId}`)?.remove();
  } catch (err) { alert("Approve failed: " + err.message); }
};

window.libModDelete = async function(fileId, r2Key) {
  if (!confirm("Permanently delete this file? This cannot be undone.")) return;
  try {
    if (r2Key) {
      await fetch(UPLOAD_WORKER_URL + "/delete", {
        method:"POST", headers:{"Content-Type":"application/json", ...(await authHeaders())},
        body: JSON.stringify({ key: r2Key }),
      }).catch(() => {});
    }
    const rpts = await getDocs(query(
      collection(db,"libraryReports"), where("fileId","==",fileId)
    ));
    await Promise.all(rpts.docs.map(d =>
      updateDoc(d.ref, { resolved:true, resolvedBy:currentUser.uid, resolvedAt:serverTimestamp() })
    ));
    await deleteDoc(doc(db,"libraryFiles",fileId));
    document.getElementById(`lm-${fileId}`)?.remove();
  } catch (err) { alert("Delete failed: " + err.message); }
};

window.libModRestore = async function(fileId) {
  if (!confirm("Restore this file? It will be unflagged and visible to members.")) return;
  try {
    await updateDoc(doc(db,"libraryFiles",fileId), { isFlagged:false, reportCount:0 });
    const rpts = await getDocs(query(
      collection(db,"libraryReports"),
      where("fileId","==",fileId), where("resolved","==",false)
    ));
    await Promise.all(rpts.docs.map(d =>
      updateDoc(d.ref, { resolved:true, resolvedBy:currentUser.uid, resolvedAt:serverTimestamp() })
    ));
    document.getElementById(`lm-${fileId}`)?.remove();
  } catch (err) { alert("Restore failed: " + err.message); }
};

// ── Bulk ZIP Upload (Secretary General / Vice Secretary General / Admin) ─────
const _BULK_PROGRAMMES = [
  "Bachelor of Engineering (Agricultural Engineering)",
  "Bachelor of Engineering (Civil and Environmental Engineering)",
  "Bachelor of Engineering (Electrical and Electronic Engineering)",
  "Bachelor of Engineering (Geomatic Engineering)",
  "Bachelor of Engineering (Mechanical Engineering)",
];
const _BULK_PROG_SHORT = {
  "Bachelor of Engineering (Agricultural Engineering)":             "Agricultural Engineering",
  "Bachelor of Engineering (Civil and Environmental Engineering)":  "Civil & Environmental Engineering",
  "Bachelor of Engineering (Electrical and Electronic Engineering)":"Electrical & Electronic Engineering",
  "Bachelor of Engineering (Geomatic Engineering)":                 "Geomatic Engineering",
  "Bachelor of Engineering (Mechanical Engineering)":               "Mechanical Engineering",
};
const _BULK_YEARS = ["1st Year","2nd Year","3rd Year","4th Year","5th Year"];
const _BULK_SUBS  = ["Exam and Test Past Papers","Exam and Test Solutions","Text Books","Others"];

let _bulkInited  = false;
let _bulkCourses = [];

async function initBulkUpload() {
  if (_bulkInited) return;
  _bulkInited = true;

  const el = document.getElementById("libBulkUpload");
  el.innerHTML = `
    <div class="card" style="margin-bottom:16px">
      <p class="section-head" style="margin-top:0">Bulk ZIP Upload</p>
      <p class="muted small" style="margin-bottom:16px">
        Upload a ZIP file containing academic files. Every file inside will be added
        to the library under the chosen folder and auto-approved.
      </p>
      <form id="bulkUpForm" autocomplete="off">
        <div style="display:grid;grid-template-columns:1fr 1fr;gap:12px;margin-bottom:12px">
          <div>
            <label for="bu-prog" style="font-size:13px;font-weight:600;display:block;margin-bottom:4px">Programme</label>
            <select id="bu-prog" required style="width:100%;padding:8px 10px;border:1px solid var(--line);border-radius:7px;font-size:13px;background:var(--card)">
              <option value="">Select programme…</option>
              ${_BULK_PROGRAMMES.map(p => `<option value="${p}">${_BULK_PROG_SHORT[p]||p}</option>`).join("")}
            </select>
          </div>
          <div>
            <label for="bu-year" style="font-size:13px;font-weight:600;display:block;margin-bottom:4px">Year</label>
            <select id="bu-year" required style="width:100%;padding:8px 10px;border:1px solid var(--line);border-radius:7px;font-size:13px;background:var(--card)">
              <option value="">Select year…</option>
              ${_BULK_YEARS.map(y => `<option value="${y}">${y}</option>`).join("")}
            </select>
          </div>
          <div>
            <label for="bu-course" style="font-size:13px;font-weight:600;display:block;margin-bottom:4px">Course</label>
            <select id="bu-course" required style="width:100%;padding:8px 10px;border:1px solid var(--line);border-radius:7px;font-size:13px;background:var(--card)">
              <option value="">Select course…</option>
            </select>
          </div>
          <div>
            <label for="bu-sub" style="font-size:13px;font-weight:600;display:block;margin-bottom:4px">Subfolder</label>
            <select id="bu-sub" required style="width:100%;padding:8px 10px;border:1px solid var(--line);border-radius:7px;font-size:13px;background:var(--card)">
              ${_BULK_SUBS.map(s => `<option value="${s}">${s}</option>`).join("")}
            </select>
          </div>
        </div>
        <div id="bu-drop" style="border:2px dashed var(--line);border-radius:10px;padding:28px 16px;text-align:center;cursor:pointer;background:var(--bg);margin-bottom:12px;transition:border-color .15s">
          <div id="bu-drop-text" style="font-size:14px;color:var(--muted)">Click or drag a ZIP file here</div>
        </div>
        <input type="file" id="bu-file" accept=".zip" style="display:none">
        <div style="display:flex;gap:10px;align-items:center;flex-wrap:wrap">
          <button type="submit" id="bu-submit" class="btn-confirm" style="padding:9px 22px">Upload ZIP</button>
          <span id="bu-err" class="error" style="font-size:13px"></span>
        </div>
      </form>
      <div id="bu-log" style="display:none;margin-top:16px;border-top:1px solid var(--line);padding-top:14px">
        <p style="font-weight:600;font-size:13px;margin-bottom:8px">Upload progress</p>
        <div id="bu-log-list" style="font-size:12px;font-family:monospace;max-height:280px;overflow-y:auto;background:var(--bg);padding:8px;border-radius:6px;border:1px solid var(--line)"></div>
        <div id="bu-summary" style="margin-top:10px;font-size:13px;font-weight:600"></div>
      </div>
    </div>`;

  // Load library courses once
  try {
    const snap = await getDocs(collection(db, "libraryCourses"));
    _bulkCourses = snap.docs.map(d => ({ id:d.id, ...d.data() }));
  } catch (_) {}

  const progSel  = document.getElementById("bu-prog");
  const yearSel  = document.getElementById("bu-year");
  const crseSel  = document.getElementById("bu-course");
  const drop     = document.getElementById("bu-drop");
  const fileInp  = document.getElementById("bu-file");
  const dropText = document.getElementById("bu-drop-text");
  let zipFile = null;

  function updateCourses() {
    crseSel.innerHTML = `<option value="">Select course…</option>`;
    const prog = progSel.value, yr = yearSel.value;
    if (!prog || !yr) return;
    _bulkCourses
      .filter(c => c.programme === prog && c.year === yr)
      .sort((a,b) => a.courseName.localeCompare(b.courseName))
      .forEach(c => crseSel.appendChild(new Option(c.courseName, c.courseName)));
  }
  progSel.addEventListener("change", updateCourses);
  yearSel.addEventListener("change", updateCourses);

  drop.addEventListener("click", () => fileInp.click());
  drop.addEventListener("dragover", e => { e.preventDefault(); drop.style.borderColor = "var(--green)"; });
  drop.addEventListener("dragleave", () => { drop.style.borderColor = ""; });
  drop.addEventListener("drop", e => {
    e.preventDefault(); drop.style.borderColor = "";
    const f = e.dataTransfer?.files?.[0];
    if (f && f.name.toLowerCase().endsWith(".zip")) { zipFile = f; dropText.textContent = f.name; }
    else alert("Please drop a .zip file.");
  });
  fileInp.addEventListener("change", () => {
    const f = fileInp.files[0];
    if (f) { zipFile = f; dropText.textContent = f.name; }
  });

  document.getElementById("bulkUpForm").addEventListener("submit", async e => {
    e.preventDefault();
    const prog   = progSel.value;
    const yr     = yearSel.value;
    const course = crseSel.value;
    const sub    = document.getElementById("bu-sub").value;
    const errEl  = document.getElementById("bu-err");
    errEl.textContent = "";
    if (!zipFile) { errEl.textContent = "Please select a ZIP file."; return; }
    if (!course)  { errEl.textContent = "Please select a course."; return; }

    // Lazy-load JSZip from CDN
    if (!window.JSZip) {
      try {
        await new Promise((resolve, reject) => {
          const s = document.createElement("script");
          s.src = "https://cdn.jsdelivr.net/npm/jszip@3.10.1/dist/jszip.min.js";
          s.onload = resolve; s.onerror = reject;
          document.head.appendChild(s);
        });
      } catch (_) { errEl.textContent = "Failed to load ZIP library. Check your internet connection."; return; }
    }

    const submitBtn = document.getElementById("bu-submit");
    submitBtn.disabled = true; submitBtn.textContent = "Processing…";
    const logEl   = document.getElementById("bu-log");
    const logList = document.getElementById("bu-log-list");
    const summary = document.getElementById("bu-summary");
    logEl.style.display = ""; logList.innerHTML = ""; summary.textContent = "";

    let zip;
    try {
      zip = await window.JSZip.loadAsync(zipFile);
    } catch (_) {
      errEl.textContent = "Could not read ZIP file.";
      submitBtn.disabled = false; submitBtn.textContent = "Upload ZIP"; return;
    }

    // Collect real files (skip dirs, __MACOSX, hidden files)
    const files = [];
    zip.forEach((path, entry) => {
      if (entry.dir) return;
      if (path.startsWith("__MACOSX")) return;
      const name = path.split("/").pop();
      if (!name || name.startsWith(".")) return;
      files.push({ name, entry });
    });

    if (!files.length) {
      errEl.textContent = "No files found in the ZIP (or all were skipped).";
      submitBtn.disabled = false; submitBtn.textContent = "Upload ZIP"; return;
    }

    function logLine(text, color) {
      const div = document.createElement("div");
      div.style.cssText = `padding:2px 0;border-bottom:1px solid var(--line);color:${color||"inherit"}`;
      div.textContent = text;
      logList.appendChild(div);
      logList.scrollTop = logList.scrollHeight;
      return div;
    }

    logLine(`Found ${files.length} file${files.length > 1 ? "s" : ""} — checking for duplicates…`, "#555");

    // One Firestore query for the course; filter subfolder client-side.
    let existingNames = new Set();
    try {
      const existSnap = await getDocs(query(
        collection(db, "libraryFiles"), where("courseName", "==", course)
      ));
      existSnap.docs.forEach(d => {
        const fd = d.data();
        if (fd.subfolder === sub && fd.moderationStatus !== "rejected")
          existingNames.add((fd.originalName || "").toLowerCase());
      });
    } catch (_) {}

    logLine(`Uploading to ${course} › ${sub}…`, "#555");

    let ok = 0, fail = 0, skipped = 0;
    for (const { name, entry } of files) {
      const line = logLine(`⬆ ${name}`, "#888");

      if (existingNames.has(name.toLowerCase())) {
        line.textContent = `⊘ ${name} — already in library`;
        line.style.color = "#999";
        skipped++;
        continue;
      }
      try {
        const blob = await entry.async("blob");
        const file = new File([blob], name, { type: blob.type || "application/octet-stream" });
        const fd   = new FormData();
        fd.append("file",      file);
        fd.append("course",    course);
        fd.append("programme", prog);
        fd.append("year",      yr);
        fd.append("subfolder", sub);

        const res  = await fetch(UPLOAD_WORKER_URL + "/library/upload", {
          method: "POST", body: fd, headers: { ...(await authHeaders()) }
        });
        const data = await res.json();
        if (!res.ok || !data.ok) throw new Error(data.error || "Upload failed");

        await addDoc(collection(db, "libraryFiles"), {
          courseName:       course,
          programme:        prog,
          year:             yr,
          subfolder:        sub,
          originalName:     data.originalName,
          fileUrl:          data.fileUrl,
          r2Key:            data.r2Key,
          fileId:           data.fileId,
          ext:              (data.originalName||"").split(".").pop().toLowerCase(),
          moderationStatus: "approved",
          aiScore:          data.aiScore,
          aiReason:         data.aiReason,
          aiContentType:    data.aiContentType,
          uploadedBy:       currentUser.uid,
          uploaderName:     currentProfile.name || currentUser.email,
          ratingCount: 0, avgRating: 0,
          reportCount: 0, isFlagged: false,
          uploadedAt: serverTimestamp(),
        });

        line.textContent = `✓ ${name}`;
        line.style.color = "var(--green)";
        ok++;
      } catch (err) {
        line.textContent = `✗ ${name} — ${err.message}`;
        line.style.color = "var(--danger)";
        fail++;
      }
      // Brief pause so sequential uploads don't saturate the rate limiter
      await new Promise(r => setTimeout(r, 600));
    }

    const parts = [];
    if (ok)      parts.push(`${ok} uploaded`);
    if (skipped) parts.push(`${skipped} already existed`);
    if (fail)    parts.push(`${fail} failed`);
    summary.textContent = "Done: " + (parts.join(", ") || "nothing to do") + ".";
    summary.style.color = fail ? "var(--danger)" : ok ? "var(--green)" : "#888";
    submitBtn.disabled = false; submitBtn.textContent = "Upload ZIP";
    zipFile = null; fileInp.value = ""; dropText.textContent = "Click or drag a ZIP file here";
  });
}

// ── Course Management (Secretary General / Vice Secretary General / Admin) ────

let _cmInited  = false;
let _cmCourses = [];

async function initCourseManagement() {
  const el = document.getElementById("libCoursesPanel");
  if (!el) return;
  if (!_cmInited) {
    _cmInited = true;
    el.innerHTML = `
      <div class="card" style="margin-bottom:16px">
        <p class="section-head" style="margin-top:0">Manage Library Courses</p>
        <p class="muted small" style="margin-bottom:16px">
          Courses added here appear in the library browser. All 4 folders
          (Past Papers, Solutions, Text Books, Others) are automatically available
          for every course — no extra setup needed.
        </p>
        <div style="background:var(--bg);border:1px solid var(--line);border-radius:8px;padding:14px;margin-bottom:16px">
          <p style="font-weight:600;font-size:14px;margin:0 0 12px">Add new course</p>
          <form id="addCourseForm" autocomplete="off">
            <div style="display:grid;grid-template-columns:1fr 1fr;gap:10px;margin-bottom:10px">
              <div>
                <label style="font-size:12px;font-weight:600;display:block;margin-bottom:3px">Programme</label>
                <select id="ac-prog" required style="width:100%;padding:7px 8px;border:1px solid var(--line);border-radius:7px;font-size:12px;background:var(--card)">
                  <option value="">Select…</option>
                  ${_BULK_PROGRAMMES.map(p => `<option value="${libEsc(p)}">${libEsc(_BULK_PROG_SHORT[p]||p)}</option>`).join("")}
                </select>
              </div>
              <div>
                <label style="font-size:12px;font-weight:600;display:block;margin-bottom:3px">Year</label>
                <select id="ac-year" required style="width:100%;padding:7px 8px;border:1px solid var(--line);border-radius:7px;font-size:12px;background:var(--card)">
                  <option value="">Select…</option>
                  ${_BULK_YEARS.map(y => `<option value="${libEsc(y)}">${libEsc(y)}</option>`).join("")}
                </select>
              </div>
            </div>
            <div style="margin-bottom:10px">
              <label style="font-size:12px;font-weight:600;display:block;margin-bottom:3px">Course name</label>
              <input id="ac-name" type="text" required placeholder="e.g. Engineering Mathematics I"
                style="width:100%;padding:7px 8px;border:1px solid var(--line);border-radius:7px;font-size:12px;box-sizing:border-box;background:var(--card)">
            </div>
            <div style="display:flex;gap:10px;align-items:center">
              <button type="submit" class="btn-confirm" style="padding:7px 16px;font-size:13px">Add Course</button>
              <span id="ac-msg" style="font-size:12px"></span>
            </div>
          </form>
        </div>
        <div id="courseListWrap"><p class="muted small">Loading courses…</p></div>
      </div>`;
    document.getElementById("addCourseForm").addEventListener("submit", _addLibCourse);
  }
  await _loadCourseList();
}

async function _loadCourseList() {
  const wrap = document.getElementById("courseListWrap");
  if (!wrap) return;
  try {
    const snap = await getDocs(collection(db, "libraryCourses"));
    _cmCourses = snap.docs.map(d => ({ id: d.id, ...d.data() }));
    // Keep bulk upload's course cache in sync
    _bulkCourses = [..._cmCourses];
    _renderCourseList();
  } catch (err) {
    wrap.innerHTML = `<p class="error">Failed to load: ${libEsc(err.message)}</p>`;
  }
}

function _renderCourseList() {
  const wrap = document.getElementById("courseListWrap");
  if (!wrap) return;
  if (!_cmCourses.length) {
    wrap.innerHTML = `<p class="muted small">No courses yet. Add the first one above.</p>`;
    return;
  }

  // Group by programme + year
  const groups = {};
  _cmCourses.forEach(c => {
    const key = c.programme + "||" + c.year;
    if (!groups[key]) groups[key] = { programme: c.programme, year: c.year, courses: [] };
    groups[key].courses.push(c);
  });
  const sorted = Object.values(groups).sort((a, b) => {
    const pc = a.programme.localeCompare(b.programme);
    return pc !== 0 ? pc : a.year.localeCompare(b.year);
  });

  wrap.innerHTML = sorted.map(g => `
    <div style="margin-bottom:14px">
      <p style="font-weight:600;font-size:12px;color:var(--muted);margin:0 0 5px;
                border-bottom:1px solid var(--line);padding-bottom:4px;text-transform:uppercase;letter-spacing:.4px">
        ${libEsc(_BULK_PROG_SHORT[g.programme] || g.programme)} — ${libEsc(g.year)}
        <span style="font-weight:400">(${g.courses.length})</span>
      </p>
      ${g.courses.sort((a,b)=>a.courseName.localeCompare(b.courseName)).map(c => `
        <div id="cr-${libEsc(c.id)}"
             style="display:flex;align-items:center;gap:8px;padding:5px 0;border-bottom:1px solid var(--bg)">
          <span id="cr-name-${libEsc(c.id)}" style="flex:1;font-size:13px">${libEsc(c.courseName)}</span>
          <button class="btn-sm" style="padding:3px 10px;font-size:12px"
            onclick="editLibCourse('${libEsc(c.id)}','${libEsc(c.courseName)}','${libEsc(c.programme)}','${libEsc(c.year)}')">Edit</button>
          <button class="btn-reject" style="padding:3px 10px;font-size:12px"
            onclick="deleteLibCourse('${libEsc(c.id)}','${libEsc(c.courseName)}')">Delete</button>
        </div>`).join("")}
    </div>`).join("");
}

async function _addLibCourse(e) {
  e.preventDefault();
  const prog = document.getElementById("ac-prog").value;
  const yr   = document.getElementById("ac-year").value;
  const name = document.getElementById("ac-name").value.trim();
  const msg  = document.getElementById("ac-msg");
  msg.textContent = "";
  if (!prog || !yr || !name) { msg.style.color="var(--danger)"; msg.textContent="All fields required."; return; }
  const dup = _cmCourses.find(c =>
    c.programme === prog && c.year === yr &&
    c.courseName.toLowerCase() === name.toLowerCase()
  );
  if (dup) { msg.style.color="var(--danger)"; msg.textContent="This course already exists."; return; }

  msg.style.color="var(--muted)"; msg.textContent="Saving…";
  try {
    const ref = await addDoc(collection(db, "libraryCourses"), {
      courseName: name, programme: prog, year: yr
    });
    _cmCourses.push({ id: ref.id, courseName: name, programme: prog, year: yr });
    _bulkCourses = [..._cmCourses];
    document.getElementById("ac-name").value = "";
    _renderCourseList();
    msg.style.color="var(--ok)"; msg.textContent="Course added.";
  } catch (err) {
    msg.style.color="var(--danger)"; msg.textContent="Failed: " + err.message;
  }
}

window.editLibCourse = function(id, currentName, programme, year) {
  const row = document.getElementById("cr-" + id);
  if (!row) return;
  row.innerHTML = `
    <input id="cr-edit-${libEsc(id)}" type="text" value="${libEsc(currentName)}"
      style="flex:1;padding:4px 8px;border:1px solid var(--green);border-radius:6px;font-size:13px">
    <button class="btn-confirm" style="padding:3px 10px;font-size:12px"
      onclick="saveLibCourse('${libEsc(id)}','${libEsc(programme)}','${libEsc(year)}')">Save</button>
    <button class="btn-sm" style="padding:3px 10px;font-size:12px"
      onclick="_renderCourseList()">Cancel</button>`;
  document.getElementById("cr-edit-" + id)?.focus();
};

window._renderCourseList = _renderCourseList;

window.saveLibCourse = async function(id, programme, year) {
  const input = document.getElementById("cr-edit-" + id);
  if (!input) return;
  const newName = input.value.trim();
  if (!newName) { input.style.borderColor="var(--danger)"; return; }
  input.disabled = true;

  try {
    const oldEntry = _cmCourses.find(c => c.id === id);
    const oldName  = oldEntry?.courseName;

    await updateDoc(doc(db, "libraryCourses", id), { courseName: newName });

    // Batch-rename all library files that reference the old course name
    if (oldName && oldName !== newName) {
      const filesSnap = await getDocs(query(
        collection(db, "libraryFiles"), where("courseName", "==", oldName)
      ));
      if (filesSnap.size > 0) {
        const CHUNK = 499;
        const docs  = filesSnap.docs;
        for (let i = 0; i < docs.length; i += CHUNK) {
          const batch = writeBatch(db);
          docs.slice(i, i + CHUNK).forEach(d => batch.update(d.ref, { courseName: newName }));
          await batch.commit();
        }
      }
    }

    if (oldEntry) oldEntry.courseName = newName;
    _bulkCourses = [..._cmCourses];
    _renderCourseList();
  } catch (err) {
    alert("Save failed: " + err.message);
    input.disabled = false;
  }
};

window.deleteLibCourse = async function(id, courseName) {
  const wrap = document.getElementById("courseListWrap");

  // Check how many files belong to this course
  let filesSnap;
  try {
    filesSnap = await getDocs(query(
      collection(db, "libraryFiles"), where("courseName", "==", courseName)
    ));
  } catch (err) { alert("Could not check files: " + err.message); return; }

  if (filesSnap.empty) {
    if (!confirm(`Delete course "${courseName}"?\n\nThis cannot be undone.`)) return;
  } else {
    const n = filesSnap.size;
    if (!confirm(
      `"${courseName}" has ${n} file${n>1?"s":""} in the library.\n\n` +
      `Deleting this course will permanently remove all ${n} file${n>1?"s":""} from the library and storage.\n\n` +
      `This cannot be undone. Delete course and all files?`
    )) return;

    // Delete each file from R2 then Firestore
    const hdrs = await authHeaders();
    for (const d of filesSnap.docs) {
      const fd = d.data();
      if (fd.r2Key) {
        await fetch(UPLOAD_WORKER_URL + "/delete", {
          method: "POST",
          headers: { "Content-Type": "application/json", ...hdrs },
          body: JSON.stringify({ key: fd.r2Key }),
        }).catch(() => {});
      }
    }
    // Batch-delete Firestore docs
    const CHUNK = 499;
    const allDocs = filesSnap.docs;
    for (let i = 0; i < allDocs.length; i += CHUNK) {
      const batch = writeBatch(db);
      allDocs.slice(i, i + CHUNK).forEach(d => batch.delete(d.ref));
      await batch.commit();
    }
  }

  try {
    await deleteDoc(doc(db, "libraryCourses", id));
    _cmCourses = _cmCourses.filter(c => c.id !== id);
    _bulkCourses = [..._cmCourses];
    _renderCourseList();
  } catch (err) { alert("Delete failed: " + err.message); }
};

// ── QR Receipt Verification Scanner ──────────────────────────────────────────
// Initialised from protect() callback once executive role is confirmed.
export function initVerifyScanner() {
  const VERIFY_HOST     = "uzes-friendly-web.web.app";
  const VERIFY_PATHNAME = "/verify.html";

  // Pre-flight URL validation (security filter) — called BEFORE any Firestore
  // query. Malicious / foreign QR codes are rejected here; never reach the DB.
  function validateScanUrl(raw) {
    if (typeof raw !== "string") return null;
    let u;
    try { u = new URL(raw.trim()); } catch (_) { return null; }
    if (u.protocol  !== "https:")        return null;  // HTTPS only
    if (u.hostname  !== VERIFY_HOST)     return null;  // our domain only
    if (u.pathname  !== VERIFY_PATHNAME) return null;  // exact path match
    const no  = u.searchParams.get("no");
    const tok = u.searchParams.get("tok");
    if (!no  || !/^\d{1,10}$/.test(no))       return null;  // numeric receipt no
    if (!tok || !/^[0-9a-f]{32}$/i.test(tok)) return null;  // 32-char hex token
    if ([...u.searchParams.keys()].length > 2) return null;  // no extra params
    return { no, tok };
  }

  async function lookupReceipt(no, tok) {
    const snap = await getDoc(doc(db, "verifications", no));
    if (!snap.exists()) return { ok: false, msg: `Receipt #${no} not found in records.` };
    const d = snap.data();
    if (d.tok !== tok) return { ok: false, msg: "Token mismatch — this receipt may have been altered." };
    return { ok: true, data: d };
  }

  function esc2(s) {
    return String(s || "").replace(/&/g,"&amp;").replace(/</g,"&lt;").replace(/>/g,"&gt;");
  }

  function showResult(el, result) {
    if (!result.ok) {
      el.innerHTML = `
        <div class="scan-result fail">
          <div class="scan-icon">&#10007;</div>
          <strong>Verification Failed</strong>
          <p>${result.msg}</p>
        </div>`;
      return;
    }
    const d   = result.data;
    const amt = "K " + parseFloat(d.amount || 0).toFixed(2);
    el.innerHTML = `
      <div class="scan-result ok">
        <div class="scan-icon">&#10003;</div>
        <strong>Receipt Verified</strong>
        <table class="scan-table">
          <tr><td>Student</td><td><strong>${esc2(d.studentName)}</strong></td></tr>
          <tr><td>Comp #</td><td>${esc2(d.compNumber)}</td></tr>
          <tr><td>Category</td><td>${esc2(d.category)}</td></tr>
          <tr><td>Amount</td><td><strong>${esc2(amt)}</strong></td></tr>
          <tr><td>Receipt #</td><td>${d.receiptNo}</td></tr>
          <tr><td>Confirmed by</td><td>${esc2(d.reviewerName)} (${esc2(d.reviewerPosition)})</td></tr>
        </table>
      </div>`;
  }

  const modal    = document.getElementById("scannerModal");
  const resultEl = document.getElementById("scanResult");
  let   scanner  = null;

  function openModal() {
    modal.classList.remove("hidden");
    resultEl.innerHTML = "";
    document.getElementById("qr-reader").innerHTML = "";

    if (!window.Html5Qrcode) {
      resultEl.innerHTML = `<p class="error">QR library not loaded. Please reload the page.</p>`;
      return;
    }

    scanner = new window.Html5Qrcode("qr-reader");
    scanner.start(
      { facingMode: "environment" },
      { fps: 10, qrbox: { width: 240, height: 240 } },
      async (raw) => {
        try { await scanner.stop(); } catch (_) {}
        scanner = null;

        const parsed = validateScanUrl(raw);
        if (!parsed) {
          resultEl.innerHTML = `
            <div class="scan-result fail">
              <div class="scan-icon">&#9888;</div>
              <strong>Security Alert: Invalid QR Code</strong>
              <p>This QR code does not match a UZES receipt. Scan aborted.</p>
            </div>`;
          return;
        }

        resultEl.innerHTML = `<p class="muted" style="text-align:center;padding:12px 0">Verifying…</p>`;
        const result = await lookupReceipt(parsed.no, parsed.tok).catch(err => ({
          ok: false, msg: "Lookup error: " + err.message
        }));
        showResult(resultEl, result);
      },
      () => {}
    ).catch(err => {
      scanner = null; // never started — prevent closeModal() from calling stop() on a dead scanner
      resultEl.innerHTML = `<p class="error">Camera error: ${err}.<br>Grant camera permission and try again.</p>`;
    });
  }

  function closeModal() {
    if (scanner) { scanner.stop().catch(() => {}); scanner = null; }
    modal.classList.add("hidden");
  }

  const verifyBtn = document.getElementById("verifyBtn");
  verifyBtn.style.display = "";   // reveal — was hidden until role confirmed
  verifyBtn.addEventListener("click", openModal);
  document.getElementById("closeScannerBtn").addEventListener("click", closeModal);
  modal.addEventListener("click", e => { if (e.target === modal) closeModal(); });
  document.addEventListener("keydown", e => { if (e.key === "Escape") closeModal(); });
}

// ── Secretary General — Company Placements tab ────────────────────────────────
const SG_DEPARTMENTS = [
  "Electrical and Electronic Engineering",
  "Mechanical Engineering",
  "Civil and Environmental Engineering",
  "Computer Science and Engineering",
  "Chemical Engineering and Food Technology",
  "Agricultural Engineering",
  "Survey Engineering",
];

function sgEsc(s) {
  return String(s ?? "").replace(/&/g,"&amp;").replace(/</g,"&lt;").replace(/>/g,"&gt;").replace(/"/g,"&quot;");
}

function initSGPlacements() {
  sgInitDeptGrid();
  // Eager-load all three panels so data is ready when the user clicks any sub-tab
  sgLoadVacancies();
  sgLoadTSReview();
  sgLoadConfirmedPlacements();

  // Wire ses-tabs: Vacancies | Pending Review | Confirmed
  const sgTabs   = document.querySelectorAll('#tab-placements .ses-tab');
  const sgPanels = document.querySelectorAll('#tab-placements .ses-panel');
  sgTabs.forEach(btn => {
    btn.addEventListener('click', () => {
      const target = btn.dataset.ses;
      sgTabs.forEach(t   => t.classList.toggle('active', t.dataset.ses === target));
      sgPanels.forEach(p => p.classList.toggle('hidden', p.id !== target));
      if (target === 'sg-pending')   sgLoadTSReview();
      if (target === 'sg-confirmed') sgLoadConfirmedPlacements();
    });
  });

  const form = document.getElementById("sgAddVacancyForm");
  if (!form) return;
  form.addEventListener("submit", async e => {
    e.preventDefault();
    const errEl = document.getElementById("sgAddVacancyErr");
    const btn   = document.getElementById("sgAddVacancyBtn");
    const msg   = document.getElementById("sgAddVacancyMsg");
    errEl.textContent = ""; msg.textContent = "";
    const province = document.getElementById("sgVacProvince").value;
    if (!province) { errEl.textContent = "Select a province."; return; }
    const district = document.getElementById("sgVacDistrict").value.trim();
    if (!district) { errEl.textContent = "Enter a district."; return; }
    const departmentsRequired = {};
    const slotsRemaining = {};
    document.querySelectorAll("#sgDeptSlotsGrid input[data-dept]").forEach(inp => {
      const slots = parseInt(inp.value, 10) || 0;
      if (slots > 0) {
        const dept = inp.dataset.dept;
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
        companyName:      document.getElementById("sgVacCompany").value.trim(),
        type:             document.getElementById("sgVacType").value,
        province,
        district,
        genderPreference: document.getElementById("sgVacGender").value,
        acceptMode:       document.getElementById("sgVacAcceptMode").value,
        startDate:        document.getElementById("sgVacStartDate").value || "",
        endDate:          document.getElementById("sgVacEndDate").value   || "",
        departmentsRequired,
        slotsRemaining,
        status:           "open",
        createdAt:        serverTimestamp(),
        createdBy:        currentUser.uid
      });
      e.target.reset();
      sgInitDeptGrid();
      msg.textContent = "Vacancy added.";
      setTimeout(() => { msg.textContent = ""; }, 3000);
      sgLoadVacancies();
    } catch (err) {
      errEl.textContent = err.message;
    } finally {
      btn.disabled = false; btn.textContent = "Add vacancy";
    }
  });
}

function sgInitDeptGrid() {
  const grid = document.getElementById("sgDeptSlotsGrid");
  if (!grid) return;
  grid.innerHTML = SG_DEPARTMENTS.map(dept => `
    <div style="display:flex;align-items:center;gap:8px">
      <label style="font-size:12px;font-weight:600;flex:1">${sgEsc(dept)}</label>
      <input type="number" min="0" value="0" data-dept="${sgEsc(dept)}"
        style="width:64px;padding:7px 8px;font-size:14px;border:1px solid var(--line);border-radius:8px;text-align:center">
    </div>`).join("");
}

async function sgLoadVacancies() {
  const list = document.getElementById("sgVacancyList");
  if (!list) return;
  list.innerHTML = "<p class='muted small'>Loading…</p>";
  try {
    const snap = await getDocs(query(collection(db, "vacancies"), orderBy("createdAt", "desc")));
    if (snap.empty) {
      list.innerHTML = "<p class='muted small'>No vacancies yet. Add one below.</p>"; return;
    }
    list.innerHTML = snap.docs.map(d => sgRenderVacancyCard(d.id, d.data())).join("");
  } catch (err) {
    list.innerHTML = `<p class='error'>Failed to load: ${err.message}</p>`;
  }
}

function sgRenderVacancyCard(id, v) {
  const required  = Object.values(v.departmentsRequired || {}).reduce((s, n) => s + n, 0);
  const remaining = Object.values(v.slotsRemaining || {}).reduce((s, n) => s + n, 0);
  const deptLines = Object.entries(v.slotsRemaining || {}).map(([d, n]) => `${sgEsc(d)}: ${n}`).join(" · ");
  const statusBg  = remaining === 0 ? "#1e8a4c" : "#e67e22";
  const statusTxt = remaining === 0 ? "FULL" : `${remaining}/${required} OPEN`;
  return `<div class="pay-card" style="margin-bottom:10px">
    <div class="pay-card-head">
      <div>
        <div class="student-name">${sgEsc(v.companyName)}</div>
        <div class="pay-card-body" style="margin-top:4px">
          <span class="pay-detail"><span class="detail-label">Location</span>${sgEsc(v.province)} · ${sgEsc(v.district)}</span>
          <span class="pay-detail"><span class="detail-label">Type</span>${sgEsc(v.type)}</span>
          <span class="pay-detail"><span class="detail-label">Gender pref</span>${sgEsc(v.genderPreference || "All")}</span>
          <span class="pay-detail"><span class="detail-label">Accept mode</span>${v.acceptMode === "auto" ? "Auto-confirm" : "Manual review"}</span>
          ${v.startDate ? `<span class="pay-detail"><span class="detail-label">Period</span>${sgEsc(v.startDate)} → ${sgEsc(v.endDate || "—")}</span>` : ""}
          ${deptLines ? `<span class="pay-detail"><span class="detail-label">Slots</span><span style="font-size:11px">${deptLines}</span></span>` : ""}
        </div>
      </div>
      <span class="status-pill" style="background:${statusBg}">${statusTxt}</span>
    </div>
    <div class="pay-card-actions" style="flex-direction:row;flex-wrap:wrap;align-items:center;gap:8px">
      <button class="btn-confirm" style="padding:8px 18px;font-size:13px" id="sg-assign-${id}" onclick="sgAssignVacancy('${id}')">Assign Now</button>
      <button class="btn-danger-sm" style="font-size:12px;padding:6px 12px" onclick="sgDeleteVacancy('${id}')">Delete</button>
      <p id="sg-assign-err-${id}" class="action-err" style="width:100%;margin:2px 0 0"></p>
    </div>
  </div>`;
}

window.sgAssignVacancy = async (vacancyId) => {
  const btn   = document.getElementById(`sg-assign-${vacancyId}`);
  const errEl = document.getElementById(`sg-assign-err-${vacancyId}`);
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
    setTimeout(() => sgLoadVacancies(), 2000);
  } catch (err) {
    if (errEl) errEl.textContent = "Error: " + err.message;
    if (btn)   { btn.disabled = false; btn.textContent = "Assign Now"; }
  }
};

window.sgDeleteVacancy = async (vacancyId) => {
  if (!confirm("Delete this vacancy? Matched students will NOT be automatically unmatched.")) return;
  try {
    await deleteDoc(doc(db, "vacancies", vacancyId));
    sgLoadVacancies();
  } catch (err) {
    alert("Delete failed: " + err.message);
  }
};

// ── SG Pending Review ─────────────────────────────────────────────────────────
async function sgLoadTSReview() {
  const list = document.getElementById("sgTsReviewList");
  if (!list) return;
  list.innerHTML = "<p class='muted small'>Loading…</p>";
  try {
    const snap = await getDocs(
      query(collection(db, "placements"), where("placementStatus", "==", "awaiting_ts_approval"))
    );
    if (snap.empty) { list.innerHTML = "<p class='muted small'>No placements awaiting review.</p>"; return; }
    const vacancyIds = [...new Set(snap.docs.map(d => d.data().matchedCompanyId).filter(Boolean))];
    const vacancyMap = {};
    await Promise.all(vacancyIds.map(async id => {
      const v = await getDoc(doc(db, "vacancies", id));
      if (v.exists()) vacancyMap[id] = v.data();
    }));
    const cards = await Promise.all(snap.docs.map(async d => {
      const placement = d.data();
      const uid = d.id;
      let student = {};
      try { const s = await getDoc(doc(db, "students", uid)); if (s.exists()) student = s.data(); } catch (_) {}
      const company = vacancyMap[placement.matchedCompanyId] || {};
      const cvLink = placement.cvUrl
        ? `<a href="${sgEsc(placement.cvUrl)}" target="_blank" class="btn-ghost" style="font-size:12px;padding:7px 14px;text-decoration:none;display:inline-flex;align-items:center;gap:4px">📄 REVIEW CV</a>`
        : "";
      return `<div class="req-card" style="margin-bottom:10px">
        <div class="req-card-head">
          <div>
            <div class="req-name">${sgEsc(student.name || uid)}</div>
            <div class="req-meta">
              <span>${sgEsc(student.compNumber || "")} · ${sgEsc(student.department || "")} · Year ${sgEsc(student.yearOfStudy || "?")}</span>
              <span>Company: <strong>${sgEsc(company.companyName || placement.matchedCompanyId)}</strong> · ${sgEsc(company.province || "")} · ${sgEsc(company.type || "")}</span>
            </div>
          </div>
          <span class="status-pill" style="background:#e67e22">AWAITING REVIEW</span>
        </div>
        ${cvLink ? `<div style="display:flex;justify-content:flex-end;padding:6px 0 4px">${cvLink}</div>` : ""}
        <div class="req-actions">
          <button class="btn-approve" id="sg-ts-approve-${uid}" onclick="sgApprovePlacement('${uid}')">Approve &amp; Send Letter</button>
          <button class="btn-danger-sm" id="sg-ts-reject-${uid}" onclick="sgRejectPlacement('${uid}')">Reject (no penalty)</button>
          <p id="sg-ts-err-${uid}" class="action-err" style="width:100%;margin:4px 0 0"></p>
        </div>
      </div>`;
    }));
    list.innerHTML = cards.join("");
  } catch (err) {
    list.innerHTML = `<p class='error'>Failed to load: ${err.message}</p>`;
  }
}

window.sgApprovePlacement = async (uid) => {
  const btn   = document.getElementById(`sg-ts-approve-${uid}`);
  const errEl = document.getElementById(`sg-ts-err-${uid}`);
  if (btn) { btn.disabled = true; btn.textContent = "Approving…"; }
  if (errEl) errEl.textContent = "";
  try {
    const placementSnap = await getDoc(doc(db, "placements", uid));
    if (!placementSnap.exists()) throw new Error("Placement not found.");
    const placement = placementSnap.data();
    const [studentSnap, companySnap, templSnap] = await Promise.all([
      getDoc(doc(db, "students", uid)),
      getDoc(doc(db, "vacancies", placement.matchedCompanyId)),
      getDoc(doc(db, "siteContent", "placementLetterTemplates")),
    ]);
    const student = studentSnap.exists() ? studentSnap.data() : {};
    const company = companySnap.exists() ? companySnap.data() : {};
    let templateDocUrl = "";
    if (templSnap.exists()) {
      const t = templSnap.data();
      templateDocUrl = company.type === "Internship" ? (t.internshipDocUrl || "") : (t.attachmentDocUrl || "");
    }
    // Update Firestore FIRST — email is best-effort.
    await updateDoc(doc(db, "placements", uid), {
      placementStatus: "confirmed",
      approvalMethod:  "manual",
      tsReviewerId:    currentUser.uid,
      tsReviewerName:  currentProfile?.name || currentUser.email || "",
      approvedAt:      serverTimestamp(),
      cvUrl: ""
    });

    // Immediate UI feedback before async list refresh
    const card = btn?.closest(".req-card");
    if (card) card.innerHTML = `<div style="padding:12px 14px;color:var(--ok);font-weight:600">✓ Placement confirmed — letter being sent to ${sgEsc(student.email || "student")}.</div>`;

    if (student.fcmToken) sendPush(student.fcmToken, "Placement Confirmed!", `Your ${company.type || "industrial"} placement at ${company.companyName || "a company"} has been confirmed.`);
    fetch(UPLOAD_WORKER_URL + "/send-email", {
      method: "POST",
      headers: { "Content-Type": "application/json", ...await authHeaders() },
      body: JSON.stringify({
        type: "placement_letter",
        to: student.email || "", studentName: student.name || "",
        studentNumber: student.compNumber || "", department: student.department || "",
        yearOfStudy: student.yearOfStudy || "", gender: student.gender || "",
        phone: placement.phone || student.phone || "",
        companyName: company.companyName || "", province: company.province || "",
        district: company.district || "", placementType: company.type || "",
        himselfHerself: student.gender === "Male" ? "himself" : "herself",
        startDate: company.startDate || "",
        endDate: company.endDate || "",
        templateDocUrl, customFields: placement.customFields || {}
      })
    });
    // Background refresh — failure OK since card already shows ✓
    sgLoadTSReview().catch(() => {});
    sgLoadVacancies();
    // If confirmed tab is currently open, refresh it to show the new record
    const sgConfTab = document.getElementById("sg-confirmed");
    if (sgConfTab && !sgConfTab.classList.contains("hidden")) sgLoadConfirmedPlacements();
  } catch (err) {
    if (errEl) errEl.textContent = err.message;
    if (btn)   { btn.disabled = false; btn.textContent = "Approve & Send Letter"; }
  }
};

window.sgRejectPlacement = async (uid) => {
  if (!confirm("Return this student to pending? They will NOT receive a rejection penalty and can be matched again.")) return;
  const btn   = document.getElementById(`sg-ts-reject-${uid}`);
  const errEl = document.getElementById(`sg-ts-err-${uid}`);
  if (btn) { btn.disabled = true; btn.textContent = "Rejecting…"; }
  if (errEl) errEl.textContent = "";
  try {
    const placementSnap = await getDoc(doc(db, "placements", uid));
    if (!placementSnap.exists()) throw new Error("Placement not found.");
    const placement = placementSnap.data();
    // Restore the slot for the student's own department
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
      matchedCompanyId: null, matchedAt: null, customFields: null
    });
    sgLoadTSReview();
    sgLoadVacancies();
  } catch (err) {
    if (errEl) errEl.textContent = err.message;
    if (btn)   { btn.disabled = false; btn.textContent = "Reject (no penalty)"; }
  }
};

// ── SG Confirmed Placements ───────────────────────────────────────────────────
async function sgLoadConfirmedPlacements() {
  const list = document.getElementById("sgConfirmedList");
  if (!list) return;
  list.innerHTML = "<p class='muted'>Loading…</p>";

  try {
    const snap = await getDocs(query(collection(db, "placements"), where("placementStatus", "==", "confirmed")));
    if (snap.empty) { list.innerHTML = "<p class='muted'>No confirmed placements yet.</p>"; return; }
    const docs = snap.docs.slice().sort((a, b) => (b.data().approvedAt?.seconds ?? 0) - (a.data().approvedAt?.seconds ?? 0));
    const vacancyIds = [...new Set(docs.map(d => d.data().matchedCompanyId).filter(Boolean))];
    const vacancyMap = {};
    await Promise.all(vacancyIds.map(async id => {
      const v = await getDoc(doc(db, "vacancies", id));
      if (v.exists()) vacancyMap[id] = v.data();
    }));
    const cards = await Promise.all(docs.map(async d => {
      const p = d.data(); const uid = d.id;
      let student = {};
      try { const s = await getDoc(doc(db, "students", uid)); if (s.exists()) student = s.data(); } catch (_) {}
      const company = vacancyMap[p.matchedCompanyId] || {};
      const date = p.approvedAt?.toDate().toLocaleDateString("en-ZM", { day:"2-digit", month:"short", year:"numeric" }) || "—";
      const methodBadge = p.approvalMethod === "auto"
        ? `<span class="status-pill" style="background:#2563eb">AUTO</span>`
        : `<span class="status-pill" style="background:#1e8a4c">MANUAL</span>`;
      const reviewer = p.approvalMethod === "manual" && p.tsReviewerName
        ? `<span>Reviewed by: <strong>${sgEsc(p.tsReviewerName)}</strong></span>` : "";
      return `<div class="req-card" style="margin-bottom:10px">
        <div class="req-card-head">
          <div>
            <div class="req-name">${sgEsc(student.name || uid)}</div>
            <div class="req-meta">
              <span>${sgEsc(student.compNumber || "")} · ${sgEsc(student.department || "")} · Year ${sgEsc(student.yearOfStudy || "?")}</span>
              <span>Company: <strong>${sgEsc(company.companyName || p.matchedCompanyId || "—")}</strong> · ${sgEsc(company.province || "")} · ${sgEsc(company.type || "")}</span>
              ${reviewer}<span>Confirmed: ${date}</span>
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
