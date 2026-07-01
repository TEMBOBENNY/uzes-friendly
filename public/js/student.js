import { auth, db } from "./firebase.js";
import { protect } from "./guard.js";
import {
  collection, doc, addDoc, getDocs, getDoc, setDoc, updateDoc, deleteDoc, onSnapshot, query,
  where, orderBy, serverTimestamp
} from "https://www.gstatic.com/firebasejs/10.12.2/firebase-firestore.js";
import { uploadProof, authHeaders } from "./upload.js";
import { initSubHero } from "./subhero.js?v=4";
import { studentTabs } from "./nav.js?v=2";
import { initLibrary } from "./library.js?v=12";
import { initAttachment } from "./attachment.js?v=2";
import { initPlacement } from "./placement.js?v=2";
import { registerFCMToken } from "./fcm.js";
import { UPLOAD_WORKER_URL } from "./config.js";

const METHODS = ["Airtel Money", "MTN Money", "Zamtel Money", "Zed Mobile", "Cash"];
const CATEGORIES = ["Membership Dues", "Event Fee", "Fine", "Subscription", "Other"];
// 5th Year/Graduate students are ineligible to contest (constitution Art. 9) so the
// EC Nomination Fee option never appears for them — no shared constants.js exists
// in this codebase, so this stays a local inline check (each page keeps its own copy).
const EC_INELIGIBLE_YEARS = ["5th Year", "Graduate"];

// ── DOM refs ──────────────────────────────────────────────────────────────────
const payForm     = document.getElementById("payForm");
const methodSel   = document.getElementById("method");
const refRow      = document.getElementById("refRow");
const proofInput  = document.getElementById("proof");
const proofLabel  = document.getElementById("proofLabel");
const submitBtn   = document.getElementById("submitBtn");
const formErr     = document.getElementById("formErr");
const formOk      = document.getElementById("formOk");
const historyList = document.getElementById("historyList");

let currentUser, currentProfile;

// Event delegation (onclick attrs removed for CSP compliance)
document.addEventListener("click", e => {
  const tab = e.target.closest("[data-show-tab]");
  if (tab) { window.shShowTab?.(tab.dataset.showTab); return; }
  const vp = e.target.closest("[data-action='st:view-proof']");
  if (vp) window.viewProof(vp.dataset.url);
});

// ── Bootstrap ─────────────────────────────────────────────────────────────────
protect(["student"], (user, profile) => {
  currentUser = user; currentProfile = profile;
  registerFCMToken(user.uid, "students").catch(() => {});

  // Lazy-init library, attachment, placement, and elections on first tab open
  let libInited = false, attInited = false, placeInited = false, electionInited = false;
  window.shOnTab = async (id) => {
    if (id === "tab-lib" && !libInited) {
      libInited = true;
      try { await initLibrary(currentUser, currentProfile); }
      catch (e) {
        const el = document.getElementById("browseContainer");
        if (el) el.innerHTML = `<p class="error">Library failed to load: ${e.message}</p>`;
      }
    } else if (id === "tab-attach" && !attInited) {
      attInited = true;
      try { await initAttachment(currentUser, currentProfile); }
      catch (e) {
        const el = document.getElementById("attLoading");
        if (el) el.innerHTML = `<p class="error">Attachment failed to load: ${e.message}</p>`;
      }
    } else if (id === "tab-placement" && !placeInited) {
      placeInited = true;
      try { await initPlacement(currentUser, currentProfile); }
      catch (e) {
        const el = document.getElementById("tab-placement");
        if (el) el.innerHTML = `<p class="error">Placement failed to load: ${e.message}</p>`;
      }
    } else if (id === "tab-election" && !electionInited) {
      electionInited = true;
      try { await initElection(currentUser, currentProfile); }
      catch (e) {
        const el = document.getElementById("electionContent");
        document.getElementById("electionLoading").style.display = "none";
        if (el) { el.style.display = ""; el.innerHTML = `<p class="error">Elections failed to load: ${e.message}</p>`; }
      }
    }
  };

  // Open the tab named in the URL hash (e.g. student.html#tab-fin)
  const hash = location.hash.replace("#", "");
  const active = hash && document.getElementById(hash) ? hash : "tab-dash";

  initSubHero(user, profile, { page: "student", active, tabs: studentTabs("student") });

  buildSelects();
  initFinTabs();
  renderDashboard();
  loadHistory();
});

