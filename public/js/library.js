import { auth, db } from "./firebase.js";
import { protect } from "./guard.js";
import { initSubHero } from "./subhero.js?v=4";
import { studentTabs } from "./nav.js";
import { UPLOAD_WORKER_URL } from "./config.js";
import { authHeaders } from "./upload.js";
import {
  collection, doc, addDoc, getDocs, getDoc, updateDoc, deleteDoc,
  query, where, limit, serverTimestamp, runTransaction, increment
} from "https://www.gstatic.com/firebasejs/10.12.2/firebase-firestore.js";

// ── Constants ─────────────────────────────────────────────────────────────────
const PROGRAMMES = [
  "Bachelor of Engineering (Agricultural Engineering)",
  "Bachelor of Engineering (Civil and Environmental Engineering)",
  "Bachelor of Engineering (Electrical and Electronic Engineering)",
  "Bachelor of Engineering (Geomatic Engineering)",
  "Bachelor of Engineering (Mechanical Engineering)",
];

const PROG_SHORT = {
  "Bachelor of Engineering (Agricultural Engineering)": "Agricultural Engineering",
  "Bachelor of Engineering (Civil and Environmental Engineering)": "Civil & Environmental Engineering",
  "Bachelor of Engineering (Electrical and Electronic Engineering)": "Electrical & Electronic Engineering",
  "Bachelor of Engineering (Geomatic Engineering)": "Geomatic Engineering",
  "Bachelor of Engineering (Mechanical Engineering)": "Mechanical Engineering",
};

const DEPT_TO_PROG = {
  "Agricultural Engineering":             "Bachelor of Engineering (Agricultural Engineering)",
  "Civil and Environmental Engineering":  "Bachelor of Engineering (Civil and Environmental Engineering)",
  "Electrical and Electronic Engineering":"Bachelor of Engineering (Electrical and Electronic Engineering)",
  "Geomatic Engineering":                 "Bachelor of Engineering (Geomatic Engineering)",
  "Mechanical Engineering":               "Bachelor of Engineering (Mechanical Engineering)",
};

const YEAR_OPTIONS = ["1st Year","2nd Year","3rd Year","4th Year","5th Year"];

const CONTENT_TYPE_LABELS = {
  lecture_notes:"Lecture Notes", past_paper:"Past Paper",
  test_solution:"Test Solution", assignment:"Assignment",
  lab_report:"Lab Report", textbook:"Textbook",
  research:"Research", tutorial:"Tutorial",
  dataset:"Dataset", code:"Code", presentation:"Presentation",
};

// ── SVG icon system ────────────────────────────────────────────────────────────
const _lg = (d, sz=34) =>
  `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 24 24" fill="none" stroke="currentColor" ` +
  `stroke-width="1.75" stroke-linecap="round" stroke-linejoin="round" width="${sz}" height="${sz}">${d}</svg>`;
const _sm = d =>
  `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 24 24" fill="none" stroke="currentColor" ` +
  `stroke-width="2" stroke-linecap="round" stroke-linejoin="round" width="15" height="15" ` +
  `style="vertical-align:-3px;flex-shrink:0">${d}</svg>`;

