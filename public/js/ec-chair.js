import { db } from "./firebase.js";
import { protect } from "./guard.js";
import { initSubHero } from "./subhero.js?v=4";
import { ecTabs } from "./nav.js";
import { uploadProof, authHeaders } from "./upload.js";
import { UPLOAD_WORKER_URL } from "./config.js";
import { registerFCMToken, sendPush } from "./fcm.js";
import {
  collection, doc, getDoc, getDocs, setDoc, updateDoc, deleteDoc, arrayUnion,
  query, where, serverTimestamp
} from "https://www.gstatic.com/firebasejs/10.12.2/firebase-firestore.js";

// Event delegation for all dynamically-generated action buttons
document.addEventListener("click", e => {
  const el = e.target.closest("[data-action^='ec:']");
  if (!el) return;
  const d = el.dataset;
  switch (d.action) {
    case "ec:view-proof":          window.open(d.url, "_blank", "noopener"); break;
    case "ec:approve-pay":         window.ecApprovePay(d.id); break;
    case "ec:show-reject-pay":     window.ecShowRejectPay(d.id); break;
    case "ec:hide-reject-pay":     window.ecHideRejectPay(d.id); break;
    case "ec:reject-pay":          window.ecRejectPay(d.id); break;
    case "ec:open-add-contestant": window.ecOpenAddContestant(d.id); break;
    case "ec:disqualify":          window.ecDisqualify(d.id); break;
    case "ec:edit-contestant":     window.ecEditContestant(d.id); break;
    case "ec:call-revote":         window.ecCallRevote(d.position); break;
    case "ec:close-revote":        window.ecCloseRevote(); break;
  }
});

// Ballot positions (Constitution Art. 7). Kept local — no shared constants.js
// exists in this codebase; every page keeps its own copy (mirrors admin.js's
// POSITIONS, industrial-secretary.js's DEPARTMENTS, etc).
const BALLOT_POSITIONS = [
  "Chairperson", "Vice Chairperson", "Secretary General", "Vice Secretary General",
  "Treasurer", "Information and Publicity Secretary",
  "Social and Cultural Secretary", "Committee Member"
];
// Art. 9(a): ONLY these two positions require 4th Year. All other positions
// (including Vice Secretary General) only need Art. 9(b) — not graduating.
const FOURTH_YEAR_ONLY_POSITIONS = ["Chairperson", "Secretary General"];
const EC_INELIGIBLE_YEARS = ["5th Year", "Graduate"];
const PHASE_LABELS = {
  nominations: "Nominations", campaigning: "Campaigning", voting: "Voting",
  counting: "Counting", published: "Published"
};

let _user, _profile;
let _cycle = null;
let _ecPayments = [];
let _contestants = [];