// ── Dashboard ─────────────────────────────────────────────────────────────────
async function renderDashboard() {
  const firstName = (currentProfile.name || "student").split(" ")[0];
  const hour = new Date().getHours();
  const greeting = hour < 12 ? "Good morning" : hour < 17 ? "Good afternoon" : "Good evening";
  document.getElementById("dashName").textContent = `${greeting}, ${firstName}`;

  const p = currentProfile;

  // Check whether admin has opened a year-of-study edit window
  let yearUpdateActive = false, yearUpdateStartedAt = null;
  try {
    const yuSnap = await getDoc(doc(db, "siteSettings", "yearUpdate"));
    if (yuSnap.exists()) {
      const yu = yuSnap.data();
      yearUpdateActive    = yu.active === true;
      yearUpdateStartedAt = yu.startedAt || null;
    }
  } catch (_) {}

  // Student can edit year if flag is active AND they haven't updated this cycle
  const canEditYear = yearUpdateActive && (
    !p.yearUpdatedAt ||
    (yearUpdateStartedAt && p.yearUpdatedAt.seconds < yearUpdateStartedAt.seconds)
  );

  const readOnlyFields = [
    ["Full name",    p.name],
    ["Comp / Reg #", p.compNumber],
    ["Email",        p.email || currentUser.email],
    ["Gender",       p.gender],
    ["Department",   p.department || p.school],
  ];

  const yearRow = `
    <div class="dash-info-item" style="grid-column:1/-1">
      <span class="dash-info-label">Year of study</span>
      <div id="yearDisplay" style="display:flex;align-items:center;gap:8px">
        <span class="dash-info-val" id="yearVal">${esc(p.yearOfStudy || "—")}</span>
        ${canEditYear ? `<button id="yearEditBtn" class="btn-ghost" style="padding:3px 10px;font-size:12px">Edit</button>` : ""}
      </div>
      <div id="yearEditForm" style="display:none;margin-top:8px">
        <select id="yearInput" style="width:auto;font-size:14px;padding:7px 10px">
          ${["1st Year","2nd Year","3rd Year","4th Year","5th Year","Graduate"].map(y =>
            `<option value="${y}"${p.yearOfStudy === y ? " selected" : ""}>${y}</option>`
          ).join("")}
        </select>
        <button id="yearSaveBtn" class="btn-primary" style="width:auto;padding:7px 16px;margin-top:0;font-size:13px;margin-left:8px">Save</button>
        <button id="yearCancelBtn" class="btn-ghost" style="padding:7px 12px;font-size:13px;margin-left:4px">Cancel</button>
        <p id="yearErr" class="error" style="font-size:12px;margin-top:4px"></p>
      </div>
    </div>`;

  const phoneRow = `
    <div class="dash-info-item" style="grid-column:1/-1">
      <span class="dash-info-label">Phone</span>
      <div id="phoneDisplay" style="display:flex;align-items:center;gap:8px">
        <span class="dash-info-val" id="phoneVal">${esc(p.phone || "—")}</span>
        <button id="phoneEditBtn" class="btn-ghost" style="padding:3px 10px;font-size:12px">Edit</button>
      </div>
      <div id="phoneEditForm" style="display:none;margin-top:8px">
        <input id="phoneInput" type="tel" value="${esc(p.phone || "")}" placeholder="+260 97 123 4567"
          style="display:inline-block;width:auto;max-width:200px;font-size:14px;padding:7px 10px">
        <button id="phoneSaveBtn" class="btn-primary" style="width:auto;padding:7px 16px;margin-top:0;font-size:13px;margin-left:8px">Save</button>
        <button id="phoneCancelBtn" class="btn-ghost" style="padding:7px 12px;font-size:13px;margin-left:4px">Cancel</button>
        <p id="phoneErr" class="error" style="font-size:12px;margin-top:4px"></p>
      </div>
    </div>`;

  document.getElementById("dashInfo").innerHTML =
    readOnlyFields.map(([label, val]) => `
      <div class="dash-info-item">
        <span class="dash-info-label">${label}</span>
        <span class="dash-info-val">${esc(val || "—")}</span>
      </div>`).join("") + yearRow + phoneRow;

  // Wire year edit (only if unlocked)
  if (canEditYear) {
    document.getElementById("yearEditBtn").addEventListener("click", () => {
      document.getElementById("yearDisplay").style.display = "none";
      document.getElementById("yearEditForm").style.display = "block";
    });
    document.getElementById("yearCancelBtn").addEventListener("click", () => {
      document.getElementById("yearDisplay").style.display = "flex";
      document.getElementById("yearEditForm").style.display = "none";
    });
    document.getElementById("yearSaveBtn").addEventListener("click", async () => {
      const newYear = document.getElementById("yearInput").value;
      const btn = document.getElementById("yearSaveBtn");
      btn.disabled = true; btn.textContent = "Saving…";
      try {
        await updateDoc(doc(db, currentProfile.__collection || "students", currentUser.uid), {
          yearOfStudy: newYear, yearUpdatedAt: serverTimestamp()
        });
        currentProfile.yearOfStudy = newYear;
        document.getElementById("yearVal").textContent = newYear;
        document.getElementById("yearEditForm").style.display = "none";
        document.getElementById("yearDisplay").style.display = "flex";
        document.getElementById("yearEditBtn").remove(); // one edit only
      } catch (e) {
        document.getElementById("yearErr").textContent = "Save failed: " + e.message;
        btn.disabled = false; btn.textContent = "Save";
      }
    });
  }

  // Wire phone edit
  document.getElementById("phoneEditBtn").addEventListener("click", () => {
    document.getElementById("phoneDisplay").style.display = "none";
    document.getElementById("phoneEditForm").style.display = "block";
  });
  document.getElementById("phoneCancelBtn").addEventListener("click", () => {
    document.getElementById("phoneDisplay").style.display = "flex";
    document.getElementById("phoneEditForm").style.display = "none";
  });
  document.getElementById("phoneSaveBtn").addEventListener("click", async () => {
    const newPhone = document.getElementById("phoneInput").value.trim();
    const btn = document.getElementById("phoneSaveBtn");
    if (!newPhone) { document.getElementById("phoneErr").textContent = "Phone cannot be empty."; return; }
    btn.disabled = true; btn.textContent = "Saving…";
    try {
      await updateDoc(doc(db, currentProfile.__collection || "students", currentUser.uid), { phone: newPhone });
      currentProfile.phone = newPhone;
      document.getElementById("phoneVal").textContent = newPhone;
      document.getElementById("phoneDisplay").style.display = "flex";
      document.getElementById("phoneEditForm").style.display = "none";
      document.getElementById("phoneErr").textContent = "";
    } catch (e) {
      document.getElementById("phoneErr").textContent = "Save failed: " + e.message;
      btn.disabled = false; btn.textContent = "Save";
    }
  });

  loadMembership();
  loadDashboardMedia();
}

