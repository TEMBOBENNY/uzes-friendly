import { db } from "./firebase-public.js";
import {
  doc, getDoc, getDocs, collection, query, where
} from "https://www.gstatic.com/firebasejs/10.12.2/firebase-firestore.js";

const DEFAULTS = {
  email: "uzesofficial@gmail.com",
  whatsapp: "",
  poBox: "The Dean, School of Engineering\nUniversity of Zambia\nP.O. Box 32379, Great East Road Campus, Lusaka",
};

// Brand glyphs (simple-icons paths), tinted with currentColor.
const ICON = {
  facebook:  '<svg viewBox="0 0 24 24" width="18" height="18" fill="currentColor" aria-hidden="true"><path d="M9.101 23.691v-7.98H6.627v-3.667h2.474v-1.58c0-4.085 1.848-5.978 5.858-5.978.401 0 .955.042 1.468.103a8.68 8.68 0 0 1 1.141.195v3.325a8.623 8.623 0 0 0-.653-.036 26.805 26.805 0 0 0-.733-.009c-.707 0-1.259.096-1.675.309a1.686 1.686 0 0 0-.679.622c-.258.42-.374.995-.374 1.752v1.297h3.919l-.386 2.103-.287 1.564h-3.246v8.245C19.396 23.238 24 18.179 24 12.044c0-6.627-5.373-12-12-12s-12 5.373-12 12c0 5.628 3.874 10.35 9.101 11.647Z"/></svg>',
  instagram: '<svg viewBox="0 0 24 24" width="18" height="18" fill="currentColor" aria-hidden="true"><path d="M12 2.163c3.204 0 3.584.012 4.85.07 3.252.148 4.771 1.691 4.919 4.919.058 1.265.069 1.645.069 4.849 0 3.205-.012 3.584-.069 4.849-.149 3.225-1.664 4.771-4.919 4.919-1.266.058-1.644.07-4.85.07-3.204 0-3.584-.012-4.849-.07-3.26-.149-4.771-1.699-4.919-4.92-.058-1.265-.07-1.644-.07-4.849 0-3.204.012-3.583.07-4.849.149-3.227 1.664-4.771 4.919-4.919 1.266-.057 1.645-.069 4.849-.069ZM12 0C8.741 0 8.333.014 7.053.072 2.695.272.273 2.69.073 7.052.014 8.333 0 8.741 0 12c0 3.259.014 3.668.072 4.948.2 4.358 2.618 6.78 6.98 6.98C8.333 23.986 8.741 24 12 24c3.259 0 3.668-.014 4.948-.072 4.354-.2 6.782-2.618 6.979-6.98.059-1.28.073-1.689.073-4.948 0-3.259-.014-3.667-.072-4.947-.196-4.354-2.617-6.78-6.979-6.98C15.668.014 15.259 0 12 0Zm0 5.838a6.162 6.162 0 1 0 0 12.324 6.162 6.162 0 0 0 0-12.324ZM12 16a4 4 0 1 1 0-8 4 4 0 0 1 0 8Zm6.406-11.845a1.44 1.44 0 1 0 0 2.881 1.44 1.44 0 0 0 0-2.881Z"/></svg>',
  tiktok:    '<svg viewBox="0 0 24 24" width="18" height="18" fill="currentColor" aria-hidden="true"><path d="M12.525.02c1.31-.02 2.61-.01 3.91-.02.08 1.53.63 3.09 1.75 4.17 1.12 1.11 2.7 1.62 4.24 1.79v4.03c-1.44-.05-2.89-.35-4.2-.97-.57-.26-1.1-.59-1.62-.93-.01 2.92.01 5.84-.02 8.75-.08 1.4-.54 2.79-1.35 3.94-1.31 1.92-3.58 3.17-5.91 3.21-1.43.08-2.86-.31-4.08-1.03-2.02-1.19-3.44-3.37-3.65-5.71-.02-.5-.03-1-.01-1.49.18-1.9 1.12-3.72 2.58-4.96 1.66-1.44 3.98-2.13 6.15-1.72.02 1.48-.04 2.96-.04 4.44-.99-.32-2.15-.23-3.02.37-.63.41-1.11 1.04-1.36 1.75-.21.51-.15 1.07-.14 1.61.24 1.64 1.82 3.02 3.5 2.87 1.12-.01 2.19-.66 2.77-1.61.19-.33.4-.67.41-1.06.1-1.79.06-3.57.07-5.36.01-4.03-.01-8.05.02-12.07z"/></svg>',
  linkedin:  '<svg viewBox="0 0 24 24" width="18" height="18" fill="currentColor" aria-hidden="true"><path d="M20.447 20.452h-3.554v-5.569c0-1.328-.027-3.037-1.852-3.037-1.853 0-2.136 1.445-2.136 2.939v5.667H9.351V9h3.414v1.561h.046c.477-.9 1.637-1.85 3.37-1.85 3.601 0 4.267 2.37 4.267 5.455v6.286zM5.337 7.433a2.062 2.062 0 0 1-2.063-2.065 2.064 2.064 0 1 1 2.063 2.065zm1.782 13.019H3.555V9h3.564v11.452zM22.225 0H1.771C.792 0 0 .774 0 1.729v20.542C0 23.227.792 24 1.771 24h20.451C23.2 24 24 23.227 24 22.271V1.729C24 .774 23.2 0 22.225 0z"/></svg>',
};
const SOCIAL_LABEL = { facebook: "Facebook", instagram: "Instagram", tiktok: "TikTok", linkedin: "LinkedIn" };