const ICO = {
  // Programmes
  agri:    _lg('<path d="M12 22V12"/><path d="M12 12c0 0-5-2-5-7a5 5 0 0 1 10 0c0 5-5 7-5 7z"/>'),
  civil:   _lg('<rect x="3" y="7" width="18" height="14" rx="1"/><path d="M9 21V11"/><path d="M15 21V11"/><path d="M5 7V5a2 2 0 0 1 2-2h10a2 2 0 0 1 2 2v2"/>'),
  elec:    _lg('<polygon points="13 2 3 14 12 14 11 22 21 10 12 10 13 2"/>'),
  geo:     _lg('<circle cx="12" cy="12" r="10"/><polygon points="16.24 7.76 14.12 14.12 7.76 16.24 9.88 9.88 16.24 7.76"/>'),
  mech:    _lg('<circle cx="12" cy="12" r="3"/><path d="M19.4 15a1.65 1.65 0 0 0 .33 1.82l.06.06a2 2 0 0 1-2.83 2.83l-.06-.06a1.65 1.65 0 0 0-1.82-.33 1.65 1.65 0 0 0-1 1.51V21a2 2 0 0 1-4 0v-.09A1.65 1.65 0 0 0 9 19.4a1.65 1.65 0 0 0-1.82.33l-.06.06a2 2 0 0 1-2.83-2.83l.06-.06A1.65 1.65 0 0 0 4.68 15a1.65 1.65 0 0 0-1.51-1H3a2 2 0 0 1 0-4h.09A1.65 1.65 0 0 0 4.6 9a1.65 1.65 0 0 0-.33-1.82l-.06-.06a2 2 0 0 1 2.83-2.83l.06.06A1.65 1.65 0 0 0 9 4.68a1.65 1.65 0 0 0 1-1.51V3a2 2 0 0 1 4 0v.09a1.65 1.65 0 0 0 1 1.51 1.65 1.65 0 0 0 1.82-.33l.06-.06a2 2 0 0 1 2.83 2.83l-.06.06A1.65 1.65 0 0 0 19.4 9a1.65 1.65 0 0 0 1.51 1H21a2 2 0 0 1 0 4h-.09a1.65 1.65 0 0 0-1.51 1z"/>'),
  // Year
  cal:     _lg('<rect x="3" y="4" width="18" height="18" rx="2" ry="2"/><line x1="16" y1="2" x2="16" y2="6"/><line x1="8" y1="2" x2="8" y2="6"/><line x1="3" y1="10" x2="21" y2="10"/>'),
  // Subfolders
  clip:    _lg('<path d="M16 4h2a2 2 0 0 1 2 2v14a2 2 0 0 1-2 2H6a2 2 0 0 1-2-2V6a2 2 0 0 1 2-2h2"/><rect x="8" y="2" width="8" height="4" rx="1" ry="1"/><line x1="9" y1="12" x2="15" y2="12"/><line x1="9" y1="16" x2="15" y2="16"/>'),
  solve:   _lg('<path d="M14 2H6a2 2 0 0 0-2 2v16a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V8z"/><polyline points="14 2 14 8 20 8"/><polyline points="9 15 11 17 15 13"/>'),
  book:    _lg('<path d="M2 3h6a4 4 0 0 1 4 4v14a3 3 0 0 0-3-3H2z"/><path d="M22 3h-6a4 4 0 0 0-4 4v14a3 3 0 0 1 3-3h7z"/>'),
  fold:    _lg('<path d="M22 19a2 2 0 0 1-2 2H4a2 2 0 0 1-2-2V5a2 2 0 0 1 2-2h5l2 3h9a2 2 0 0 1 2 2z"/>'),
  // File types
  filePdf: _lg('<path d="M14 2H6a2 2 0 0 0-2 2v16a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V8z"/><polyline points="14 2 14 8 20 8"/><line x1="16" y1="13" x2="8" y2="13"/><line x1="16" y1="17" x2="8" y2="17"/>'),
  fileImg: _lg('<rect x="3" y="3" width="18" height="18" rx="2" ry="2"/><circle cx="8.5" cy="8.5" r="1.5"/><polyline points="21 15 16 10 5 21"/>'),
  fileZip: _lg('<path d="M14 2H6a2 2 0 0 0-2 2v16a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V8z"/><polyline points="14 2 14 8 20 8"/><line x1="12" y1="18" x2="12" y2="12"/><line x1="9.5" y1="15" x2="14.5" y2="15"/>'),
  fileDoc: _lg('<path d="M14 2H6a2 2 0 0 0-2 2v16a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V8z"/><polyline points="14 2 14 8 20 8"/>'),
  // Button icons (small)
  icoDl:   _sm('<path d="M21 15v4a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2v-4"/><polyline points="7 10 12 15 17 10"/><line x1="12" y1="15" x2="12" y2="3"/>'),
  icoView: _sm('<path d="M1 12s4-8 11-8 11 8 11 8-4 8-11 8-11-8-11-8z"/><circle cx="12" cy="12" r="3"/>'),
  icoFlag: _sm('<path d="M4 15s1-1 4-1 5 2 8 2 4-1 4-1V3s-1 1-4 1-5-2-8-2-4 1-4 1z"/><line x1="4" y1="22" x2="4" y2="15"/>'),
  icoOk:   _sm('<polyline points="20 6 9 17 4 12"/>'),
  icoDel:  _sm('<polyline points="3 6 5 6 21 6"/><path d="M19 6v14a2 2 0 0 1-2 2H7a2 2 0 0 1-2-2V6m3 0V4a1 1 0 0 1 1-1h4a1 1 0 0 1 1 1v2"/>'),
  icoUndo: _sm('<polyline points="1 4 1 10 7 10"/><path d="M3.51 15a9 9 0 1 0 .49-4"/>'),
  // States
  empty:   _lg('<polyline points="22 12 16 12 14 15 10 15 8 12 2 12"/><path d="M5.45 5.11L2 12v6a2 2 0 0 0 2 2h16a2 2 0 0 0 2-2v-6l-3.45-6.89A2 2 0 0 0 16.76 4H7.24a2 2 0 0 0-1.79 1.11z"/>'),
  lock:    _lg('<rect x="3" y="11" width="18" height="11" rx="2" ry="2"/><path d="M7 11V7a5 5 0 0 1 10 0v4"/>', 52),
  upload:  _lg('<polyline points="16 16 12 12 8 16"/><line x1="12" y1="12" x2="12" y2="21"/><path d="M20.39 18.39A5 5 0 0 0 18 9h-1.26A8 8 0 1 0 3 16.3"/>'),
};