async function loadMembership() {
  const wrap = document.getElementById("dashMembershipWrap");
  let paid = false;
  try {
    const snap = await getDocs(query(
      collection(db, "payments"),
      where("studentUid", "==", currentUser.uid),
      where("category", "==", "Membership Dues"),
      where("status", "==", "confirmed")
    ));
    paid = !snap.empty;
  } catch (_) {}
  
  const ringColor = paid ? "#1e8a4c" : "#c0392b";
  const ringBg = paid ? "#e6f7ee" : "#fdf2f2";
  const ringBorder = paid ? "#a8e0c0" : "#f0c0bb";
  const label = paid ? "Paid up" : "Not paid";
  const sub = paid ? "Your membership is active" : "Pay Membership Dues to unlock all features";
  const progress = paid ? 100 : 0;
  const dashOffset = 283 - (283 * progress / 100); // 2*PI*45 ≈ 283

  wrap.innerHTML = `
    <div style="display:flex;align-items:center;gap:14px">
      <div class="membership-ring">
        <svg width="72" height="72" viewBox="0 0 72 72">
          <circle cx="36" cy="36" r="45" fill="none" stroke="${ringBorder}" stroke-width="6" class="membership-ring-bg"/>
          <circle cx="36" cy="36" r="45" fill="none" stroke="${ringColor}" stroke-width="6" class="membership-ring-fill"
            stroke-dasharray="283" stroke-dashoffset="${dashOffset}" stroke-linecap="round"/>
        </svg>
        <div class="membership-ring-text">${paid ? "✓" : "!"}</div>
      </div>
      <div>
        <div style="font-weight:700;font-size:14px;color:${ringColor}">${label}</div>
        <div style="font-size:12px;color:var(--muted)">${sub}</div>
      </div>
    </div>`;
}

async function loadDashboardMedia() {
  const media = document.getElementById("dashMedia");
  const cap   = document.getElementById("dashMediaCap");
  try {
    const snap = await getDoc(doc(db, "siteContent", "studentDashboard"));
    if (!snap.exists()) return;
    const d = snap.data();
    if (d.caption) cap.textContent = d.caption;
    if (!d.mediaUrl) return;

    if (d.mediaType === "youtube") {
      const id = ytId(d.mediaUrl);
      if (id) media.innerHTML = `<iframe src="https://www.youtube.com/embed/${id}" allowfullscreen></iframe>`;
    } else if (d.mediaType === "video") {
      media.innerHTML = `<video src="${esc(d.mediaUrl)}" controls></video>`;
    } else {
      media.innerHTML = `<img src="${esc(d.mediaUrl)}" alt="${esc(d.caption || "Dashboard")}">`;
    }
  } catch (_) {}
}

function ytId(url) {
  const m = String(url).match(/(?:youtu\.be\/|youtube\.com\/(?:watch\?v=|embed\/|shorts\/))([\w-]{11})/);
  return m ? m[1] : (/^[\w-]{11}$/.test(url) ? url : null);
}

// ── My Finance mini sub-tabs (submit / history) ───────────────────────────────
function initFinTabs() {
  const btns   = document.querySelectorAll(".fin-tab");
  const panels = document.querySelectorAll(".fin-panel");
  btns.forEach(btn => btn.addEventListener("click", () => {
    btns.forEach(b => b.classList.remove("active"));
    panels.forEach(p => p.classList.add("hidden"));
    btn.classList.add("active");
    document.getElementById(btn.dataset.fintab).classList.remove("hidden");
  }));
}

// ── Selects ───────────────────────────────────────────────────────────────────
// Cached so the submit handler knows which cycle an EC fee belongs to without a
// second query — refreshed each time buildCategorySelect() runs.
let _activeElectionCycle = null;

async function checkElectionNominationEligibility() {
  if (EC_INELIGIBLE_YEARS.includes(currentProfile.yearOfStudy)) return false;

  try {
    const cycleSnap = await getDocs(query(
      collection(db, "electionCycles"),
      where("status", "==", "active")
    ));
    if (cycleSnap.empty) { _activeElectionCycle = null; return false; }
    _activeElectionCycle = { id: cycleSnap.docs[0].id, ...cycleSnap.docs[0].data() };
    // Fees are only accepted while nominations are open — once campaigning starts
    // there is no point letting students submit a fee that can no longer be approved.
    if (_activeElectionCycle.phase !== "nominations") return false;
  } catch (_) { return false; }

  try {
    const paidSnap = await getDocs(query(
      collection(db, "payments"),
      where("studentUid", "==", currentUser.uid),
      where("category", "==", "Membership Dues"),
      where("status", "==", "confirmed")
    ));
    return !paidSnap.empty;
  } catch (_) { return false; }
}

