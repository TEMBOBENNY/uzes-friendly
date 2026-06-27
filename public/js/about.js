import { db } from "./firebase-public.js";
import {
  collection, doc, getDoc, getDocs, query, where
} from "https://www.gstatic.com/firebasejs/10.12.2/firebase-firestore.js";

const TIER_LABELS = {
  1: "Patron(s)",
  2: "Chairperson",
  3: "Vice Chairperson",
  4: "Secretariat & Treasury",
  5: "Secretaries",
  6: "Committee Members"
};

const DEFAULT_MISSION =
  "UZES is the student association for all engineering students at the University of Zambia. " +
  "We promote academic excellence, professional development, fellowship and cultural enrichment " +
  "across all departments of the School of Engineering.";

async function init() {
  // Mission text
  try {
    const snap = await getDoc(doc(db, "siteContent", "about"));
    document.getElementById("missionText").textContent =
      (snap.exists() && snap.data().mission) ? snap.data().mission : DEFAULT_MISSION;
  } catch (_) {
    document.getElementById("missionText").textContent = DEFAULT_MISSION;
  }

  // Exec profiles
  const chart = document.getElementById("orgChart");
  try {
    const snap = await getDocs(query(
      collection(db, "execProfiles"),
      where("published", "==", true)
    ));

    if (snap.empty) {
      chart.innerHTML = `<p class="muted" style="text-align:center;padding:40px 0">
        The leadership directory is being set up. Check back soon.
      </p>`;
      return;
    }

    const profiles = snap.docs.map(d => ({ id: d.id, ...d.data() }));
    profiles.sort((a, b) => (a.tier - b.tier) || (a.rank - b.rank));

    const byTier = {};
    profiles.forEach(p => { (byTier[p.tier] = byTier[p.tier] || []).push(p); });

    const tiers = Object.keys(byTier).map(Number).sort((a, b) => a - b);
    const parts = [];
    tiers.forEach((tier, idx) => {
      if (idx > 0) parts.push('<div class="org-connector"></div>');
      parts.push(`<div class="org-tier">
        <div class="org-tier-label">${TIER_LABELS[tier] || `Tier ${tier}`}</div>
        <div class="tier-cards">`);
      byTier[tier].forEach(p => { parts.push(execCardHTML(p)); });
      parts.push("</div></div>");
    });

    chart.innerHTML = parts.join("");
    chart.addEventListener("click", e => {
      const card = e.target.closest(".exec-card");
      if (!card) return;
      const id = card.dataset.id;
      const profile = profiles.find(p => p.id === id);
      if (profile) openDialog(profile);
    });

  } catch (e) {
    chart.innerHTML = `<p class="error">Could not load leadership data: ${e.message}</p>`;
  }
}

function esc(s) {
  return String(s ?? "").replace(/&/g,"&amp;").replace(/</g,"&lt;").replace(/>/g,"&gt;").replace(/"/g,"&quot;").replace(/'/g,"&#39;");
}

// Only allow https://, http://, mailto: and tel: schemes — blocks javascript: and data: URLs
function safeUrl(u) {
  if (!u) return null;
  const s = String(u).trim();
  if (/^https?:\/\//i.test(s) || /^mailto:/i.test(s) || /^tel:/i.test(s)) return s;
  return null;
}

function execCardHTML(p) {
  const initials = (p.name || "?").split(" ").map(w => w[0]).join("").slice(0, 2).toUpperCase();
  const photoSrc = safeUrl(p.photoUrl);
  const photoEl = photoSrc
    ? `<img src="${esc(photoSrc)}" alt="${esc(p.name)}" class="exec-photo">`
    : `<div class="exec-photo-placeholder">${esc(initials)}</div>`;
  return `<div class="exec-card" data-id="${esc(p.id)}" tabindex="0" role="button"
      aria-label="View profile of ${esc(p.name)}">
    ${photoEl}
    <div class="exec-name">${esc(p.name) || "—"}</div>
    <div class="exec-pos">${esc(p.position) || "—"}</div>
  </div>`;
}

function openDialog(p) {
  const initials = (p.name || "?").split(" ").map(w => w[0]).join("").slice(0, 2).toUpperCase();
  const photoSrc = safeUrl(p.photoUrl);
  const photoEl = photoSrc
    ? `<img src="${esc(photoSrc)}" alt="${esc(p.name)}" class="dialog-photo">`
    : `<div class="dialog-photo-placeholder">${esc(initials)}</div>`;

  const socials = p.socials || {};
  const links = [];
  if (p.email)          links.push(`<a href="mailto:${esc(p.email)}">✉ ${esc(p.email)}</a>`);
  if (p.phone)          links.push(`<a href="tel:${esc(p.phone)}">📞 ${esc(p.phone)}</a>`);
  const socialEntries = [
    [socials.linkedin, "LinkedIn ↗"],
    [socials.facebook, "Facebook ↗"],
    [socials.x,        "X / Twitter ↗"],
    [socials.instagram,"Instagram ↗"],
  ];
  for (const [url, label] of socialEntries) {
    const safe = safeUrl(url);
    if (safe) links.push(`<a href="${esc(safe)}" target="_blank" rel="noopener noreferrer">${label}</a>`);
  }

  document.getElementById("dialogBody").innerHTML = `
    ${photoEl}
    <div class="dialog-name">${esc(p.name) || "—"}</div>
    <div class="dialog-pos">${esc(p.position) || "—"}</div>
    ${p.bio ? `<p class="dialog-bio">${esc(p.bio)}</p>` : ""}
    ${links.length ? `<div class="dialog-meta">${links.join("")}</div>` : ""}
    ${p.department || p.yearOfStudy ? `
      <div class="dialog-meta" style="margin-top:10px;color:var(--muted)">
        ${p.department ? `<span>${esc(p.department)}</span>` : ""}
        ${p.yearOfStudy ? `<span>${esc(p.yearOfStudy)}</span>` : ""}
      </div>` : ""}
  `;
  document.getElementById("profileDialog").showModal();
}

init();