const PROG_ICO = {
  "Bachelor of Engineering (Agricultural Engineering)":            ICO.agri,
  "Bachelor of Engineering (Civil and Environmental Engineering)": ICO.civil,
  "Bachelor of Engineering (Electrical and Electronic Engineering)":ICO.elec,
  "Bachelor of Engineering (Geomatic Engineering)":                ICO.geo,
  "Bachelor of Engineering (Mechanical Engineering)":              ICO.mech,
};

const SUB_ICO = {
  "Exam and Test Past Papers": ICO.clip,
  "Exam and Test Solutions":   ICO.solve,
  "Text Books":                ICO.book,
  "Others":                    ICO.fold,
};

function fileTypeIcon(ext) {
  if (ext === "pdf") return ICO.filePdf;
  if (["png","jpg","jpeg","gif","webp"].includes(ext)) return ICO.fileImg;
  if (["zip","rar","7z"].includes(ext)) return ICO.fileZip;
  return ICO.fileDoc;
}

// ── State ─────────────────────────────────────────────────────────────────────
const browse = { programme:null, year:null, course:null, subfolder:null };
const _fileCache     = new Map();
const _myReportedIds = new Set();

function _loadReportedIds() {
  try {
    const stored = localStorage.getItem(`uzes:reported:${currentUser.uid}`);
    if (stored) JSON.parse(stored).forEach(id => _myReportedIds.add(id));
  } catch (_) {}
}

function _saveReportedId(fileId) {
  _myReportedIds.add(fileId);
  try {
    localStorage.setItem(`uzes:reported:${currentUser.uid}`, JSON.stringify([..._myReportedIds]));
  } catch (_) {}
}
let allCourses = [];
let currentUser, currentProfile;
let isLibrarian = false;
let selectedFile = null;