async function buildCategorySelect() {
  const canNominate = await checkElectionNominationEligibility();
  const cats = canNominate ? [...CATEGORIES, "EC Nomination Fee"] : CATEGORIES;
  document.getElementById("category").innerHTML =
    cats.map(c => `<option value="${c}">${c}</option>`).join("");
}

function buildSelects() {
  methodSel.innerHTML = METHODS.map(m => `<option value="${m}">${m}</option>`).join("");
  buildCategorySelect();
  updateRefRow();
}

methodSel.addEventListener("change", updateRefRow);

function updateRefRow() {
  const needsRef = methodSel.value !== "Cash";
  refRow.style.display = needsRef ? "" : "none";
  document.getElementById("txRef").required = needsRef;
}

// ── File label ────────────────────────────────────────────────────────────────
proofInput.addEventListener("change", () => {
  proofLabel.textContent = proofInput.files[0]?.name || "Choose file…";
});
// Enable camera capture on mobile devices
if (proofInput && "capture" in document.createElement("input")) {
  proofInput.setAttribute("capture", "environment");
}

// ── Submit payment ────────────────────────────────────────────────────────────
payForm.addEventListener("submit", async (e) => {
  e.preventDefault();
  formErr.textContent = "";
  submitBtn.disabled = true; submitBtn.textContent = "Submitting…";

  try {
    const method  = methodSel.value;
    const txRef   = document.getElementById("txRef").value.trim();
    const amount  = parseFloat(document.getElementById("amount").value);
    const category = document.getElementById("category").value;
    const notes   = document.getElementById("notes").value.trim();
    const file    = proofInput.files[0];

    if (!file) throw new Error("Please attach proof of payment.");
    if (isNaN(amount) || amount <= 0) throw new Error("Enter a valid amount.");
    if (method !== "Cash" && !txRef) throw new Error("Enter the transaction / phone line reference.");

    submitBtn.textContent = "Uploading proof…";
    let proofUrl;
    try {
      proofUrl = await uploadProof(file, (pct) => {
        submitBtn.textContent = `Uploading… ${Math.round(pct * 100)}%`;
      });
    } catch (upErr) {
      throw new Error("Proof upload failed: " + upErr.message);
    }

    submitBtn.textContent = "Saving…";
    if (category === "EC Nomination Fee") {
      if (!_activeElectionCycle) throw new Error("No active election cycle — refresh the page and try again.");
      await addDoc(collection(db, "ecPayments"), {
        cycleId:      _activeElectionCycle.id,
        studentUid:   currentUser.uid,
        studentName:  currentProfile.name || "",
        compNumber:   currentProfile.compNumber || "",
        department:   currentProfile.department || currentProfile.school || "",
        yearOfStudy:  currentProfile.yearOfStudy || "",
        amount,
        method,
        txRef:        txRef || "",
        notes,
        proofUrl,
        status:       "pending",
        submittedAt:  serverTimestamp()
      });
    } else {
      await addDoc(collection(db, "payments"), {
        studentUid:    currentUser.uid,
        studentName:   currentProfile.name || "",
        compNumber:    currentProfile.compNumber || "",
        studentEmail:  currentUser.email,
        amount,
        amountInWords: toWords(amount),
        category,
        method,
        txRef:         txRef || "",
        notes,
        proofUrl,
        status:        "pending",
        submittedAt:   serverTimestamp()
      });
    }

    payForm.reset();
    proofLabel.textContent = "Choose file…";
    updateRefRow();
    if (typeof window.showToast === "function") {
      window.showToast({ type: "success", title: "Payment submitted", message: "An executive will verify it shortly." });
    }
    loadHistory();
    loadMembership();
    buildCategorySelect();
  } catch (err) {
    formErr.textContent = err.message;
  } finally {
    submitBtn.disabled = false; submitBtn.textContent = "Submit payment";
  }
});

// ── Payment history (real-time) ───────────────────────────────────────────────
let _historyUnsub = null;
let _paymentDocs = []; // cached for client-side filtering

function loadHistory() {
  historyList.innerHTML = `
    <div style="padding:20px 0">
      <div class="sk sk-title sk-w60"></div>
      <div class="sk sk-line sk-w90"></div>
      <div class="sk sk-line sk-w75"></div>
      <div class="sk sk-line sk-w90"></div>
    </div>`;
  if (_historyUnsub) _historyUnsub();
  const q = query(
    collection(db, "payments"),
    where("studentUid", "==", currentUser.uid),
    orderBy("submittedAt", "desc")
  );
  _historyUnsub = onSnapshot(q, (snap) => {
    _paymentDocs = snap.docs.map(d => ({ id: d.id, ...d.data() }));
    if (snap.empty) {
      historyList.innerHTML = `
        <div class="empty-state" style="padding:40px 24px">
          <div class="empty-state-icon">🧾</div>
          <h3>No payments yet</h3>
          <p class="muted">Submit your first payment in the <strong>Submit</strong> tab above.</p>
        </div>`;
      return;
    }
    renderHistoryList(_paymentDocs);
    // Refresh membership badge whenever a payment status changes
    loadMembership();
  }, (err) => {
    historyList.innerHTML = `<p class='error'>Failed to load: ${err.message}</p>`;
  });
}

