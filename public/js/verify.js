// Public receipt verification page — no auth required.
// Reads from the publicly-readable `verifications` Firestore collection.
import { initializeApp } from "https://www.gstatic.com/firebasejs/10.12.2/firebase-app.js";
import { getFirestore, doc, getDoc }
  from "https://www.gstatic.com/firebasejs/10.12.2/firebase-firestore.js";
import { firebaseConfig } from "./config.js";

const app = initializeApp(firebaseConfig, "verify");
const db  = getFirestore(app);

// ── Security: validate URL params before touching Firestore ───────────────────
function parseAndValidateParams() {
  const p   = new URLSearchParams(location.search);
  const no  = p.get("no");
  const tok = p.get("tok");
  if (!no  || !/^\d{1,10}$/.test(no))       return null;
  if (!tok || !/^[0-9a-f]{32}$/i.test(tok)) return null;
  if ([...p.keys()].length > 2)              return null;
  return { no, tok };
}

function esc(s) {
  return String(s || "").replace(/&/g,"&amp;").replace(/</g,"&lt;").replace(/>/g,"&gt;");
}

function fmtAmount(v) {
  return "K " + parseFloat(v || 0).toFixed(2);
}

// ── Render helpers ────────────────────────────────────────────────────────────
function renderFail(el, title, body) {
  el.innerHTML = `
    <div class="verify-result verify-fail">
      <div class="verify-big-icon">&#10007;</div>
      <div class="verify-title">${title}</div>
      <p class="verify-subtitle">${body}</p>
    </div>`;
}

function renderOk(el, d) {
  const rows = [
    ["Student",      d.studentName],
    ["Comp #",       d.compNumber],
    ["Category",     d.category],
    ["Amount",       fmtAmount(d.amount)],
    ["Method",       d.method || "—"],
    ["Receipt #",    d.receiptNo],
    ["Confirmed by", `${d.reviewerName} (${d.reviewerPosition})`],
  ];
  el.innerHTML = `
    <div class="verify-result verify-ok">
      <div class="verify-big-icon">&#10003;</div>
      <div class="verify-title">Receipt Verified</div>
      <p class="verify-subtitle">This receipt is authentic and was issued by UZES.</p>
      <span class="verify-badge">&#10003; GENUINE RECEIPT</span>
    </div>
    <div class="verify-details" style="margin-top:20px">
      ${rows.map(([label, val]) => `
        <div class="verify-row">
          <span class="verify-row-label">${label}</span>
          <span class="verify-row-val">${esc(String(val ?? "—"))}</span>
        </div>`).join("")}
    </div>`;
}

// ── Main ──────────────────────────────────────────────────────────────────────
async function run() {
  const el = document.getElementById("verifyResult");

  const params = parseAndValidateParams();
  if (!params) {
    renderFail(el,
      "Invalid Link",
      "This verification link is malformed or has been tampered with.");
    return;
  }

  try {
    const snap = await getDoc(doc(db, "verifications", params.no));

    if (!snap.exists()) {
      renderFail(el,
        "Receipt Not Found",
        `Receipt #${params.no} was not found in UZES records. ` +
        "It may not have been issued by this system.");
      return;
    }

    const d = snap.data();

    if (d.tok !== params.tok) {
      renderFail(el,
        "Verification Failed",
        "The receipt token does not match. This PDF may have been altered.");
      return;
    }

    renderOk(el, d);

  } catch (err) {
    renderFail(el,
      "Lookup Error",
      "Could not reach the verification server. Check your internet connection and try again.");
    console.error("verify.js:", err);
  }
}

run();
