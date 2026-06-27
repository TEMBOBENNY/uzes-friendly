import { db } from "./firebase-public.js";
import {
  collection, getDocs, query, where, orderBy
} from "https://www.gstatic.com/firebasejs/10.12.2/firebase-firestore.js";

const STATUS_COLORS = {
  upcoming: "#1a6fb5", ongoing: "#1e8a4c", past: "#6a7686", cancelled: "#c0392b"
};

let allActivities = [];
let activeFilter  = "all";

async function init() {
  const grid = document.getElementById("actGrid");
  try {
    const snap = await getDocs(query(
      collection(db, "activities"),
      where("published", "==", true)
    ));
    allActivities = snap.docs.map(d => ({ id: d.id, ...d.data() }))
      .sort((a, b) => {
        const ta = a.date?.toDate?.() || new Date(a.date||0);
        const tb = b.date?.toDate?.() || new Date(b.date||0);
        return tb - ta; // newest first
      });
    renderGrid();
  } catch (e) {
    grid.innerHTML = `<p class="error" style="grid-column:1/-1">Could not load activities: ${e.message}</p>`;
  }

  // Wire filters
  document.getElementById("actFilters").addEventListener("click", e => {
    const btn = e.target.closest(".filter-pill");
    if (!btn) return;
    document.querySelectorAll(".filter-pill").forEach(b => b.classList.remove("active"));
    btn.classList.add("active");
    activeFilter = btn.dataset.filter;
    renderGrid();
  });
}

function renderGrid() {
  const grid = document.getElementById("actGrid");
  const statuses  = ["upcoming", "ongoing", "past", "cancelled"];
  const isStatus  = statuses.includes(activeFilter);

  const filtered = activeFilter === "all"
    ? allActivities
    : allActivities.filter(a =>
        isStatus ? a.status === activeFilter : a.category === activeFilter
      );

  if (!filtered.length) {
    grid.innerHTML = `<div class="empty-state">
      <div class="empty-state-icon">📅</div>
      <h3>No activities found</h3>
      <p>Try a different filter or check back soon.</p>
    </div>`;
    return;
  }

  grid.innerHTML = filtered.map(a => actCardHTML(a)).join("");
}

function actCardHTML(a) {
  const statusColor = STATUS_COLORS[a.status] || "#555";
  const dateStr = a.date?.toDate
    ? a.date.toDate().toLocaleDateString("en-ZM", { day: "2-digit", month: "short", year: "numeric" })
    : (a.date || "");

  // Location may be a physical venue OR a pasted link for online events.
  const locStr  = (a.location || "").trim();
  const isLink  = /^(https?:\/\/|www\.)/i.test(locStr);
  const locHTML = !locStr ? ""
    : isLink
      ? `🔗 <a href="${locStr.startsWith("http") ? locStr : "https://" + locStr}" target="_blank" rel="noopener">Join online</a>`
      : `📍 ${locStr}`;
  const metaParts = [];
  if (dateStr) metaParts.push(`📅 ${dateStr}`);
  if (locHTML) metaParts.push(locHTML);
  const metaLine = metaParts.length
    ? `<div class="act-meta">${metaParts.join(" &nbsp;·&nbsp; ")}</div>` : "";

  return `<div class="act-card">
    ${a.posterUrl
      ? `<div class="act-poster"><img src="${a.posterUrl}" alt="${a.title}" style="width:100%;height:160px;object-fit:cover;display:block"></div>`
      : `<div class="act-poster">${a.category || "UZES"}</div>`}
    <div class="act-card-body">
      <div class="act-title">${a.title || "Untitled"}</div>
      ${metaLine}
      <div class="act-badges">
        ${a.category ? `<span class="act-cat-badge">${a.category}</span>` : ""}
        <span class="act-status-pill" style="background:${statusColor}">${(a.status||"").toUpperCase()}</span>
      </div>
      ${a.description ? `<p class="act-desc">${a.description.slice(0,140)}${a.description.length>140?"…":""}</p>` : ""}
    </div>
  </div>`;
}

init();