function renderHistoryList(payments) {
  // Build search filter if not already present
  let searchBox = document.getElementById("paySearchBox");
  if (!searchBox) {
    searchBox = document.createElement("div");
    searchBox.id = "paySearchBox";
    searchBox.className = "search-box";
    searchBox.innerHTML = `<input type="text" id="paySearchInput" placeholder="Search by category, method, or status…">`;
    historyList.parentNode.insertBefore(searchBox, historyList);
    document.getElementById("paySearchInput").addEventListener("input", (e) => {
      const term = e.target.value.toLowerCase().trim();
      if (!term) { renderHistoryList(_paymentDocs); return; }
      const filtered = _paymentDocs.filter(p =>
        (p.category || "").toLowerCase().includes(term) ||
        (p.method || "").toLowerCase().includes(term) ||
        (p.status || "").toLowerCase().includes(term) ||
        (p.txRef || "").toLowerCase().includes(term)
      );
      renderHistoryList(filtered, true);
    });
  }

  if (!payments.length) {
    historyList.innerHTML = `<p class="muted" style="text-align:center;padding:24px">No matching payments found.</p>`;
    return;
  }

  historyList.innerHTML = payments.map(p => {
    const date = p.submittedAt?.toDate?.()
      ? p.submittedAt.toDate().toLocaleDateString("en-ZM", { day:"2-digit", month:"short", year:"numeric" })
      : "—";
    const statusColor = { pending:"#e67e22", confirmed:"#1e8a4c", rejected:"#c0392b" }[p.status] || "#555";
    return `<div class="pay-row">
      <div class="pay-main">
        <span class="pay-cat">${esc(p.category)}</span>
        <span class="pay-amt">K ${p.amount?.toFixed(2) ?? "0.00"}</span>
        <span class="pay-method muted small">${esc(p.method)}${p.txRef ? " · " + esc(p.txRef) : ""}</span>
      </div>
      <div class="pay-meta">
        <span class="muted small">${date}</span>
        <span class="status-pill" style="background:${statusColor}">${p.status?.toUpperCase?.() || "PENDING"}</span>
        ${p.status === "rejected" && p.rejectionReason
          ? `<span class="muted small">Reason: ${esc(p.rejectionReason)}</span>` : ""}
        ${p.status === "confirmed" && p.proofUrl
          ? `<button class="muted small" style="border:none;background:none;cursor:pointer;padding:0;font-size:inherit;color:var(--green);text-decoration:underline" data-action="st:view-proof" data-url="${esc(p.proofUrl)}">View proof</button>` : ""}
      </div>
    </div>`;
  }).join("");
}

// ── Elections ─────────────────────────────────────────────────────────────────
// Ballot positions (Constitution Art. 7) — same 8 as ec-chair.js's BALLOT_POSITIONS.
// No shared constants.js exists in this codebase, so each page keeps its own copy.
const BALLOT_POSITIONS = [
  "Chairperson", "Vice Chairperson", "Secretary General", "Vice Secretary General",
  "Treasurer", "Information and Publicity Secretary",
  "Social and Cultural Secretary", "Committee Member"
];

let _electionCycle = null;
let _electionContestants = [];
let _voterTurnout = null;
let _selections = {};
let _doneTabs = new Set();
let _activePosition = null;
let _currentMode = null;          // "campaigning" | "voting" | "revote"
let _currentRevotePosition = null;

function slug(s) { return String(s).replace(/[^a-z0-9]+/gi, "-").toLowerCase(); }

async function initElection(user, profile) {
  document.getElementById("electionLoading").style.display = "";
  document.getElementById("electionContent").style.display = "none";

  await loadElectionCycle();
  if (!_electionCycle) return showElectionGate("Elections are currently closed.");

  const paidUp = await isPaidUpMember(user);
  if (!paidUp && !_electionCycle.allowAllStudents) {
    return showElectionGate("Pay your membership dues to vote.");
  }

  if (_electionCycle.phase === "nominations") {
    return showElectionGate("Nominations are open. The candidate list will be available soon.");
  }

  await Promise.all([loadContestants(), loadVoterTurnout(user)]);

  const revote = _electionCycle.revote;
  if (revote?.active) {
    const alreadyRevoted = !!_voterTurnout?.revotes?.[revote.position];
    if (alreadyRevoted) {
      return showElectionGate(`You have already voted in the revote for ${revote.position}. Thank you for participating.`);
    }
    await loadSelectionsForMode("revote");
    return renderBallot({ mode: "revote", revotePosition: revote.position });
  }

  if (_voterTurnout?.mainRound) {
    return showElectionGate("You have already voted. Thank you for participating.");
  }

  if (_electionCycle.phase === "campaigning") {
    await loadSelectionsForMode("campaigning");
    return renderBallot({ mode: "campaigning" });
  }

  if (_electionCycle.phase === "voting") {
    await loadSelectionsForMode("voting");
    return renderBallot({ mode: "voting" });
  }

  // counting / published, no revote, never voted — nothing left to do
  return showElectionGate("Voting has closed for this election.");
}

async function isPaidUpMember(user) {
  try {
    const snap = await getDocs(query(
      collection(db, "payments"),
      where("studentUid", "==", user.uid),
      where("category", "==", "Membership Dues"),
      where("status", "==", "confirmed")
    ));
    return !snap.empty;
  } catch (_) { return false; }
}

