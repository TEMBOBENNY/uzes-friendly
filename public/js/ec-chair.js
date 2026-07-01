import { db } from "./firebase.js";
import { protect } from "./guard.js";
import { initSubHero } from "./subhero.js?v=4";
import { ecTabs } from "./nav.js";
import {
  doc, getDoc
} from "https://www.gstatic.com/firebasejs/10.12.2/firebase-firestore.js";

// Event delegation for all dynamically-generated action buttons (Slice 2+)
document.addEventListener("click", e => {
  const el = e.target.closest("[data-action^='ec:']");
  if (!el) return;
  const d = el.dataset;
  switch (d.action) {
    // Nominations / Results / Overview actions are wired in Slice 2 and 3.
  }
});

let _user, _profile;

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

// ── Dashboard ─────────────────────────────────────────────────────────────────
function renderECDash() {
  const dc = document.getElementById("dashContent");
  if (!dc) return;
  const name = _profile?.name || _user?.email || "EC Chairperson";
  dc.innerHTML = `
    <div style="margin-bottom:14px;background:var(--green);color:#fff;padding:22px 24px;border-radius:14px;box-shadow:0 4px 14px rgba(0,85,165,.15)">
      <div style="font-size:20px;font-weight:800;color:#fff">${getDashGreeting()}, ${esc(name)}.</div>
      <div style="font-size:14px;margin-top:6px;color:#dbeafe">Electoral Commission Chairperson &nbsp;·&nbsp; Here's your role overview.</div>
    </div>
    <div class="card" style="padding:20px 22px;margin-bottom:12px">
      <div style="font-size:15px;font-weight:700;margin-bottom:12px;color:var(--text)">No active election cycle</div>
      <p class="muted small">The Admin (Patron) has not created an election cycle yet. Once created, this Dashboard will show the phase pipeline and live KPIs (nominations, fees collected, votes cast, turnout).</p>
    </div>
    <div class="card" style="padding:20px 22px">
      <div style="font-size:15px;font-weight:700;margin-bottom:12px;color:var(--text)">Account</div>
      <ul style="margin:0;padding-left:18px;line-height:1.8;font-size:14px;color:var(--text)">
        <li>Update your profile signature</li>
        <li>Change your account password</li>
      </ul>
    </div>`;
}

// ── Nominations (scaffold — full logic in Slice 2) ─────────────────────────────
async function loadNominations() {
  const list = document.getElementById("ecPaymentsList");
  if (list) list.innerHTML = "<p class='muted small'>No election cycle active yet.</p>";
  const roster = document.getElementById("contestantRoster");
  if (roster) roster.innerHTML = "<p class='muted small'>No contestants yet.</p>";
}

// ── Overview (scaffold — full logic in Slice 4) ────────────────────────────────
async function loadOverview() {
  const stats = document.getElementById("ecOverviewStats");
  if (stats) stats.innerHTML = "<p class='muted small'>Student overview will appear once an election cycle is active.</p>";
}

// ── Results (scaffold — full logic in Slice 3) ─────────────────────────────────
async function loadResults() {
  const content = document.getElementById("ecResultsContent");
  if (content) content.innerHTML = "<p class='muted small'>No election cycle active yet — nothing to count.</p>";
}

// ── Bootstrap ─────────────────────────────────────────────────────────────────
protect(["executive", "admin"], async (user, profile) => {
  // Mirrors the Industrial Training Secretary pattern (executive.js <-> industrial-secretary.js):
  // this page is reserved for the EC Chairperson; anyone else is bounced back to executive.html.
  if (profile.role === "executive" && profile.position !== "EC Chairperson") {
    location.replace("executive.html"); return;
  }
  _user = user; _profile = profile;

  initSubHero(user, profile, { page: "ec-chair", active: "tab-dash", tabs: ecTabs() });
  renderECDash();
});

// Lazy-load each tab the first time the sub-hero reveals it.
const loaded = new Set();
window.shOnTab = (id) => {
  // Dashboard re-renders cheaply on every visit — no guard needed
  if (id === "tab-dash") { renderECDash(); return; }
  if (loaded.has(id)) return;
  loaded.add(id);
  if (id === "tab-nom")      loadNominations();
  if (id === "tab-overview") loadOverview();
  if (id === "tab-results")  loadResults();
};