// ── Utility ───────────────────────────────────────────────────────────────────
function esc(s) {
  return String(s ?? "")
    .replace(/&/g,"&amp;").replace(/</g,"&lt;")
    .replace(/>/g,"&gt;").replace(/"/g,"&quot;");
}

function fmtDate(ts) {
  if (!ts) return "—";
  try {
    const d = ts.toDate ? ts.toDate() : new Date(ts);
    return d.toLocaleDateString("en-ZM", { day:"2-digit", month:"short", year:"numeric" });
  } catch (_) { return "—"; }
}

// ── File viewer — opens /view.html in a new tab; address bar shows Firebase domain
window.viewLibFile = function(fid) {
  const f = _fileCache.get(fid);
  if (!f?.fileUrl) { alert("File not available"); return; }
  const k = btoa(f.fileUrl);
  const n = encodeURIComponent(f.originalName || "file");
  window.open(`/view.html?k=${encodeURIComponent(k)}&n=${n}`, "_blank");
};

// ── Exported init (called from student.js when Library tab first opens) ───────
export async function initLibrary(user, profile) {
  currentUser    = user;
  currentProfile = profile;
  _loadReportedIds();

  isLibrarian = ["Secretary General","Vice Secretary General"].includes(profile.position)
                || profile.role === "admin";
  const modBadge = document.getElementById("libModBadge");
  if (modBadge) modBadge.style.display = isLibrarian ? "" : "none";

  // Students must have paid Membership Dues
  if (profile.role === "student") {
    const mem = await checkMembership(user.uid);
    if (!mem) {
      const libMainEl = document.getElementById("libMain");
      if (libMainEl) libMainEl.style.display = "none";
      const gateEl = document.getElementById("memberGate");
      if (gateEl) gateEl.style.display = "";
      return;
    }
  }
  document.getElementById("libMain").style.display   = "";
  document.getElementById("uploadFab").style.display = "";

  browse.programme = DEPT_TO_PROG[profile.department] || null;
  browse.year      = profile.yearOfStudy || null;

  allCourses = await loadAllCourses();

  initUploadModal();
  initReportModal();
  renderBrowse();
}

// ── Standalone bootstrap: only runs when opening library.html directly ────────
if (location.pathname.includes("library.html")) {
  protect(["student","executive","admin"], async (user, profile) => {
    initSubHero(user, profile, { page: "library", active: "lib", tabs: studentTabs("library") });
    await initLibrary(user, profile);
  });
}

async function checkMembership(uid) {
  try {
    // Point straight at the confirmed-membership doc — don't pull every payment
    // and sift in JS. limit(1) means Firestore stops at the first match.
    const snap = await getDocs(query(
      collection(db,"payments"),
      where("studentUid","==",uid),
      where("category","==","Membership Dues"),
      where("status","==","confirmed"),
      limit(1)
    ));
    return !snap.empty;
  } catch (_) { return false; }
}

async function loadAllCourses() {
  try {
    const snap = await getDocs(collection(db,"libraryCourses"));
    return snap.docs.map(d => ({ id:d.id, ...d.data() }));
  } catch (_) { return []; }
}

// ── Navigation ────────────────────────────────────────────────────────────────
window.navTo = (level) => {
  if (level === "programme") { browse.programme=null; browse.year=null; browse.course=null; browse.subfolder=null; }
  else if (level === "year")      { browse.year=null; browse.course=null; browse.subfolder=null; }
  else if (level === "course")    { browse.course=null; browse.subfolder=null; }
  else if (level === "subfolder") { browse.subfolder=null; }
  renderBrowse();
};

window.selectProg   = (p) => { browse.programme=p; browse.year=null; browse.course=null; browse.subfolder=null; renderBrowse(); };
window.selectYear   = (y) => { browse.year=y; browse.course=null; browse.subfolder=null; renderBrowse(); };
window.selectCourse = (c) => { browse.course=c; browse.subfolder=null; renderBrowse(); };
window.selectSub    = (s) => { browse.subfolder=s; renderBrowse(); };

// ── Breadcrumb ────────────────────────────────────────────────────────────────
function updateBreadcrumb() {
  const parts = [`<button class="bc-btn" onclick="navTo('programme')">Library</button>`];
  const atLevel = (label, nav, isCurrent) => {
    const el = isCurrent
      ? `<span class="bc-current">${esc(label)}</span>`
      : `<button class="bc-btn" onclick="navTo('${nav}')">${esc(label)}</button>`;
    return `<span class="bc-sep">/</span>${el}`;
  };
  if (browse.programme) parts.push(atLevel(PROG_SHORT[browse.programme] || browse.programme, "year", !browse.year));
  if (browse.year)      parts.push(atLevel(browse.year,      "course",    !browse.course));
  if (browse.course)    parts.push(atLevel(browse.course,    "subfolder", !browse.subfolder));
  if (browse.subfolder) parts.push(atLevel(browse.subfolder, "",          true));
  document.getElementById("breadcrumb").innerHTML = parts.join("");
}

// ── Browse ────────────────────────────────────────────────────────────────────
function renderBrowse() {
  updateBreadcrumb();
  if (!allCourses.length) {
    setContainer(`<div class="lib-empty"><div class="empty-icon">${ICO.empty}</div>
      <p>Library courses not seeded yet.</p>
      <p class="muted small">An admin must run <strong>Seed library courses</strong> in the System settings first.</p></div>`);
    return;
  }
  if (!browse.programme)  renderProgrammes();
  else if (!browse.year)  renderYears();
  else if (!browse.course) renderCourses();
  else if (!browse.subfolder) renderSubfolders();
  else renderFiles();
}

function setContainer(html) {
  document.getElementById("browseContainer").innerHTML = html;
}

function renderProgrammes() {
  const progs = [...new Set(allCourses.map(c => c.programme))].sort();
  const cards = progs.map(p => {
    const count = allCourses.filter(c => c.programme === p).length;
    return `<div class="browse-card" onclick="selectProg(${esc(JSON.stringify(p))})">
      <div class="browse-icon">${PROG_ICO[p]||ICO.fold}</div>
      <div class="browse-label">${esc(PROG_SHORT[p]||p)}</div>
      <div class="browse-sub muted">${count} courses</div>
    </div>`;
  }).join("");
  setContainer(`<p class="lib-section-head">Select programme</p><div class="browse-grid">${cards}</div>`);
}

function renderYears() {
  const available = [...new Set(
    allCourses.filter(c => c.programme === browse.programme).map(c => c.year)
  )].sort();
  const cards = available.map(y => {
    const count = allCourses.filter(c => c.programme === browse.programme && c.year === y).length;
    const note  = (y === "1st Year" || y === "2nd Year") ? " — Common" : "";
    return `<div class="browse-card" onclick="selectYear(${esc(JSON.stringify(y))})">
      <div class="browse-icon">${ICO.cal}</div>
      <div class="browse-label">${esc(y)}${note}</div>
      <div class="browse-sub muted">${count} courses</div>
    </div>`;
  }).join("");
  setContainer(`<p class="lib-section-head">Select year</p><div class="browse-grid">${cards}</div>`);
}

function renderCourses() {
  const courses = allCourses
    .filter(c => c.programme === browse.programme && c.year === browse.year)
    .sort((a,b) => a.courseName.localeCompare(b.courseName));
  if (!courses.length) {
    setContainer(`<div class="lib-empty"><div class="empty-icon">📭</div><p>No courses for this year.</p></div>`);
    return;
  }
  const chips = courses.map(c =>
    `<div class="course-chip" onclick="selectCourse(${esc(JSON.stringify(c.courseName))})">${esc(c.courseName)}</div>`
  ).join("");
  setContainer(`<p class="lib-section-head">Select course</p><div class="course-grid">${chips}</div>`);
}

function renderSubfolders() {
  const subs = ["Exam and Test Past Papers","Exam and Test Solutions","Text Books","Others"];
  const cards = subs.map(s =>
    `<div class="browse-card" onclick="selectSub(${esc(JSON.stringify(s))})">
      <div class="browse-icon">${SUB_ICO[s]||ICO.fold}</div>
      <div class="browse-label">${esc(s)}</div>
    </div>`
  ).join("");
  setContainer(`<p class="lib-section-head">Select category</p><div class="browse-grid">${cards}</div>`);
}

async function renderFiles() {
  setContainer(`<p class="muted">Loading files…</p>`);
  try {
    // Query by courseName; filter subfolder + status client-side (avoids composite index)
    const snap = await getDocs(query(
      collection(db,"libraryFiles"),
      where("courseName","==",browse.course)
    ));

    const files = snap.docs
      .map(d => ({ id:d.id, ...d.data() }))
      .filter(f =>
        f.subfolder === browse.subfolder && (
          isLibrarian
            ? true
            : (f.moderationStatus === "approved" && !f.isFlagged) || _myReportedIds.has(f.id)
        )
      )
      .sort((a,b) => (b.uploadedAt?.seconds||0) - (a.uploadedAt?.seconds||0));

    // Pre-fetch the current user's ratings in ONE query (was N getDocs — one per
    // file). We fetch this member's ratings once, then map by fileId.
    const myRatings = {};
    if (files.length) {
      try {
        const rsnap = await getDocs(query(
          collection(db,"libraryRatings"),
          where("uid","==",currentUser.uid)
        ));
        rsnap.forEach(r => { const d = r.data(); if (d.fileId) myRatings[d.fileId] = d.rating; });
      } catch (_) {}
    }

    if (!files.length) {
      setContainer(`<div class="lib-empty">
        <div class="empty-icon">${ICO.empty}</div>
        <p>No files here yet.</p>
        <p class="muted small">Be the first to contribute — tap the <strong>+</strong> button.</p>
      </div>`);
      return;
    }
    files.forEach(f => _fileCache.set(f.id, f));
    setContainer(files.map(f => fileCardHTML(f, myRatings[f.id]||0)).join(""));
  } catch (err) {
    setContainer(`<p class="error">Failed to load: ${esc(err.message)}</p>`);
  }
}

// ── File card HTML ────────────────────────────────────────────────────────────
function fileCardHTML(f, myRating) {
  const ext     = (f.originalName||"").split(".").pop().toLowerCase();
  const icon    = fileTypeIcon(ext);
  // iReported only matters while the file is still flagged; if librarian restored it, clear state.
  let iReported = _myReportedIds.has(f.id) && f.isFlagged;
  if (_myReportedIds.has(f.id) && !f.isFlagged) {
    _myReportedIds.delete(f.id);
    try { localStorage.setItem(`uzes:reported:${currentUser.uid}`, JSON.stringify([..._myReportedIds])); } catch(_) {}
  }
  const modSt   = iReported ? "reported" : (f.isFlagged ? "flagged" : (f.moderationStatus||"under_review"));
  const modLabel = { approved:"Approved", under_review:"Pending Review", rejected:"Rejected", flagged:"Flagged", reported:"Reported — Under Review" }[modSt];
  const modCls   = { approved:"approved", under_review:"under-review", rejected:"rejected", flagged:"flagged", reported:"under-review" }[modSt] || "under-review";
  const ctLabel  = CONTENT_TYPE_LABELS[f.aiContentType] || "";

  const avg  = f.avgRating   || 0;
  const cnt  = f.ratingCount || 0;
  const stars = [1,2,3,4,5].map(i => {
    const filled = i <= Math.round(avg);
    return `<button class="star${filled?" filled":""}" data-star="${i}"
      onclick="rateFile('${esc(f.id)}',${i})" title="${i} star${i>1?"s":""}">${filled?"★":"☆"}</button>`;
  }).join("");

  const fid = esc(f.id);
  const isViewable = ["pdf","png","jpg","jpeg","gif","webp"].includes(ext);
  // Show view/download for approved files AND for reported-but-flagged files (reporter can still view).
  const canView    = f.fileUrl && ((f.moderationStatus === "approved" && !f.isFlagged) || iReported);
  const downloadBtn = canView
    ? `<button id="dl-${fid}" class="btn-lib primary" onclick="viewLibFile('${fid}')">${isViewable ? ICO.icoView + " View" : ICO.icoDl + " Download"}</button>`
    : "";

  const reportBtn = (f.moderationStatus === "approved" && !f.isFlagged && !iReported)
    ? `<button id="rpt-btn-${fid}" class="btn-lib" onclick="openReport('${fid}')">${ICO.icoFlag} Report</button>`
    : (iReported
      ? `<button id="rpt-btn-${fid}" class="btn-lib" disabled style="opacity:0.7;cursor:default">Already Reported</button>`
      : "");

  let modBtns = "";
  if (isLibrarian) {
    if (f.moderationStatus === "under_review" && !f.isFlagged) {
      modBtns += `<button class="btn-lib approve" onclick="libApprove('${fid}')">${ICO.icoOk} Approve</button>`;
    }
    if (f.isFlagged) {
      modBtns += `<button class="btn-lib" onclick="libRestore('${fid}')">${ICO.icoUndo} Restore</button>`;
    }
    modBtns += `<button class="btn-lib danger" onclick="libDelete('${fid}','${esc(f.r2Key||"")}')">${ICO.icoDel} Delete</button>`;
  }

  const myRatingNote = myRating
    ? `<span class="muted small" style="margin-left:4px">Your rating: ${myRating}★</span>` : "";

  return `<div class="file-card" id="fc-${fid}">
    <div class="file-card-head">
      <div class="file-type-icon">${icon}</div>
      <div style="flex:1;min-width:0">
        <div class="file-title">${esc(f.originalName||"Untitled")}</div>
        <div class="file-meta">${esc(f.courseName)} · ${esc(f.year||"")} · Uploaded by ${esc(f.uploaderName||"—")} · ${fmtDate(f.uploadedAt)}</div>
        <div style="margin-top:6px;display:flex;flex-wrap:wrap;gap:5px">
          <span class="mod-badge ${modCls}" id="badge-${fid}">${modLabel}</span>
          ${ctLabel ? `<span class="mod-badge ai-type">${esc(ctLabel)}</span>` : ""}
        </div>
      </div>
    </div>
    <div class="file-card-footer">
      <div class="stars" id="stars-${fid}">${stars}</div>
      <span class="star-count">(${cnt})</span>
      ${myRatingNote}
      <div style="margin-left:auto;display:flex;gap:6px;flex-wrap:wrap">
        ${downloadBtn}${reportBtn}${modBtns}
      </div>
    </div>
    ${isLibrarian && f.aiReason
      ? `<div style="font-size:12px;color:var(--muted);margin-top:8px;padding-top:8px;border-top:1px solid var(--line)">
           AI: ${esc(f.aiReason)} · Score: ${f.aiScore??"-"}
         </div>`
      : ""}
  </div>`;
}

// ── Star rating ───────────────────────────────────────────────────────────────
window.rateFile = async (fileDocId, newRating) => {
  const ratingId  = `${fileDocId}_${currentUser.uid}`;
  const ratingRef = doc(db,"libraryRatings",ratingId);
  const fileRef   = doc(db,"libraryFiles",  fileDocId);
  try {
    await runTransaction(db, async (tx) => {
      const [rSnap, fSnap] = await Promise.all([tx.get(ratingRef), tx.get(fileRef)]);
      if (!fSnap.exists()) throw new Error("File not found");
      const prevRating = rSnap.exists() ? rSnap.data().rating : 0;
      const oldCount   = fSnap.data().ratingCount || 0;
      const oldSum     = (fSnap.data().avgRating  || 0) * oldCount;
      const newCount   = rSnap.exists() ? oldCount : oldCount + 1;
      const newSum     = rSnap.exists() ? (oldSum - prevRating + newRating) : (oldSum + newRating);
      tx.set(ratingRef,  { fileId:fileDocId, uid:currentUser.uid, rating:newRating, ratedAt:serverTimestamp() });
      tx.update(fileRef, { avgRating: newCount > 0 ? newSum/newCount : 0, ratingCount: newCount });
    });
    // Update stars immediately
    const container = document.getElementById(`stars-${fileDocId}`);
    if (container) {
      container.querySelectorAll(".star").forEach((btn,i) => {
        const f = (i+1) <= newRating;
        btn.textContent = f ? "★" : "☆";
        btn.classList.toggle("filled", f);
      });
    }
  } catch (err) { alert("Rating failed: " + err.message); }
};

// ── Report ────────────────────────────────────────────────────────────────────
window.openReport = (fileId) => {
  document.getElementById("reportFileId").value  = fileId;
  document.getElementById("reportDetail").value  = "";
  document.getElementById("reportErr").textContent = "";
  document.getElementById("reportModal").classList.add("open");
};

function initReportModal() {
  document.getElementById("reportCancel").addEventListener("click", () =>
    document.getElementById("reportModal").classList.remove("open")
  );

  document.getElementById("reportSubmitBtn").addEventListener("click", async () => {
    const fileId  = document.getElementById("reportFileId").value;
    const reason  = document.getElementById("reportReason").value;
    const detail  = document.getElementById("reportDetail").value.trim();
    const errEl   = document.getElementById("reportErr");
    const btn     = document.getElementById("reportSubmitBtn");
    errEl.textContent = "";
    btn.disabled = true; btn.textContent = "Submitting…";
    try {
      await addDoc(collection(db,"libraryReports"), {
        fileId,
        reportedBy:   currentUser.uid,
        reporterName: currentProfile.name || currentUser.email,
        reason: detail ? `${reason}: ${detail}` : reason,
        reportedAt: serverTimestamp(),
        resolved: false,
      });
      await updateDoc(doc(db,"libraryFiles",fileId), {
        isFlagged: true, reportCount: increment(1),
      });
      _saveReportedId(fileId);
      document.getElementById("reportModal").classList.remove("open");
      // Update card in-place — file stays visible; only Report button changes to "Already Reported"
      const rptBtn = document.getElementById(`rpt-btn-${fileId}`);
      if (rptBtn) { rptBtn.disabled = true; rptBtn.innerHTML = "Already Reported"; rptBtn.style.opacity = "0.7"; rptBtn.style.cursor = "default"; rptBtn.onclick = null; }
      const badge = document.getElementById(`badge-${fileId}`);
      if (badge) { badge.className = "mod-badge under-review"; badge.textContent = "Reported — Under Review"; }
    } catch (err) {
      errEl.textContent = "Failed: " + err.message;
    } finally {
      btn.disabled = false; btn.textContent = "Submit report";
    }
  });
}

// ── Librarian actions ─────────────────────────────────────────────────────────
window.libApprove = async (fileDocId) => {
  if (!isLibrarian) return;
  try {
    await updateDoc(doc(db,"libraryFiles",fileDocId), {
      moderationStatus: "approved", isFlagged: false,
      reviewedBy: currentUser.uid, reviewedAt: serverTimestamp(),
    });
    renderFiles();
  } catch (err) { alert("Approve failed: " + err.message); }
};

window.libDelete = async (fileDocId, r2Key) => {
  if (!isLibrarian) return;
  if (!confirm("Permanently delete this file? This cannot be undone.")) return;
  try {
    if (r2Key) {
      await fetch(UPLOAD_WORKER_URL + "/delete", {
        method: "POST", headers: { "Content-Type":"application/json", ...(await authHeaders()) },
        body: JSON.stringify({ key: r2Key }),
      }).catch(() => {});
    }
    const rpts = await getDocs(query(
      collection(db,"libraryReports"), where("fileId","==",fileDocId)
    ));
    await Promise.all(rpts.docs.map(d =>
      updateDoc(d.ref, { resolved:true, resolvedBy:currentUser.uid, resolvedAt:serverTimestamp() })
    ));
    await deleteDoc(doc(db,"libraryFiles",fileDocId));
    document.getElementById(`fc-${fileDocId}`)?.remove();
  } catch (err) { alert("Delete failed: " + err.message); }
};

window.libRestore = async (fileDocId) => {
  if (!isLibrarian) return;
  try {
    await updateDoc(doc(db,"libraryFiles",fileDocId), { isFlagged:false, reportCount:0 });
    const rpts = await getDocs(query(
      collection(db,"libraryReports"),
      where("fileId","==",fileDocId), where("resolved","==",false)
    ));
    await Promise.all(rpts.docs.map(d =>
      updateDoc(d.ref, { resolved:true, resolvedBy:currentUser.uid, resolvedAt:serverTimestamp() })
    ));
    renderFiles();
  } catch (err) { alert("Restore failed: " + err.message); }
};

// ── Upload modal ──────────────────────────────────────────────────────────────
function initUploadModal() {
  const fab      = document.getElementById("uploadFab");
  const modal    = document.getElementById("uploadModal");
  const form     = document.getElementById("uploadForm");
  const cancel   = document.getElementById("uploadCancel");
  const dropZone = document.getElementById("dropZone");
  const fileEl   = document.getElementById("filePickEl");
  const dropText = document.getElementById("dropZoneText");
  const progSel  = document.getElementById("up-programme");
  const yearSel  = document.getElementById("up-year");
  const crseSel  = document.getElementById("up-course");
  const subSel   = document.getElementById("up-sub");
  const statusEl = document.getElementById("uploadStatus");
  const progressBar = document.getElementById("uploadProgressBar");
  const progressFill = document.getElementById("uploadProgressFill");
  const submitBtn = form.querySelector("button[type=submit]");

  // Populate programme + year dropdowns
  PROGRAMMES.forEach(p => {
    const opt = new Option(PROG_SHORT[p]||p, p);
    progSel.appendChild(opt);
  });
  YEAR_OPTIONS.forEach(y => yearSel.appendChild(new Option(y, y)));

  function updateCourseSelect() {
    crseSel.innerHTML = `<option value="">Select course…</option>`;
    const prog = progSel.value, yr = yearSel.value;
    if (!prog || !yr) return;
    allCourses
      .filter(c => c.programme === prog && c.year === yr)
      .sort((a,b) => a.courseName.localeCompare(b.courseName))
      .forEach(c => crseSel.appendChild(new Option(c.courseName, c.courseName)));
  }

  progSel.addEventListener("change", updateCourseSelect);
  yearSel.addEventListener("change", updateCourseSelect);

  function openModal() {
    if (browse.programme) progSel.value = browse.programme;
    if (browse.year)      yearSel.value = browse.year;
    updateCourseSelect();
    if (browse.course)    setTimeout(() => { crseSel.value = browse.course; }, 0);
    if (browse.subfolder) subSel.value  = browse.subfolder;
    selectedFile = null;
    dropText.textContent = "Click or drag a file here";
    fileEl.value = "";
    statusEl.style.display   = "none";
    progressBar.style.display = "none";
    submitBtn.disabled        = false;
    modal.classList.add("open");
  }

  fab.addEventListener("click", openModal);
  cancel.addEventListener("click", () => modal.classList.remove("open"));

  // File pick
  fileEl.addEventListener("change", () => {
    selectedFile = fileEl.files[0] || null;
    dropText.textContent = selectedFile ? selectedFile.name : "Click or drag a file here";
  });

  // Drag-drop
  dropZone.addEventListener("dragover",  e => { e.preventDefault(); dropZone.classList.add("dragover"); });
  dropZone.addEventListener("dragleave", ()  => dropZone.classList.remove("dragover"));
  dropZone.addEventListener("drop", e => {
    e.preventDefault(); dropZone.classList.remove("dragover");
    const f = e.dataTransfer?.files?.[0];
    if (f) { selectedFile = f; dropText.textContent = f.name; }
  });

  // Submit
  form.addEventListener("submit", async (e) => {
    e.preventDefault();
    if (!selectedFile) { showStatus("Please select a file first.", "err"); return; }
    const programme = progSel.value;
    const year      = yearSel.value;
    const course    = crseSel.value;
    const subfolder = subSel.value;
    if (!course) { showStatus("Please select a course.", "err"); return; }

    submitBtn.disabled = true;
    showStatus("Checking for duplicates…", "info");
    progressBar.style.display = "";
    progressFill.style.width  = "10%";

    try {
      // Duplicate gate: query existing files for this course, filter subfolder client-side
      const dupSnap = await getDocs(query(
        collection(db, "libraryFiles"),
        where("courseName", "==", course)
      ));
      const dupExists = dupSnap.docs.some(d => {
        const fd = d.data();
        return fd.subfolder === subfolder
          && (fd.originalName || "").toLowerCase() === (selectedFile.name || "").toLowerCase()
          && fd.moderationStatus !== "rejected";
      });
      if (dupExists) {
        showStatus(`"${selectedFile.name}" already exists in this folder. Rename the file if it's a different version.`, "err");
        submitBtn.disabled = false;
        progressBar.style.display = "none";
        return;
      }

      progressFill.style.width = "20%";
      showStatus("Uploading and screening…", "info");

      const fd = new FormData();
      fd.append("file",      selectedFile);
      fd.append("course",    course);
      fd.append("programme", programme);
      fd.append("year",      year);
      fd.append("subfolder", subfolder);

      const res  = await fetch(UPLOAD_WORKER_URL + "/library/upload", {
        method:"POST", body:fd, headers: { ...(await authHeaders()) }
      });
      const data = await res.json();
      progressFill.style.width = "70%";

      if (!res.ok || !data.ok) throw new Error(data.error || "Upload failed");

      await addDoc(collection(db,"libraryFiles"), {
        courseName:       course,
        programme,
        year,
        subfolder,
        originalName:     data.originalName,
        fileUrl:          data.fileUrl,
        r2Key:            data.r2Key,
        fileId:           data.fileId,
        ext:              (data.originalName||"").split(".").pop().toLowerCase(),
        moderationStatus: data.moderationStatus,
        aiScore:          data.aiScore,
        aiReason:         data.aiReason,
        aiContentType:    data.aiContentType,
        uploadedBy:       currentUser.uid,
        uploaderName:     currentProfile.name || currentUser.email,
        ratingCount:  0, avgRating:  0,
        reportCount:  0, isFlagged:  false,
        uploadedAt: serverTimestamp(),
      });
      progressFill.style.width = "100%";

      const msgs = {
        approved:     "✅ File approved and live in the library!",
        under_review: "⏳ File submitted for staff review. It'll appear once approved.",
        rejected:     "❌ File was rejected by AI screening (not academic content).",
      };
      const types = { approved:"ok", under_review:"info", rejected:"err" };
      showStatus(msgs[data.moderationStatus] || "File uploaded.", types[data.moderationStatus]||"info");

      setTimeout(() => {
        modal.classList.remove("open");
        if (browse.course === course && browse.subfolder === subfolder) renderFiles();
      }, 2400);

    } catch (err) {
      showStatus("Upload failed: " + err.message, "err");
    } finally {
      submitBtn.disabled        = false;
      progressBar.style.display = "none";
    }
  });

  function showStatus(msg, type) {
    statusEl.style.display = "";
    statusEl.className = `upload-status ${type}`;
    statusEl.textContent = msg;
  }
}