async function loadElectionCycle() {
  try {
    const snap = await getDocs(query(collection(db, "electionCycles"), where("status", "==", "active")));
    _electionCycle = snap.empty ? null : { id: snap.docs[0].id, ...snap.docs[0].data() };
  } catch (_) { _electionCycle = null; }
}

async function loadContestants() {
  try {
    const snap = await getDocs(query(
      collection(db, "contestants"),
      where("cycleId", "==", _electionCycle.id),
      where("status", "==", "approved")
    ));
    _electionContestants = snap.docs.map(d => ({ id: d.id, ...d.data() }));
  } catch (_) { _electionContestants = []; }
}

async function loadVoterTurnout(user) {
  try {
    const snap = await getDoc(doc(db, "voterTurnout", user.uid));
    _voterTurnout = snap.exists() ? snap.data() : null;
  } catch (_) { _voterTurnout = null; }
}

// Campaigning and Voting both pre-load draftSelections (Voting lets the student
// edit them before final submit); Revote always starts blank for that one position.
async function loadSelectionsForMode(mode) {
  if (mode === "revote") { _selections = {}; _doneTabs = new Set(); return; }
  try {
    const snap = await getDoc(doc(db, "draftSelections", currentUser.uid));
    const draft = snap.exists() ? snap.data() : null;
    _selections = draft?.selections ? { ...draft.selections } : {};
  } catch (_) { _selections = {}; }
  _doneTabs = new Set(Object.keys(_selections));
}

function showElectionGate(message) {
  document.getElementById("electionLoading").style.display = "none";
  const contentEl = document.getElementById("electionContent");
  contentEl.style.display = "";
  contentEl.innerHTML = `<div class="elec-locked-msg"><p>${esc(message)}</p></div>`;
}

function renderBallot({ mode, revotePosition }) {
  _currentMode = mode;
  _currentRevotePosition = revotePosition || null;
  if (!_activePosition || (mode === "revote" && _activePosition !== revotePosition)) {
    _activePosition = mode === "revote" ? revotePosition : BALLOT_POSITIONS[0];
  }

  document.getElementById("electionLoading").style.display = "none";
  const contentEl = document.getElementById("electionContent");
  contentEl.style.display = "";

  const tabsHtml = BALLOT_POSITIONS.map(pos => {
    const locked = mode === "revote" && pos !== revotePosition;
    const hasCandidates = _electionContestants.some(c => c.position === pos);
    if (!hasCandidates && !locked) return ""; // skip positions with no contestants at all
    const activeClass = pos === _activePosition ? " active" : "";
    const doneClass = (!locked && _doneTabs.has(pos)) ? " done" : "";
    return `<button class="elec-postab${activeClass}${doneClass}" data-elec-pos="${pos}" ${locked ? "disabled" : ""}>${esc(pos)}</button>`;
  }).join("");

  const panelsHtml = BALLOT_POSITIONS.map(pos => {
    const locked = mode === "revote" && pos !== revotePosition;
    const hasCandidates = _electionContestants.some(c => c.position === pos);
    if (!hasCandidates && !locked) return "";
    const hiddenClass = pos === _activePosition ? "" : " hidden";
    return `<div class="elec-pospanel${hiddenClass}" id="elecpanel-${slug(pos)}">${locked ? renderLockedPanel() : renderPositionPanel(pos)}</div>`;
  }).join("");

  contentEl.innerHTML = `
    <div class="elec-postabs">${tabsHtml}</div>
    ${panelsHtml}
    <div id="elecConfirmPanel"></div>`;

  wireBallotTabs();
  renderConfirmPanel();
}

function renderLockedPanel() {
  return `<div class="elec-locked-msg"><p>Already voted.</p></div>`;
}

// Plan §3.2 — only flag as "Updated" once the edit is well after creation, so a
// contestant edited moments after being added (still mid-setup) isn't flagged.
function wasRecentlyUpdated(c) {
  const created = c.createdAt?.seconds ?? c.createdAt?.toDate?.()?.getTime() / 1000;
  const updated = c.updatedAt?.seconds ?? c.updatedAt?.toDate?.()?.getTime() / 1000;
  if (!created || !updated) return false;
  return updated > created + 5 * 60;
}

function renderPositionPanel(pos) {
  const candidates = _electionContestants.filter(c => c.position === pos);
  if (pos === "Committee Member") return renderCommitteePanel(candidates);

  const selected = _selections[pos];
  const cardsHtml = candidates.map(c => `
    <div class="contestant-card${selected === c.id ? " selected" : ""}" data-elec-select="${pos}" data-cid="${c.id}">
      <img class="contestant-photo" src="${esc(c.photoUrl || "")}" alt="${esc(c.studentName)}" onerror="this.style.visibility='hidden'">
      <div class="contestant-name">${esc(c.studentName)}</div>
      <div class="contestant-meta">${esc(c.compNumber)} · ${esc(c.department)}${wasRecentlyUpdated(c) ? " · Updated" : ""}</div>
      ${c.manifestoUrl ? `<div class="contestant-select"><a href="${esc(c.manifestoUrl)}" target="_blank" rel="noopener" class="btn-ghost" style="font-size:11px;padding:5px 10px;text-decoration:none;display:inline-block" onclick="event.stopPropagation()">View Manifesto</a></div>` : ""}
      <div class="contestant-select">${selected === c.id ? "● Selected" : "○ Select"}</div>
    </div>`).join("");

  return `
    <div class="contestant-grid">${cardsHtml}</div>
    <button class="btn-primary elec-done-btn" data-elec-done="${pos}" ${selected ? "" : "disabled"}>Done</button>`;
}