function esc(s) {
  return String(s).replace(/[&<>"]/g, c => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;" }[c]));
}

function contactRow(icon, label, valueHTML) {
  return `<div class="contact-row">
    <span class="contact-icon">${icon}</span>
    <div><div class="contact-label">${label}</div><div class="contact-value">${valueHTML}</div></div>
  </div>`;
}

function renderContact(c) {
  const rows = [];
  if (c.email) {
    rows.push(contactRow("✉️", "Email", `<a href="mailto:${esc(c.email)}">${esc(c.email)}</a>`));
  }
  if (c.whatsapp) {
    const digits = c.whatsapp.replace(/[^\d]/g, "");
    rows.push(contactRow("💬", "WhatsApp",
      `<a href="https://wa.me/${digits}" target="_blank" rel="noopener">${esc(c.whatsapp)}</a>`));
  }
  if (c.poBox) {
    rows.push(contactRow("📍", "Postal address", esc(c.poBox).replace(/\n/g, "<br>")));
  }
  document.getElementById("contactInfo").innerHTML =
    rows.join("") || "<p class='muted'>Contact details coming soon.</p>";
}

function renderSocial(s) {
  const order = ["facebook", "instagram", "tiktok", "linkedin"];
  const items = order.filter(k => s[k] && s[k].trim()).map(k => {
    let url = s[k].trim();
    if (!/^https?:\/\//i.test(url)) url = "https://" + url;
    return `<a class="social-link" href="${esc(url)}" target="_blank" rel="noopener">
      ${ICON[k]}<span>${SOCIAL_LABEL[k]}</span></a>`;
  });
  document.getElementById("socialLinks").innerHTML = items.length
    ? `<div class="social-links">${items.join("")}</div>`
    : "<p class='muted'>Social media links coming soon.</p>";
}

(async () => {
  const c = { ...DEFAULTS };
  let social = {};
  try {
    const [cs, ss] = await Promise.all([
      getDoc(doc(db, "siteContent", "contact")),
      getDoc(doc(db, "siteContent", "social")),
    ]);
    if (cs.exists()) {
      const d = cs.data();
      ["email", "whatsapp", "poBox"].forEach(k => { if (d[k]) c[k] = d[k]; });
    }
    if (ss.exists()) social = ss.data();
  } catch (_) { /* fall back to defaults */ }
  renderContact(c);
  renderSocial(social);
})();

// ── "Who to contact" → profile popup (same as the leadership dialog) ─────────────
function openRoleDialog(p, role) {
  const body = document.getElementById("dialogBody");
  if (!p) {
    body.innerHTML = `
      <div class="dialog-photo-placeholder">?</div>
      <div class="dialog-name">${esc(role)}</div>
      <div class="dialog-pos">Role not published yet</div>
      <p class="dialog-bio">This profile hasn't been added yet. In the meantime, email
        <a href="mailto:uzesofficial@gmail.com">uzesofficial@gmail.com</a> and we'll direct your enquiry.</p>`;
    document.getElementById("profileDialog").showModal();
    return;
  }
  const initials = (p.name || "?").split(" ").map(w => w[0]).join("").slice(0, 2).toUpperCase();
  const photoEl = p.photoUrl
    ? `<img src="${esc(p.photoUrl)}" alt="${esc(p.name)}" class="dialog-photo">`
    : `<div class="dialog-photo-placeholder">${initials}</div>`;
  const links = [];
  if (p.email) links.push(`<a href="mailto:${esc(p.email)}">✉ ${esc(p.email)}</a>`);
  if (p.phone) links.push(`<a href="tel:${esc(p.phone)}">📞 ${esc(p.phone)}</a>`);
  body.innerHTML = `
    ${photoEl}
    <div class="dialog-name">${esc(p.name || "—")}</div>
    <div class="dialog-pos">${esc(p.position || role)}</div>
    ${p.bio ? `<p class="dialog-bio">${esc(p.bio)}</p>` : ""}
    ${links.length ? `<div class="dialog-meta">${links.join("")}</div>` : ""}
    ${(p.department || p.yearOfStudy) ? `<div class="dialog-meta" style="margin-top:10px;color:var(--muted)">
        ${p.department ? `<span>${esc(p.department)}</span>` : ""}
        ${p.yearOfStudy ? `<span>${esc(p.yearOfStudy)}</span>` : ""}
      </div>` : ""}`;
  document.getElementById("profileDialog").showModal();
}

const byPosition = {};

// Attach the click handler immediately so a tap works even before profiles load.
document.getElementById("whoGrid").addEventListener("click", e => {
  const btn = e.target.closest(".who-card");
  if (!btn) return;
  openRoleDialog(byPosition[btn.dataset.position], btn.dataset.position);
});

(async () => {
  try {
    const snap = await getDocs(query(collection(db, "execProfiles"), where("published", "==", true)));
    snap.docs.forEach(d => {
      const p = d.data();
      if (p.position) byPosition[p.position] = { id: d.id, ...p };
    });
  } catch (_) { /* dialog will show the vacant-role fallback */ }
})();