// ── Shared ────────────────────────────────────────────────────────────────────
function esc(s) {
  return String(s ?? "")
    .replace(/&/g,"&amp;").replace(/</g,"&lt;")
    .replace(/>/g,"&gt;").replace(/"/g,"&quot;");
}

function getDashGreeting() {
  const h = new Date().getHours();
  if (h < 12) return "Good morning";
  if (h < 17) return "Good afternoon";
  return "Good evening";
}

async function loadActiveCycle() {
  try {
    const snap = await getDocs(query(collection(db, "electionCycles"), where("status", "==", "active")));
    _cycle = snap.empty ? null : { id: snap.docs[0].id, ...snap.docs[0].data() };
  } catch (_) {
    _cycle = null;
  }
  return _cycle;
}

// ── Dashboard ─────────────────────────────────────────────────────────────────
async function renderECDash() {
  const dc = document.getElementById("dashContent");
  if (!dc) return;
  const name = _profile?.name || _user?.email || "EC Chairperson";
  const greetingCard = `
    <div style="margin-bottom:14px;background:var(--green);color:#fff;padding:22px 24px;border-radius:14px;box-shadow:0 4px 14px rgba(0,85,165,.15)">
      <div style="font-size:20px;font-weight:800;color:#fff">${getDashGreeting()}, ${esc(name)}.</div>
      <div style="font-size:14px;margin-top:6px;color:#dbeafe">Electoral Commission Chairperson &nbsp;·&nbsp; Here's your role overview.</div>
    </div>`;

  await loadActiveCycle();

  if (!_cycle) {
    dc.innerHTML = greetingCard + `
      <div class="card" style="padding:20px 22px;margin-bottom:12px">
        <div style="font-size:15px;font-weight:700;margin-bottom:12px;color:var(--text)">No active election cycle</div>
        <p class="muted small">The Admin (Patron) has not created an election cycle yet. Once created, this Dashboard will show live nomination and contestant counts.</p>
      </div>
      <div class="card" style="padding:20px 22px">
        <div style="font-size:15px;font-weight:700;margin-bottom:12px;color:var(--text)">Account</div>
        <ul style="margin:0;padding-left:18px;line-height:1.8;font-size:14px;color:var(--text)">
          <li>Update your profile signature</li>
          <li>Change your account password</li>
        </ul>
      </div>`;
    return;
  }

  let pendingCount = 0, contestantCount = 0;
  try {
    const [payQ, contQ] = await Promise.all([
      getDocs(query(collection(db, "ecPayments"), where("cycleId", "==", _cycle.id), where("status", "==", "pending"))),
      getDocs(query(collection(db, "contestants"), where("cycleId", "==", _cycle.id)))
    ]);
    pendingCount = payQ.size;
    contestantCount = contQ.size;
  } catch (_) {}

  const PHASE_ORDER = ["nominations", "campaigning", "voting", "counting", "published"];
  const curIdx = PHASE_ORDER.indexOf(_cycle.phase);
  const pipelineHtml = PHASE_ORDER.map((ph, i) => {
    const cls = i === curIdx ? "active" : (i < curIdx ? "done" : "");
    return `<div class="ec-phase-step ${cls}">${esc(PHASE_LABELS[ph])}</div>`;
  }).join("");

  // Dashboard advances everything up to Counting. Counting → Published requires
  // the tie check on the Results tab, so that transition lives there instead.
  const nextPhase = PHASE_ORDER[curIdx + 1];
  const advanceHtml = (nextPhase && _cycle.phase !== "counting")
    ? `<button id="ecAdvancePhaseBtn" class="btn-primary" style="width:auto;padding:9px 20px;margin-top:14px" data-next="${nextPhase}">Advance to ${esc(PHASE_LABELS[nextPhase])}</button>
       <p class="muted small" style="margin-top:6px">⚠️ This cannot be reversed.</p>`
    : (_cycle.phase === "counting"
        ? `<p class="muted small" style="margin-top:14px">Open the <strong>Results</strong> tab to count votes and publish.</p>`
        : "");

  dc.innerHTML = greetingCard + `
    <div class="card" style="padding:20px 22px">
      <div style="font-size:15px;font-weight:700;margin-bottom:4px;color:var(--text)">${esc(_cycle.name)}</div>
      <p class="muted small" style="margin-bottom:10px">Current phase: <strong>${esc(PHASE_LABELS[_cycle.phase] || _cycle.phase)}</strong></p>
      <div class="ec-phase-pipeline">${pipelineHtml}</div>
      <div class="ec-kpi-grid">
        <div class="ec-kpi-card"><div class="ec-kpi-num">${pendingCount}</div><div class="ec-kpi-lbl">Pending nominations</div></div>
        <div class="ec-kpi-card"><div class="ec-kpi-num">${contestantCount}</div><div class="ec-kpi-lbl">Approved contestants</div></div>
      </div>
      ${advanceHtml}
      <p id="ecAdvanceMsg" style="font-size:12px;margin-top:8px;min-height:14px"></p>
    </div>`;

  const advanceBtn = document.getElementById("ecAdvancePhaseBtn");
  if (advanceBtn) {
    advanceBtn.addEventListener("click", async () => {
      const next = advanceBtn.dataset.next;
      if (!confirm(`Advance to ${PHASE_LABELS[next]}? This cannot be reversed.`)) return;
      advanceBtn.disabled = true;
      const msg = document.getElementById("ecAdvanceMsg");
      msg.style.color = "var(--muted)"; msg.textContent = "Advancing…";
      try {
        await updateDoc(doc(db, "electionCycles", _cycle.id), { phase: next });
        _cycle.phase = next;
        renderECDash();
        notifyExecsOfPhaseChange(next); // best-effort, exec-only v1 (Q3 decision, Flag 23)
      } catch (err) {
        msg.style.color = "var(--danger)"; msg.textContent = err.message;
        advanceBtn.disabled = false;
      }
    });
  }
}

// ── Nominations ───────────────────────────────────────────────────────────────
async function loadNominations() {
  const list   = document.getElementById("ecPaymentsList");
  const roster = document.getElementById("contestantRoster");
  if (!list || !roster) return;

  await loadActiveCycle();
  if (!_cycle) {
    list.innerHTML   = "<p class='muted small'>No active election cycle.</p>";
    roster.innerHTML = "<p class='muted small'>No active election cycle.</p>";
    return;
  }

  list.innerHTML   = "<p class='muted small'>Loading…</p>";
  roster.innerHTML = "<p class='muted small'>Loading…</p>";
  try {
    const [payQ, contQ] = await Promise.all([
      getDocs(query(collection(db, "ecPayments"), where("cycleId", "==", _cycle.id))),
      getDocs(query(collection(db, "contestants"), where("cycleId", "==", _cycle.id)))
    ]);
    _ecPayments  = payQ.docs.map(d => ({ id: d.id, ...d.data() }));
    _contestants = contQ.docs.map(d => ({ id: d.id, ...d.data() }));
  } catch (err) {
    list.innerHTML = `<p class='error'>Failed to load: ${err.message}</p>`;
    return;
  }

  renderEcPaymentsList();
  renderContestantRoster();
}

function renderEcPaymentsList() {
  const list = document.getElementById("ecPaymentsList");
  if (!_ecPayments.length) { list.innerHTML = "<p class='muted small'>No nomination fee submissions yet.</p>"; return; }

  const sorted = _ecPayments.slice().sort((a, b) => {
    const aPending = a.status === "pending", bPending = b.status === "pending";
    if (aPending !== bPending) return aPending ? -1 : 1;
    return (b.submittedAt?.seconds ?? 0) - (a.submittedAt?.seconds ?? 0);
  });
  list.innerHTML = sorted.map(renderEcPaymentCard).join("");
}

function renderEcPaymentCard(p) {
  const date = p.submittedAt?.toDate?.().toLocaleDateString("en-ZM", { day:"2-digit", month:"short", year:"numeric" }) || "—";
  const statusColor = { pending:"#e67e22", confirmed:"#1e8a4c", rejected:"#c0392b" }[p.status] || "#555";
  const existingContestant = _contestants.find(c => c.ecPaymentId === p.id);

  let actions;
  if (p.status === "pending") {
    actions = `<div class="req-actions">
      <div id="ecpay-btns-${p.id}" style="display:flex;gap:8px;flex-wrap:wrap;align-items:center">
        <button class="btn-approve" data-action="ec:approve-pay" data-id="${p.id}">Approve</button>
        <button class="btn-reject-sm" data-action="ec:show-reject-pay" data-id="${p.id}">Reject</button>
      </div>
      <div id="ecpay-rej-${p.id}" style="display:none;width:100%" class="reject-form">
        <input class="reject-input" id="ecpay-rej-reason-${p.id}" placeholder="Reason for rejection…">
        <button class="btn-reject-confirm" data-action="ec:reject-pay" data-id="${p.id}">Send rejection</button>
        <button class="btn-ghost" style="font-size:12px;padding:6px 10px" data-action="ec:hide-reject-pay" data-id="${p.id}">Cancel</button>
      </div>
      <p id="ecpay-err-${p.id}" class="action-err"></p>
    </div>`;
  } else if (p.status === "confirmed") {
    actions = existingContestant
      ? `<div class="req-actions"><span class="muted small" style="color:var(--ok);font-weight:600">✓ Added as contestant — ${esc(existingContestant.position)}</span></div>`
      : `<div class="req-actions"><button class="btn-approve" data-action="ec:open-add-contestant" data-id="${p.id}">+ Add as Contestant</button></div>`;
  } else {
    actions = `<div class="req-actions"><span class="muted small">Rejected${p.rejectionReason ? ": " + esc(p.rejectionReason) : ""}</span></div>`;
  }

  return `<div class="req-card" id="ecpay-card-${p.id}">
    <div class="req-card-head">
      <div>
        <div class="req-name">${esc(p.studentName)}</div>
        <div class="req-meta">
          <span>${esc(p.compNumber)} · ${esc(p.department)} · ${esc(p.yearOfStudy)}</span>
          <span>K ${Number(p.amount || 0).toFixed(2)} · ${esc(p.method)}${p.txRef ? " · " + esc(p.txRef) : ""}</span>
          <span>Submitted: ${date}</span>
        </div>
      </div>
      <span class="status-pill" style="background:${statusColor}">${p.status.toUpperCase()}</span>
    </div>
    ${p.proofUrl ? `<div style="margin-bottom:10px"><button class="btn-ghost" style="font-size:12px;padding:6px 12px" data-action="ec:view-proof" data-url="${esc(p.proofUrl)}">View proof</button></div>` : ""}
    ${actions}
  </div>`;
}

window.ecApprovePay = async (id) => {
  const card = document.getElementById(`ecpay-card-${id}`);
  const btn  = card?.querySelector("[data-action='ec:approve-pay']");
  if (btn) { btn.disabled = true; btn.textContent = "Approving…"; }
  try {
    await updateDoc(doc(db, "ecPayments", id), {
      status: "confirmed", reviewedBy: _user.uid, reviewedAt: serverTimestamp()
    });
    const p = _ecPayments.find(x => x.id === id);
    if (p) p.status = "confirmed";
    renderEcPaymentsList();
  } catch (err) {
    if (btn) { btn.disabled = false; btn.textContent = "Approve"; }
    const errEl = document.getElementById(`ecpay-err-${id}`);
    if (errEl) errEl.textContent = "Approve failed: " + err.message;
  }
};

window.ecShowRejectPay = id => {
  document.getElementById(`ecpay-btns-${id}`).style.display = "none";
  document.getElementById(`ecpay-rej-${id}`).style.display  = "flex";
};
window.ecHideRejectPay = id => {
  document.getElementById(`ecpay-btns-${id}`).style.display = "flex";
  document.getElementById(`ecpay-rej-${id}`).style.display  = "none";
};
window.ecRejectPay = async id => {
  const reason = document.getElementById(`ecpay-rej-reason-${id}`)?.value.trim();
  const errEl  = document.getElementById(`ecpay-err-${id}`);
  if (!reason) { if (errEl) errEl.textContent = "Enter a rejection reason."; return; }
  if (errEl) errEl.textContent = "";
  try {
    await updateDoc(doc(db, "ecPayments", id), {
      status: "rejected", rejectionReason: reason, reviewedBy: _user.uid, reviewedAt: serverTimestamp()
    });
    const p = _ecPayments.find(x => x.id === id);
    if (p) { p.status = "rejected"; p.rejectionReason = reason; }
    renderEcPaymentsList();
  } catch (err) {
    if (errEl) errEl.textContent = err.message;
  }
};

// ── Add as Contestant modal ───────────────────────────────────────────────────
window.ecOpenAddContestant = (ecPaymentId) => {
  const p = _ecPayments.find(x => x.id === ecPaymentId);
  if (!p) return;

  let modal = document.getElementById("ecAddContestantModal");
  if (!modal) {
    document.body.insertAdjacentHTML("beforeend", `
      <div id="ecAddContestantModal" style="display:none;position:fixed;inset:0;z-index:900;background:rgba(0,0,0,.45);align-items:center;justify-content:center;padding:16px">
        <div style="background:var(--card);border-radius:12px;padding:24px 26px;max-width:420px;width:100%;max-height:90vh;overflow-y:auto;box-shadow:0 8px 32px rgba(0,0,0,.25)">
          <p style="font-size:16px;font-weight:700;margin:0 0 6px" id="ecacName"></p>
          <p class="muted small" style="margin:0 0 14px">Add this student as a contestant. This is the only way to create a contestant — there is no manual add.</p>
          <div id="ecacWarning" style="display:none" class="ec-warn-banner"></div>
          <form id="ecacForm" style="margin-top:12px">
            <label for="ecacPosition">Position</label>
            <select id="ecacPosition" required style="margin-bottom:10px">
              ${BALLOT_POSITIONS.map(pos => `<option value="${esc(pos)}">${esc(pos)}</option>`).join("")}
            </select>
            <label for="ecacPhoto">Contestant photo (required)</label>
            <input id="ecacPhoto" type="file" accept="image/*" required style="margin-bottom:6px">
            <p id="ecacPhotoProgress" class="muted small" style="min-height:16px;margin:0 0 8px"></p>
            <label for="ecacManifesto">Manifesto URL (optional, Google Drive link)</label>
            <input id="ecacManifesto" type="url" placeholder="https://drive.google.com/…" style="margin-bottom:14px">
            <p id="ecacErr" class="error" style="margin-bottom:8px"></p>
            <div style="display:flex;gap:8px;align-items:center">
              <button type="submit" id="ecacSaveBtn" class="btn-primary" style="width:auto;padding:9px 20px;margin-top:0">Save contestant</button>
              <button type="button" id="ecacCancelBtn" class="btn-ghost" style="margin-top:0">Cancel</button>
            </div>
          </form>
        </div>
      </div>`);
    modal = document.getElementById("ecAddContestantModal");
    document.getElementById("ecacCancelBtn").addEventListener("click", () => { modal.style.display = "none"; });
    document.getElementById("ecacPosition").addEventListener("change", updateEcacWarning);
    document.getElementById("ecacForm").addEventListener("submit", ecSubmitAddContestant);
  }

  modal.dataset.ecPaymentId = ecPaymentId;
  document.getElementById("ecacName").textContent = `${p.studentName} — ${p.compNumber}`;
  document.getElementById("ecacErr").textContent = "";
  document.getElementById("ecacPhotoProgress").textContent = "";
  document.getElementById("ecacForm").reset();
  const saveBtn = document.getElementById("ecacSaveBtn");
  saveBtn.disabled = false; saveBtn.textContent = "Save contestant";
  updateEcacWarning();
  modal.style.display = "flex";
};

function updateEcacWarning() {
  const modal = document.getElementById("ecAddContestantModal");
  const p = _ecPayments.find(x => x.id === modal?.dataset.ecPaymentId);
  const position = document.getElementById("ecacPosition").value;
  const warnEl = document.getElementById("ecacWarning");
  if (!p) { warnEl.style.display = "none"; return; }

  const warnings = [];
  if (EC_INELIGIBLE_YEARS.includes(p.yearOfStudy)) {
    warnings.push(`${esc(p.studentName)} is ${esc(p.yearOfStudy)} (graduating) and is constitutionally ineligible to contest (Art. 9).`);
  }
  if (FOURTH_YEAR_ONLY_POSITIONS.includes(position) && p.yearOfStudy !== "4th Year") {
    warnings.push(`${esc(position)} requires a 4th Year student per the constitution (Art. 9(a)). ${esc(p.studentName)} is ${esc(p.yearOfStudy || "unknown year")}.`);
  }
  if (warnings.length) {
    warnEl.style.display = "block";
    warnEl.innerHTML = `⚠️ ${warnings.join(" ")} You may still save this candidate — this is a warning, not a block.`;
  } else {
    warnEl.style.display = "none";
  }
}

async function ecSubmitAddContestant(e) {
  e.preventDefault();
  const modal = document.getElementById("ecAddContestantModal");
  const p = _ecPayments.find(x => x.id === modal.dataset.ecPaymentId);
  const errEl = document.getElementById("ecacErr");
  const btn = document.getElementById("ecacSaveBtn");
  const progressEl = document.getElementById("ecacPhotoProgress");
  errEl.textContent = "";
  if (!p) { errEl.textContent = "Payment not found — reload and try again."; return; }

  const position = document.getElementById("ecacPosition").value;
  const manifestoUrl = document.getElementById("ecacManifesto").value.trim();
  const photoFile = document.getElementById("ecacPhoto").files[0];
  if (!photoFile) { errEl.textContent = "Contestant photo is required."; return; }

  btn.disabled = true; btn.textContent = "Uploading photo…";
  try {
    const photoUrl = await uploadProof(photoFile, pct => {
      progressEl.textContent = `Uploading… ${Math.round(pct * 100)}%`;
    }, `elections/${_cycle.id}/contestants`);

    btn.textContent = "Saving…";
    const ref = doc(collection(db, "contestants"));
    await setDoc(ref, {
      cycleId:       _cycle.id,
      studentUid:    p.studentUid,
      studentName:   p.studentName,
      compNumber:    p.compNumber,
      department:    p.department,
      yearOfStudy:   p.yearOfStudy,
      position,
      photoUrl,
      manifestoUrl:  manifestoUrl || "",
      ecPaymentId:   p.id,
      status:        "approved",
      createdAt:     serverTimestamp(),
      approvedAt:    serverTimestamp()
    });

    _contestants.push({
      id: ref.id, cycleId: _cycle.id, studentUid: p.studentUid, studentName: p.studentName,
      compNumber: p.compNumber, department: p.department, yearOfStudy: p.yearOfStudy,
      position, photoUrl, manifestoUrl, ecPaymentId: p.id, status: "approved"
    });

    modal.style.display = "none";
    renderEcPaymentsList();
    renderContestantRoster();
  } catch (err) {
    errEl.textContent = err.message;
    btn.disabled = false; btn.textContent = "Save contestant";
  }
}

// ── Contestant roster ─────────────────────────────────────────────────────────
function renderContestantRoster() {
  const roster = document.getElementById("contestantRoster");
  if (!_contestants.length) { roster.innerHTML = "<p class='muted small'>No contestants yet.</p>"; return; }

  const byPosition = {};
  _contestants.forEach(c => { (byPosition[c.position] ||= []).push(c); });

  roster.innerHTML = BALLOT_POSITIONS.filter(pos => byPosition[pos]?.length).map(pos => `
    <div style="margin-bottom:14px">
      <p style="font-weight:700;font-size:13px;margin-bottom:6px">${esc(pos)}</p>
      ${byPosition[pos].map(c => `
        <div class="req-card" style="margin-bottom:8px;padding:12px 14px">
          <div class="req-card-head" style="margin-bottom:0">
            <div>
              <div class="req-name" style="font-size:14px">${esc(c.studentName)}</div>
              <div class="req-meta">
                <span>${esc(c.compNumber)} · ${esc(c.department)} · ${esc(c.yearOfStudy)}</span>
                ${c.updatedAt ? `<span class="muted small">Updated ${fmtWhen(c.updatedAt)}</span>` : ""}
              </div>
            </div>
            <span class="status-pill" style="background:${c.status === "disqualified" ? "#c0392b" : "#1e8a4c"}">${c.status.toUpperCase()}</span>
          </div>
          <div style="margin-top:8px;display:flex;gap:8px;flex-wrap:wrap">
            <button class="btn-ghost" style="font-size:12px;padding:6px 12px" data-action="ec:edit-contestant" data-id="${c.id}">Edit</button>
            ${c.status === "approved" ? `<button class="btn-danger-sm" data-action="ec:disqualify" data-id="${c.id}">Disqualify</button>` : ""}
          </div>
        </div>`).join("")}
    </div>`).join("");
}

function fmtWhen(ts) {
  const d = ts?.toDate ? ts.toDate() : (ts?.seconds ? new Date(ts.seconds * 1000) : null);
  return d ? d.toLocaleDateString("en-ZM", { day: "2-digit", month: "short", year: "numeric" }) : "recently";
}

window.ecDisqualify = async (id) => {
  const reason = prompt("Reason for disqualification (kept on record, contestant is hidden from the ballot):");
  if (!reason) return;
  try {
    await updateDoc(doc(db, "contestants", id), { status: "disqualified", disqualificationReason: reason });
    const c = _contestants.find(x => x.id === id);
    if (c) { c.status = "disqualified"; c.disqualificationReason = reason; }
    renderContestantRoster();
  } catch (err) {
    alert("Disqualify failed: " + err.message);
  }
};

// ── Edit contestant (Q2 — allowed any time, changes logged to editHistory) ─────
window.ecEditContestant = (contestantId) => {
  const c = _contestants.find(x => x.id === contestantId);
  if (!c) return;

  let modal = document.getElementById("ecEditContestantModal");
  if (!modal) {
    document.body.insertAdjacentHTML("beforeend", `
      <div id="ecEditContestantModal" style="display:none;position:fixed;inset:0;z-index:900;background:rgba(0,0,0,.45);align-items:center;justify-content:center;padding:16px">
        <div style="background:var(--card);border-radius:12px;padding:24px 26px;max-width:420px;width:100%;max-height:90vh;overflow-y:auto;box-shadow:0 8px 32px rgba(0,0,0,.25)">
          <p style="font-size:16px;font-weight:700;margin:0 0 6px" id="eceName"></p>
          <p class="muted small" style="margin:0 0 14px">Corrections only — changes are logged and students see an "Updated" label.</p>
          <div id="eceWarning" style="display:none" class="ec-warn-banner"></div>
          <form id="eceForm" style="margin-top:12px">
            <label for="ecePosition">Position</label>
            <select id="ecePosition" required style="margin-bottom:10px">
              ${BALLOT_POSITIONS.map(pos => `<option value="${esc(pos)}">${esc(pos)}</option>`).join("")}
            </select>
            <label for="ecePhoto">Replace photo (optional)</label>
            <input id="ecePhoto" type="file" accept="image/*" style="margin-bottom:6px">
            <p id="ecePhotoProgress" class="muted small" style="min-height:16px;margin:0 0 8px"></p>
            <label for="eceManifesto">Manifesto URL</label>
            <input id="eceManifesto" type="url" placeholder="https://drive.google.com/…" style="margin-bottom:14px">
            <p id="eceErr" class="error" style="margin-bottom:8px"></p>
            <div style="display:flex;gap:8px;align-items:center">
              <button type="submit" id="eceSaveBtn" class="btn-primary" style="width:auto;padding:9px 20px;margin-top:0">Save changes</button>
              <button type="button" id="eceCancelBtn" class="btn-ghost" style="margin-top:0">Cancel</button>
            </div>
          </form>
        </div>
      </div>`);
    modal = document.getElementById("ecEditContestantModal");
    document.getElementById("eceCancelBtn").addEventListener("click", () => { modal.style.display = "none"; });
    document.getElementById("ecePosition").addEventListener("change", updateEceWarning);
    document.getElementById("eceForm").addEventListener("submit", ecSubmitEditContestant);
  }

  modal.dataset.contestantId = contestantId;
  document.getElementById("eceName").textContent = `${c.studentName} — ${c.compNumber}`;
  document.getElementById("ecePosition").value = c.position;
  document.getElementById("eceManifesto").value = c.manifestoUrl || "";
  document.getElementById("eceErr").textContent = "";
  document.getElementById("ecePhotoProgress").textContent = "";
  document.getElementById("ecePhoto").value = "";
  const saveBtn = document.getElementById("eceSaveBtn");
  saveBtn.disabled = false; saveBtn.textContent = "Save changes";
  updateEceWarning();
  modal.style.display = "flex";
};

function updateEceWarning() {
  const modal = document.getElementById("ecEditContestantModal");
  const c = _contestants.find(x => x.id === modal?.dataset.contestantId);
  const position = document.getElementById("ecePosition").value;
  const warnEl = document.getElementById("eceWarning");
  if (!c) { warnEl.style.display = "none"; return; }
  const warnings = [];
  if (EC_INELIGIBLE_YEARS.includes(c.yearOfStudy)) {
    warnings.push(`${esc(c.studentName)} is ${esc(c.yearOfStudy)} (graduating) and is constitutionally ineligible to contest (Art. 9).`);
  }
  if (FOURTH_YEAR_ONLY_POSITIONS.includes(position) && c.yearOfStudy !== "4th Year") {
    warnings.push(`${esc(position)} requires a 4th Year student per the constitution (Art. 9(a)). ${esc(c.studentName)} is ${esc(c.yearOfStudy || "unknown year")}.`);
  }
  warnEl.style.display = warnings.length ? "block" : "none";
  if (warnings.length) warnEl.innerHTML = `⚠️ ${warnings.join(" ")} You may still save.`;
}

async function ecSubmitEditContestant(e) {
  e.preventDefault();
  const modal = document.getElementById("ecEditContestantModal");
  const c = _contestants.find(x => x.id === modal.dataset.contestantId);
  const errEl = document.getElementById("eceErr");
  const btn = document.getElementById("eceSaveBtn");
  const progressEl = document.getElementById("ecePhotoProgress");
  errEl.textContent = "";
  if (!c) { errEl.textContent = "Contestant not found — reload and try again."; return; }

  const newPosition = document.getElementById("ecePosition").value;
  const newManifesto = document.getElementById("eceManifesto").value.trim();
  const photoFile = document.getElementById("ecePhoto").files[0];

  btn.disabled = true; btn.textContent = "Saving…";
  try {
    const changes = [];
    const updates = {};
    if (newPosition !== c.position) {
      changes.push({ field: "position", oldValue: c.position, newValue: newPosition });
      updates.position = newPosition;
    }
    if (newManifesto !== (c.manifestoUrl || "")) {
      changes.push({ field: "manifestoUrl", oldValue: c.manifestoUrl || "", newValue: newManifesto });
      updates.manifestoUrl = newManifesto;
    }
    if (photoFile) {
      btn.textContent = "Uploading photo…";
      const photoUrl = await uploadProof(photoFile, pct => {
        progressEl.textContent = `Uploading… ${Math.round(pct * 100)}%`;
      }, `elections/${_cycle.id}/contestants`);
      changes.push({ field: "photoUrl", oldValue: c.photoUrl || "", newValue: photoUrl });
      updates.photoUrl = photoUrl;
    }

    if (!changes.length) { modal.style.display = "none"; btn.disabled = false; btn.textContent = "Save changes"; return; }

    btn.textContent = "Saving…";
    updates.updatedAt = serverTimestamp();
    // serverTimestamp() sentinels aren't allowed inside array elements, so each
    // editHistory entry gets a plain client-side ISO string instead.
    updates.editHistory = arrayUnion(...changes.map(ch => ({
      ...ch, editedAt: new Date().toISOString(), editedBy: _user.uid
    })));
    await updateDoc(doc(db, "contestants", c.id), updates);

    Object.assign(c, {
      position: updates.position ?? c.position,
      manifestoUrl: updates.manifestoUrl ?? c.manifestoUrl,
      photoUrl: updates.photoUrl ?? c.photoUrl,
      updatedAt: { seconds: Math.floor(Date.now() / 1000) }
    });
    modal.style.display = "none";
    renderContestantRoster();
  } catch (err) {
    errEl.textContent = err.message;
    btn.disabled = false; btn.textContent = "Save changes";
  }
}

// ── Overview ──────────────────────────────────────────────────────────────────
// Kept local, not imported from admin.js (Flag 13 — admin.js's protect(["admin"])
// bootstrap runs at import time and expects admin-only DOM elements; importing it
// here would double-run that side effect against ec-chair.html's DOM instead).
const DEPARTMENTS = [
  "Agricultural Engineering",
  "Civil and Environmental Engineering",
  "Electrical and Electronic Engineering",
  "Geomatic Engineering",
  "Mechanical Engineering"
];
const YEAR_OPTIONS = ["1st Year", "2nd Year", "3rd Year", "4th Year", "5th Year", "Graduate"];

async function loadOverview() {
  const stats = document.getElementById("ecOverviewStats");
  if (!stats) return;
  stats.innerHTML = "<p class='muted small'>Loading…</p>";
  try {
    const [studentsSnap, paidSnap] = await Promise.all([
      getDocs(collection(db, "students")),
      getDocs(query(collection(db, "payments"), where("category", "==", "Membership Dues"), where("status", "==", "confirmed")))
    ]);
    const students = studentsSnap.docs.map(d => ({ id: d.id, ...d.data() }));
    const paidUids = new Set(paidSnap.docs.map(d => d.data().studentUid));

    const byDept = {}; DEPARTMENTS.forEach(d => byDept[d] = 0);
    const paidByYear = {}; YEAR_OPTIONS.forEach(y => paidByYear[y] = 0);
    let paidCount = 0;
    students.forEach(s => {
      if (s.department && byDept[s.department] !== undefined) byDept[s.department]++;
      if (paidUids.has(s.id)) {
        paidCount++;
        if (s.yearOfStudy && paidByYear[s.yearOfStudy] !== undefined) paidByYear[s.yearOfStudy]++;
      }
    });

    const deptLine = DEPARTMENTS.filter(d => byDept[d] > 0).map(d => `${esc(d)}: ${byDept[d]}`).join(" · ");
    const yearLine = YEAR_OPTIONS.filter(y => paidByYear[y] > 0).map(y => `${esc(y)}: ${paidByYear[y]}`).join(" · ");

    stats.innerHTML = `
      <p style="margin-bottom:4px"><strong>Total students:</strong> ${students.length}</p>
      <p class="muted small" style="margin-bottom:16px">${deptLine || "No department data."}</p>
      <p style="margin-bottom:4px"><strong>Paid-up members (eligible voters):</strong> ${paidCount}</p>
      <p class="muted small">${yearLine || "No paid members yet."}</p>`;
  } catch (err) {
    stats.innerHTML = `<p class='error'>Failed to load: ${err.message}</p>`;
  }

  wireAllowAllToggle();
}

function wireAllowAllToggle() {
  const toggle = document.getElementById("allowAllToggle");
  const statusText = document.getElementById("allowAllStatusText");
  if (!toggle || !statusText) return;
  syncAllowAllUI();

  if (toggle.dataset.wired) return;
  toggle.dataset.wired = "1";
  toggle.addEventListener("change", async () => {
    const msg = document.getElementById("allowAllMsg");
    if (toggle.checked) {
      toggle.checked = false; // stays off visually until the OTP confirms it
      await openAllowAllOtpModal();
    } else {
      if (!confirm('Turn OFF "allow all students to vote"? Only paid-up members will be able to vote.')) {
        toggle.checked = true; return;
      }
      try {
        await updateDoc(doc(db, "electionCycles", _cycle.id), { allowAllStudents: false });
        _cycle.allowAllStudents = false;
        syncAllowAllUI();
      } catch (err) {
        toggle.checked = true;
        if (msg) { msg.style.color = "var(--danger)"; msg.textContent = err.message; }
      }
    }
  });
}

function syncAllowAllUI() {
  const toggle = document.getElementById("allowAllToggle");
  const statusText = document.getElementById("allowAllStatusText");
  if (!toggle || !statusText) return;
  const on = !!_cycle?.allowAllStudents;
  toggle.checked = on;
  statusText.textContent = on ? "Currently: ON (all students can vote)" : "Currently: OFF (only paid-up members can vote)";
}

// Finds who to send the "allow all students" OTP to: the active UZES Chairperson
// first; falls back to any Admin if no Chairperson is on file (per the user's
// review decision — a graduating/5th-Year Chairperson has no conflict of
// interest, so this OTP path is safe for either recipient).
async function findOtpRecipient() {
  try {
    const chairSnap = await getDocs(query(
      collection(db, "executives"),
      where("position", "==", "Chairperson"),
      where("active", "==", true)
    ));
    const withEmail = chairSnap.docs.find(d => d.data().email);
    if (withEmail) return { email: withEmail.data().email, role: "Chairperson" };
  } catch (_) {}
  try {
    const adminSnap = await getDocs(query(collection(db, "executives"), where("role", "==", "admin")));
    const withEmail = adminSnap.docs.find(d => d.data().email);
    if (withEmail) return { email: withEmail.data().email, role: "Admin" };
  } catch (_) {}
  return null;
}

async function sha256Hex(text) {
  const buf = await crypto.subtle.digest("SHA-256", new TextEncoder().encode(text));
  return Array.from(new Uint8Array(buf)).map(b => b.toString(16).padStart(2, "0")).join("");
}

async function openAllowAllOtpModal() {
  let modal = document.getElementById("ecAllowAllOtpModal");
  if (!modal) {
    document.body.insertAdjacentHTML("beforeend", `
      <div id="ecAllowAllOtpModal" style="display:none;position:fixed;inset:0;z-index:900;background:rgba(0,0,0,.45);align-items:center;justify-content:center;padding:16px">
        <div style="background:var(--card);border-radius:12px;padding:24px 26px;max-width:380px;width:100%;box-shadow:0 8px 32px rgba(0,0,0,.25)">
          <p style="font-size:16px;font-weight:700;margin:0 0 6px">Allow all students to vote</p>
          <p class="muted small" id="ecOtpIntro" style="margin:0 0 16px"></p>
          <p id="ecOtpErr" class="error" style="margin:0 0 10px;min-height:16px"></p>
          <div id="ecOtpStep1">
            <button type="button" id="ecOtpSendBtn" class="btn-primary" style="width:auto;padding:9px 20px;margin-top:0">Send code</button>
          </div>
          <form id="ecOtpForm" style="display:none">
            <label for="ecOtpCode">Enter the 6-digit code</label>
            <input id="ecOtpCode" inputmode="numeric" maxlength="6" style="margin-bottom:8px;letter-spacing:6px;text-align:center;font-size:18px">
            <div style="display:flex;gap:10px;align-items:center">
              <button type="submit" class="btn-primary" style="width:auto;padding:9px 20px;margin-top:0">Verify</button>
              <button type="button" id="ecOtpResendBtn" class="btn-ghost" style="margin-top:0;font-size:13px">Resend</button>
            </div>
          </form>
          <div style="margin-top:14px">
            <button type="button" id="ecOtpCancelBtn" class="btn-ghost" style="margin-top:0">Cancel</button>
          </div>
        </div>
      </div>`);
    modal = document.getElementById("ecAllowAllOtpModal");
  }

  const introEl = document.getElementById("ecOtpIntro");
  const errEl = document.getElementById("ecOtpErr");
  const step1 = document.getElementById("ecOtpStep1");
  const form = document.getElementById("ecOtpForm");
  const codeInput = document.getElementById("ecOtpCode");
  const sendBtn = document.getElementById("ecOtpSendBtn");
  const resendBtn = document.getElementById("ecOtpResendBtn");
  const cancelBtn = document.getElementById("ecOtpCancelBtn");

  errEl.textContent = ""; codeInput.value = "";
  step1.style.display = "block"; form.style.display = "none";
  sendBtn.style.display = ""; sendBtn.disabled = false; sendBtn.textContent = "Send code";
  modal.style.display = "flex";

  const recipient = await findOtpRecipient();
  if (!recipient) {
    introEl.textContent = "";
    errEl.textContent = "Cannot send OTP — no Chairperson or Admin email on file. Contact system administrator.";
    sendBtn.style.display = "none";
    cancelBtn.onclick = () => { modal.style.display = "none"; };
    return;
  }
  introEl.textContent = `We'll email a one-time code to the ${recipient.role} (${recipient.email}) to confirm this change.`;

  async function sendCode() {
    errEl.textContent = "";
    sendBtn.disabled = true; sendBtn.textContent = "Sending…";
    try {
      const code = String(Math.floor(100000 + Math.random() * 900000));
      const codeHash = await sha256Hex(code);
      const expiresAt = Date.now() + 10 * 60 * 1000;
      await setDoc(doc(db, "settings", "ecOtp"), { codeHash, requestedBy: _user.uid, expiresAt });
      const res = await fetch(UPLOAD_WORKER_URL + "/email", {
        method: "POST",
        headers: { "Content-Type": "application/json", ...(await authHeaders()) },
        body: JSON.stringify({ type: "ec_allow_all_otp", to: recipient.email, code, cycleName: _cycle?.name || "" })
      });
      if (!res.ok) {
        const data = await res.json().catch(() => ({}));
        throw new Error(data.error || ("Worker returned " + res.status));
      }
      step1.style.display = "none";
      form.style.display = "block";
      setTimeout(() => codeInput.focus(), 60);
    } catch (err) {
      errEl.textContent = "Failed to send code: " + err.message;
    } finally {
      sendBtn.disabled = false; sendBtn.textContent = "Send code";
    }
  }

  async function handleVerify(e) {
    e.preventDefault();
    errEl.textContent = "";
    const entered = codeInput.value.trim();
    if (!/^\d{6}$/.test(entered)) { errEl.textContent = "Enter the 6-digit code."; return; }
    try {
      const snap = await getDoc(doc(db, "settings", "ecOtp"));
      if (!snap.exists()) { errEl.textContent = "No code requested. Click Send code."; return; }
      const data = snap.data();
      if (data.requestedBy !== _user.uid) { errEl.textContent = "Code was issued to a different session."; return; }
      if (Date.now() > data.expiresAt) { errEl.textContent = "Code expired — click Resend."; return; }
      const enteredHash = await sha256Hex(entered);
      if (enteredHash !== data.codeHash) { errEl.textContent = "Incorrect code."; codeInput.select(); return; }
      await deleteDoc(doc(db, "settings", "ecOtp"));
      await updateDoc(doc(db, "electionCycles", _cycle.id), { allowAllStudents: true });
      _cycle.allowAllStudents = true;
      modal.style.display = "none";
      syncAllowAllUI();
    } catch (err) {
      errEl.textContent = err.message;
    }
  }

  sendBtn.onclick = sendCode;
  resendBtn.onclick = sendCode;
  form.onsubmit = handleVerify;
  cancelBtn.onclick = () => { modal.style.display = "none"; };
}

// ── Results ───────────────────────────────────────────────────────────────────
// NOTE: only "disqualified" is implemented (votes for a disqualified contestant
// are excluded from counting below). Plan §2/§12 also describes a voluntary
// "withdrawn" status whose votes SHOULD still count — that status/action isn't
// built yet (Nominations tab only has Disqualify), so there is currently no path
// to reach it. Flagged here so a future slice doesn't assume it silently works.
async function loadResults() {
  const content = document.getElementById("ecResultsContent");
  if (!content) return;

  await loadActiveCycle();
  if (!_cycle) { content.innerHTML = "<p class='muted small'>No election cycle active yet — nothing to count.</p>"; return; }

  if (["nominations", "campaigning", "voting"].includes(_cycle.phase)) {
    content.innerHTML = `<p class="muted small">Results become available once you advance to Counting (Dashboard tab).</p>`;
    return;
  }

  content.innerHTML = "<p class='muted small'>Loading…</p>";
  await aggregateAndRenderResults();
}

let _positionResults = {};

async function aggregateAndRenderResults() {
  const content = document.getElementById("ecResultsContent");
  let allVotes, approvedContestants;
  try {
    const [votesSnap, contQ] = await Promise.all([
      getDocs(query(collection(db, "votes"), where("cycleId", "==", _cycle.id))),
      getDocs(query(collection(db, "contestants"), where("cycleId", "==", _cycle.id), where("status", "==", "approved")))
    ]);
    allVotes = votesSnap.docs.map(d => d.data());
    approvedContestants = contQ.docs.map(d => ({ id: d.id, ...d.data() }));
  } catch (err) {
    content.innerHTML = `<p class='error'>Failed to load: ${err.message}</p>`;
    return;
  }

  _positionResults = {};
  BALLOT_POSITIONS.forEach(pos => {
    const candidates = approvedContestants.filter(c => c.position === pos);
    if (!candidates.length) return;
    _positionResults[pos] = computePositionResults(pos, allVotes, candidates);
  });

  renderResultsContent();
  persistElectionStats(); // best-effort — feeds the public results page later
}

function computePositionResults(pos, allVotes, candidates) {
  const mainCounts = {}, revoteCounts = {};
  candidates.forEach(c => { mainCounts[c.id] = 0; revoteCounts[c.id] = 0; });
  allVotes.forEach(v => {
    if (v.position !== pos || !(v.contestantId in mainCounts)) return;
    if (v.round === "revote") revoteCounts[v.contestantId]++;
    else mainCounts[v.contestantId]++;
  });
  const usedRevote = Object.values(revoteCounts).some(n => n > 0);
  const counts = usedRevote ? revoteCounts : mainCounts;
  const totalVotes = Object.values(counts).reduce((a, b) => a + b, 0);
  const sorted = candidates.slice().sort((a, b) => counts[b.id] - counts[a.id]);

  const seats = pos === "Committee Member" ? Math.min(3, candidates.length) : 1;
  const winners = sorted.slice(0, seats).map(c => c.id);
  let isTie = false;
  if (sorted.length > seats) {
    isTie = counts[sorted[seats - 1].id] === counts[sorted[seats].id];
  } else if (sorted.length > 1 && seats === 1) {
    isTie = counts[sorted[0].id] === counts[sorted[1].id];
  }

  return { counts, totalVotes, sorted, winners, isTie, usedRevote };
}

function renderResultsContent() {
  const content = document.getElementById("ecResultsContent");
  const positions = BALLOT_POSITIONS.filter(pos => _positionResults[pos]);
  const anyUnresolvedTie = positions.some(pos => _positionResults[pos].isTie);

  const sections = positions.map(pos => {
    const r = _positionResults[pos];
    const maxCount = Math.max(1, ...r.sorted.map(c => r.counts[c.id]));
    const barsHtml = r.sorted.map(c => {
      const count = r.counts[c.id];
      const pct = Math.round((count / maxCount) * 100);
      const isWinner = r.winners.includes(c.id);
      return `<div class="ec-bar-row">
        <span class="ec-bar-name">${esc(c.studentName)}${isWinner ? " 🏆" : ""}</span>
        <div class="ec-bar-track"><div class="ec-bar-fill" style="width:${pct}%"></div></div>
        <span class="ec-bar-count">${count}</span>
      </div>`;
    }).join("");

    const revoteActiveHere = _cycle.revote?.active && _cycle.revote.position === pos;
    const revoteControls = revoteActiveHere
      ? `<p class="muted small" style="color:var(--danger)">Revote in progress for this position.</p>
         <button class="btn-approve" data-action="ec:close-revote">Close Revote</button>`
      : `<button class="btn-danger-sm" data-action="ec:call-revote" data-position="${esc(pos)}">Call Revote for ${esc(pos)}</button>`;

    return `<div class="card" style="margin-bottom:16px">
      <div class="section-head" style="display:flex;justify-content:space-between;align-items:center">
        <span>${esc(pos)}</span><span class="muted small">Total: ${r.totalVotes} votes</span>
      </div>
      ${barsHtml || "<p class='muted small'>No votes yet.</p>"}
      ${r.isTie ? `<p class="ec-warn-banner">⚠️ Tie detected — ${esc(pos)}.</p>` : ""}
      <div style="margin-top:10px;display:flex;gap:8px;flex-wrap:wrap;align-items:center">${revoteControls}</div>
    </div>`;
  }).join("");

  const alreadyPublished = _cycle.phase === "published";
  const publishDisabled = anyUnresolvedTie || alreadyPublished;
  content.innerHTML = sections + `
    <div class="card">
      <button id="ecPublishBtn" class="btn-primary" style="width:auto;padding:10px 24px" ${publishDisabled ? "disabled" : ""}>
        ${alreadyPublished ? "Results Published" : "Publish Results"}
      </button>
      ${anyUnresolvedTie ? `<p class="muted small" style="margin-top:8px">Resolve all ties before publishing.</p>` : ""}
      <p id="ecPublishMsg" style="font-size:12px;margin-top:8px;min-height:14px"></p>
    </div>`;

  if (!publishDisabled) {
    document.getElementById("ecPublishBtn").addEventListener("click", ecPublishResults);
  }
}

// Feeds electionStats/{cycleId} so the (unauthenticated) public results page and
// any future dashboard views can read per-contestant counts without needing
// access to the raw /votes collection, which stays EC Chair/Admin-only for
// ballot secrecy (see firestore.rules).
async function persistElectionStats() {
  const positionResultsOut = {};
  for (const pos of Object.keys(_positionResults)) {
    const r = _positionResults[pos];
    const contestantsOut = {};
    r.sorted.forEach(c => { contestantsOut[c.id] = r.counts[c.id]; });
    positionResultsOut[pos] = {
      totalVotes: r.totalVotes,
      contestants: contestantsOut,
      winner: pos === "Committee Member" ? r.winners : (r.winners[0] || null),
      isTie: r.isTie,
      isRevoteActive: !!(_cycle.revote?.active && _cycle.revote.position === pos)
    };
  }
  try {
    await setDoc(doc(db, "electionStats", _cycle.id), {
      positionResults: positionResultsOut,
      updatedAt: serverTimestamp()
    }, { merge: true });
  } catch (_) { /* best-effort — Results tab itself still works from live /votes reads */ }
}

window.ecCallRevote = async (position) => {
  const reason = prompt(`Reason for calling a revote for ${position} (min 10 characters):`);
  if (!reason || reason.trim().length < 10) {
    alert("A revote requires a reason of at least 10 characters — this is logged to the cycle record.");
    return;
  }
  if (!confirm(`This opens re-voting for ${position} only. Continue?`)) return;
  try {
    await updateDoc(doc(db, "electionCycles", _cycle.id), {
      revote: { position, active: true, reason: reason.trim(), calledAt: serverTimestamp(), closedAt: null }
    });
    _cycle.revote = { position, active: true, reason: reason.trim() };
    loadResults();
  } catch (err) {
    alert("Failed to call revote: " + err.message);
  }
};

window.ecCloseRevote = async () => {
  if (!confirm("Close the revote? Final counts for this position will be based on revote ballots only.")) return;
  try {
    await updateDoc(doc(db, "electionCycles", _cycle.id), {
      "revote.active": false,
      "revote.closedAt": serverTimestamp()
    });
    _cycle.revote = { ..._cycle.revote, active: false };
    loadResults();
  } catch (err) {
    alert("Failed to close revote: " + err.message);
  }
};

async function ecPublishResults() {
  const btn = document.getElementById("ecPublishBtn");
  const msg = document.getElementById("ecPublishMsg");
  if (!confirm("Publish results? This makes them visible to the public and cannot be undone.")) return;
  btn.disabled = true;
  msg.style.color = "var(--muted)"; msg.textContent = "Publishing…";
  try {
    await updateDoc(doc(db, "electionCycles", _cycle.id), {
      phase: "published", publishedAt: serverTimestamp()
    });
    _cycle.phase = "published";
    msg.style.color = "var(--ok)"; msg.textContent = "Published.";
    loadResults();
  } catch (err) {
    msg.style.color = "var(--danger)"; msg.textContent = err.message;
    btn.disabled = false;
  }
}

// ── Bootstrap ─────────────────────────────────────────────────────────────────
protect(["executive", "admin"], async (user, profile) => {
  // Mirrors the Industrial Training Secretary pattern (executive.js <-> industrial-secretary.js):
  // this page is reserved for the EC Chairperson; anyone else is bounced back to executive.html.
  if (profile.role === "executive" && profile.position !== "EC Chairperson") {
    location.replace("executive.html"); return;
  }
  _user = user; _profile = profile;
  registerFCMToken(user.uid, profile.__collection || "executives").catch(() => {});

  initSubHero(user, profile, { page: "ec-chair", active: "tab-dash", tabs: ecTabs() });
  renderECDash();
});

// Exec-only v1 push (Q3 decision, Flag 23 — no mass broadcast to students; that's
// deferred to v2 to avoid one Worker call per student). Best-effort: a missing
// fcmToken (exec never granted notification permission) just means no push, no error.
async function notifyExecsOfPhaseChange(newPhase) {
  try {
    const snap = await getDocs(query(collection(db, "executives"), where("active", "==", true)));
    const title = "Election Update";
    const body = `${_cycle?.name || "The election"} has advanced to ${PHASE_LABELS[newPhase] || newPhase}.`;
    snap.docs.forEach(d => {
      const tok = d.data().fcmToken;
      if (tok) sendPush(tok, title, body);
    });
  } catch (_) { /* best-effort — phase already advanced regardless */ }
}

// Dashboard, Nominations, and Results all depend on the cycle's *current* phase,
// which can change between visits (e.g. EC Chair checks Results during Voting,
// later advances to Counting from the Dashboard, then returns to Results) — so
// none of them are gated behind a "loaded once" guard; each reloads every visit.
// Overview has no live logic yet (Slice 4), so a one-time load is fine for now.
let overviewLoaded = false;
window.shOnTab = (id) => {
  if (id === "tab-dash")     { renderECDash(); return; }
  if (id === "tab-nom")      { loadNominations(); return; }
  if (id === "tab-results")  { loadResults(); return; }
  if (id === "tab-overview" && !overviewLoaded) { overviewLoaded = true; loadOverview(); }
};