function renderCommitteePanel(candidates) {
  const max = Math.min(3, candidates.length);
  const selectedArr = Array.isArray(_selections["Committee Member"]) ? _selections["Committee Member"] : [];
  const cardsHtml = candidates.map(c => {
    const checked = selectedArr.includes(c.id);
    return `<div class="contestant-card${checked ? " selected" : ""}" data-elec-committee-toggle="${c.id}">
      <img class="contestant-photo" src="${esc(c.photoUrl || "")}" alt="${esc(c.studentName)}" onerror="this.style.visibility='hidden'">
      <div class="contestant-name">${esc(c.studentName)}</div>
      <div class="contestant-meta">${esc(c.compNumber)} · ${esc(c.department)}${wasRecentlyUpdated(c) ? " · Updated" : ""}</div>
      ${c.manifestoUrl ? `<div class="contestant-select"><a href="${esc(c.manifestoUrl)}" target="_blank" rel="noopener" class="btn-ghost" style="font-size:11px;padding:5px 10px;text-decoration:none;display:inline-block" onclick="event.stopPropagation()">View Manifesto</a></div>` : ""}
      <div class="contestant-select">${checked ? "☑ Selected" : "☐ Select"}</div>
    </div>`;
  }).join("");

  return `
    <p style="font-weight:600;font-size:13px;margin-bottom:10px">Committee Members (${selectedArr.length}/${max} selected)</p>
    <div class="contestant-grid">${cardsHtml}</div>
    <p id="elecCommitteeErr" class="error" style="min-height:16px"></p>
    <button class="btn-primary elec-done-btn" data-elec-done="Committee Member" ${selectedArr.length === max ? "" : "disabled"}>Done</button>`;
}

function wireBallotTabs() {
  const contentEl = document.getElementById("electionContent");

  contentEl.querySelectorAll("[data-elec-pos]").forEach(btn => {
    btn.addEventListener("click", () => {
      if (btn.disabled) return;
      _activePosition = btn.dataset.elecPos;
      contentEl.querySelectorAll("[data-elec-pos]").forEach(b => b.classList.toggle("active", b === btn));
      contentEl.querySelectorAll(".elec-pospanel").forEach(p => p.classList.add("hidden"));
      const panel = document.getElementById(`elecpanel-${slug(_activePosition)}`);
      if (panel) panel.classList.remove("hidden");
    });
  });

  contentEl.querySelectorAll("[data-elec-select]").forEach(card => {
    card.addEventListener("click", () => {
      _selections[card.dataset.elecSelect] = card.dataset.cid;
      renderBallot({ mode: _currentMode, revotePosition: _currentRevotePosition });
    });
  });

  contentEl.querySelectorAll("[data-elec-committee-toggle]").forEach(card => {
    card.addEventListener("click", () => {
      const cid = card.dataset.elecCommitteeToggle;
      const candidates = _electionContestants.filter(c => c.position === "Committee Member");
      const max = Math.min(3, candidates.length);
      let arr = Array.isArray(_selections["Committee Member"]) ? [..._selections["Committee Member"]] : [];
      if (arr.includes(cid)) {
        arr = arr.filter(id => id !== cid);
      } else if (arr.length >= max) {
        const errEl = document.getElementById("elecCommitteeErr");
        if (errEl) errEl.textContent = `You can only select ${max} candidate${max === 1 ? "" : "s"}.`;
        return;
      } else {
        arr.push(cid);
      }
      _selections["Committee Member"] = arr;
      renderBallot({ mode: _currentMode, revotePosition: _currentRevotePosition });
    });
  });

  contentEl.querySelectorAll("[data-elec-done]").forEach(btn => {
    btn.addEventListener("click", async () => {
      _doneTabs.add(btn.dataset.elecDone);
      await persistSelections();
      renderBallot({ mode: _currentMode, revotePosition: _currentRevotePosition });
    });
  });
}

async function persistSelections() {
  if (_currentMode !== "campaigning") return;
  try {
    await setDoc(doc(db, "draftSelections", currentUser.uid), {
      cycleId: _electionCycle.id,
      selections: _selections,
      updatedAt: serverTimestamp()
    });
  } catch (_) { /* best-effort — student can re-press Done to retry */ }
}

