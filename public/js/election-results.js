import { db } from "./firebase-public.js";
import {
  collection, doc, getDoc, getDocs, query, where
} from "https://www.gstatic.com/firebasejs/10.12.2/firebase-firestore.js";

// Same 8 ballot positions as ec-chair.js / student.js — kept local, no shared
// constants module exists in this codebase.
const BALLOT_POSITIONS = [
  "Chairperson", "Vice Chairperson", "Secretary General", "Vice Secretary General",
  "Treasurer", "Information and Publicity Secretary",
  "Social and Cultural Secretary", "Committee Member"
];

function esc(s) {
  return String(s ?? "")
    .replace(/&/g,"&amp;").replace(/</g,"&lt;")
    .replace(/>/g,"&gt;").replace(/"/g,"&quot;");
}

async function init() {
  const main = document.getElementById("resultsMain");
  try {
    const cycleSnap = await getDocs(query(
      collection(db, "electionCycles"),
      where("phase", "==", "published")
    ));
    if (cycleSnap.empty) {
      main.innerHTML = `<p class="muted" style="text-align:center;padding:40px 20px">No election results have been published yet.</p>`;
      return;
    }
    // Most recently published cycle if more than one has ever been published.
    const cycle = cycleSnap.docs
      .map(d => ({ id: d.id, ...d.data() }))
      .sort((a, b) => (b.publishedAt?.seconds ?? 0) - (a.publishedAt?.seconds ?? 0))[0];

    const [contSnap, statsSnap] = await Promise.all([
      getDocs(query(collection(db, "contestants"), where("cycleId", "==", cycle.id), where("status", "==", "approved"))),
      getDoc(doc(db, "electionStats", cycle.id))
    ]);
    const contestants = contSnap.docs.map(d => ({ id: d.id, ...d.data() }));
    const stats = statsSnap.exists() ? statsSnap.data() : { positionResults: {} };

    render(cycle, contestants, stats.positionResults || {});
  } catch (e) {
    main.innerHTML = `<p class="error" style="text-align:center;padding:40px 20px">Could not load results: ${esc(e.message)}</p>`;
  }
}

function render(cycle, contestants, positionResults) {
  const main = document.getElementById("resultsMain");
  const byId = {};
  contestants.forEach(c => { byId[c.id] = c; });

  const publishedDate = cycle.publishedAt?.toDate?.()
    ? cycle.publishedAt.toDate().toLocaleDateString("en-ZM", { day: "2-digit", month: "long", year: "numeric" })
    : "";

  const sections = BALLOT_POSITIONS.filter(pos => positionResults[pos]).map(pos => {
    const r = positionResults[pos];
    const winnerIds = Array.isArray(r.winner) ? r.winner : (r.winner ? [r.winner] : []);
    const winners = winnerIds.map(id => byId[id]).filter(Boolean);
    if (!winners.length) return "";

    const cardsHtml = winners.map(c => {
      const pct = r.totalVotes > 0 ? Math.round(((r.contestants?.[c.id] || 0) / r.totalVotes) * 1000) / 10 : 0;
      return `<div class="result-card">
        <img class="result-photo" src="${esc(c.photoUrl || "")}" alt="${esc(c.studentName)}" onerror="this.style.visibility='hidden'">
        <div class="result-name">${esc(c.studentName)}</div>
        <div class="result-meta">${esc(c.yearOfStudy || "")} · ${esc(c.department || "")}</div>
        <div class="result-meta">${esc(c.compNumber || "")}</div>
        <div class="result-votes">${r.contestants?.[c.id] || 0} votes (${pct}%)</div>
        ${c.manifestoUrl ? `<a href="${esc(c.manifestoUrl)}" target="_blank" rel="noopener" class="result-manifesto">View Manifesto</a>` : ""}
      </div>`;
    }).join("");

    return `<section class="result-section">
      <h2 class="result-pos-title">${esc(pos)} 🏆</h2>
      <div class="result-cards">${cardsHtml}</div>
      ${r.isRevoteActive ? `<p class="muted small" style="margin-top:8px">A revote was held for this position.</p>` : ""}
    </section>`;
  }).join("");

  const totalVotesCast = Object.values(positionResults).reduce((sum, r) => Math.max(sum, r.totalVotes || 0), 0);

  main.innerHTML = `
    <div class="result-header">
      <h1>${esc(cycle.name)}</h1>
      ${publishedDate ? `<p class="muted">Published: ${publishedDate}</p>` : ""}
    </div>
    ${sections || `<p class="muted" style="text-align:center;padding:20px">No results to display yet.</p>`}
    <div class="result-stats-card">
      <p class="muted small">Total ballots cast (largest single position count): ${totalVotesCast}</p>
    </div>`;
}

init();