function renderConfirmPanel() {
  const panel = document.getElementById("elecConfirmPanel");
  if (!panel) return;

  const relevantPositions = BALLOT_POSITIONS.filter(pos => {
    if (_currentMode === "revote") return pos === _currentRevotePosition;
    return _electionContestants.some(c => c.position === pos);
  });
  const allDone = relevantPositions.every(pos => _doneTabs.has(pos));
  if (!allDone || !relevantPositions.length) { panel.innerHTML = ""; return; }

  const rows = relevantPositions.map(pos => {
    const sel = _selections[pos];
    const names = Array.isArray(sel)
      ? sel.map(id => _electionContestants.find(c => c.id === id)?.studentName || "?").join(", ")
      : (_electionContestants.find(c => c.id === sel)?.studentName || "—");
    return `<div class="elec-confirm-row"><span>${esc(pos)}</span><span>${esc(names)}</span></div>`;
  }).join("");

  const submitEnabled = _currentMode === "voting" || _currentMode === "revote";
  panel.innerHTML = `
    <div class="elec-confirm-panel">
      <p style="font-weight:700;margin-bottom:8px">Your Selections</p>
      ${rows}
      <button id="elecSubmitBtn" class="btn-primary" style="width:auto;padding:10px 24px;margin-top:14px" ${submitEnabled ? "" : "disabled"}>
        Confirm Selection and Submit
      </button>
      ${!submitEnabled ? `<p class="muted small" style="margin-top:6px">Voting will open when the Electoral Commission activates it.</p>` : ""}
      <p id="elecSubmitErr" class="error" style="margin-top:8px"></p>
    </div>`;

  if (submitEnabled) {
    document.getElementById("elecSubmitBtn").addEventListener("click", submitBallot);
  }
}

async function submitBallot() {
  const btn = document.getElementById("elecSubmitBtn");
  const errEl = document.getElementById("elecSubmitErr");
  btn.disabled = true; btn.textContent = "Submitting…";
  errEl.textContent = "";

  try {
    const round = _currentMode === "revote" ? "revote" : "main";
    const positionsToSubmit = _currentMode === "revote"
      ? [_currentRevotePosition]
      : BALLOT_POSITIONS.filter(pos => _electionContestants.some(c => c.position === pos));

    const writes = [];
    for (const pos of positionsToSubmit) {
      const sel = _selections[pos];
      if (!sel) continue;
      const ids = Array.isArray(sel) ? sel : [sel];
      for (const cid of ids) {
        writes.push(addDoc(collection(db, "votes"), {
          cycleId: _electionCycle.id,
          position: pos,
          contestantId: cid,
          round,
          votedAt: serverTimestamp()
        }));
      }
    }
    await Promise.all(writes);

    if (round === "revote") {
      await setDoc(doc(db, "voterTurnout", currentUser.uid), {
        cycleId: _electionCycle.id,
        revotes: { [_currentRevotePosition]: { contestantId: _selections[_currentRevotePosition], votedAt: serverTimestamp() } }
      }, { merge: true });
      showElectionGate(`You have already voted in the revote for ${_currentRevotePosition}. Thank you for participating.`);
    } else {
      const receiptToken = Math.random().toString(36).slice(2, 10).toUpperCase();
      await setDoc(doc(db, "voterTurnout", currentUser.uid), {
        cycleId: _electionCycle.id,
        mainRound: _selections,
        receiptToken,
        submittedAt: serverTimestamp()
      }, { merge: true });
      try { await deleteDoc(doc(db, "draftSelections", currentUser.uid)); } catch (_) {}
      sendVoteReceiptEmail(receiptToken, positionsToSubmit); // best-effort, see note below
      showElectionGate(`You have already voted. Thank you for participating. Receipt: ${receiptToken} (screenshot this — it does not reveal your choices, only that you voted).`);
    }
  } catch (err) {
    errEl.textContent = "Submit failed: " + err.message;
    btn.disabled = false; btn.textContent = "Confirm Selection and Submit";
  }
}

// Fire-and-forget email receipt (Q4 decision). NOTE: this calls the existing
// Worker /email endpoint with a NEW type, "vote_receipt", that the Worker does
// not yet handle — the Worker source lives outside this repo (Flag 24) and must
// be updated separately before this actually delivers anything. Failure here is
// silent and never blocks the vote, which has already been recorded regardless.
async function sendVoteReceiptEmail(receiptToken, positions) {
  try {
    await fetch(UPLOAD_WORKER_URL + "/email", {
      method: "POST",
      headers: { "Content-Type": "application/json", ...(await authHeaders()) },
      body: JSON.stringify({
        type: "vote_receipt",
        to: currentUser.email,
        receiptToken,
        positions,
      })
    });
  } catch (_) { /* best-effort — the vote itself is already recorded */ }
}

function esc(s) {
  return String(s ?? "")
    .replace(/&/g, "&amp;").replace(/</g, "&lt;")
    .replace(/>/g, "&gt;").replace(/"/g, "&quot;");
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

// ── Amount in words (Kwacha + Ngwee) ─────────────────────────────────────────
function toWords(n) {
  const ones = ["","One","Two","Three","Four","Five","Six","Seven","Eight","Nine",
    "Ten","Eleven","Twelve","Thirteen","Fourteen","Fifteen","Sixteen",
    "Seventeen","Eighteen","Nineteen"];
  const tens = ["","","Twenty","Thirty","Forty","Fifty","Sixty","Seventy","Eighty","Ninety"];

  function below1000(n) {
    if (n === 0) return "";
    if (n < 20) return ones[n];
    if (n < 100) return tens[Math.floor(n/10)] + (n%10 ? " " + ones[n%10] : "");
    return ones[Math.floor(n/100)] + " Hundred" + (n%100 ? " " + below1000(n%100) : "");
  }

  const kwacha = Math.floor(n);
  const ngwee  = Math.round((n - kwacha) * 100);
  let result   = below1000(kwacha) + " Kwacha";
  if (ngwee > 0) result += " and " + below1000(ngwee) + " Ngwee";
  return result.trim() || "Zero Kwacha";
}
