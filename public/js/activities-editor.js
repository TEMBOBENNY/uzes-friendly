// Activities editor — lazy-loaded for Info & Publicity + Social & Cultural + Admin.
import { db } from "./firebase.js";
import { uploadProof, deleteUpload } from "./upload.js";
import {
  collection, doc, getDoc, addDoc, updateDoc, deleteDoc, getDocs,
  query, orderBy, serverTimestamp, Timestamp
} from "https://www.gstatic.com/firebasejs/10.12.2/firebase-firestore.js";

const CATEGORIES = ["Sports", "Cultural", "Academic", "Social", "BENG CUP", "Other"];
const STATUSES   = ["upcoming", "ongoing", "past", "cancelled"];
const STATUS_COLORS = {
  upcoming: "#1a6fb5", ongoing: "#1e8a4c", past: "#6a7686", cancelled: "#c0392b"
};

let _user, _profile;
let editing          = null;
let pendingPoster    = null;
let editingPosterUrl = "";

export function initActivitiesEditor(user, profile) {
  _user = user; _profile = profile;
  const panel = document.getElementById("tab-activities");
  panel.innerHTML = buildUI();

  panel.addEventListener("click", handleClick);

  document.getElementById("ae-toggle").addEventListener("click", toggleForm);

  // Poster upload
  document.getElementById("ae-posterInput").addEventListener("change", () => {
    const file = document.getElementById("ae-posterInput").files[0];
    if (!file) return;
    pendingPoster = file;
    const reader = new FileReader();
    reader.onload = e => {
      const preview = document.getElementById("ae-posterPreview");
      preview.src = e.target.result; preview.style.display = "block";
      document.getElementById("ae-posterPlaceholder").style.display = "none";
    };
    reader.readAsDataURL(file);
  });

  document.getElementById("ae-form").addEventListener("submit", saveActivity);
  document.getElementById("ae-cancel").addEventListener("click", resetForm);

  loadActivities();
}

function buildUI() {
  const catOpts     = CATEGORIES.map(c => `<option value="${c}">${c}</option>`).join("");
  const statusOpts  = STATUSES.map(s => `<option value="${s}">${s}</option>`).join("");
  return `
  <div class="card" style="margin-top:16px">
    <p class="section-head">Activities</p>
    <p class="muted small" style="margin-bottom:12px">
      Visible on the public Activities page when Published. Both Information &amp; Publicity
      and Social &amp; Cultural secretaries can manage activities.
    </p>
    <button class="toggle-form-btn" id="ae-toggle">+ Add activity</button>
    <div class="form-collapse" id="ae-formWrap">
      <form id="ae-form" style="margin-top:4px">
        <p class="section-head" id="ae-formHead" style="font-size:13px;margin-bottom:12px">New activity</p>
        <div class="act-editor-grid">
          <div>
            <label for="ae-title">Title</label>
            <input id="ae-title" required placeholder="e.g. BENG CUP 2025">
          </div>
          <div>
            <label for="ae-category">Category</label>
            <select id="ae-category" required>${catOpts}</select>
          </div>
          <div class="full" style="grid-column:1/-1">
            <label for="ae-description">Description</label>
            <textarea id="ae-description" rows="3" placeholder="Details about the activity…" style="resize:vertical"></textarea>
          </div>
          <div>
            <label for="ae-date">Date</label>
            <input id="ae-date" type="date">
          </div>
          <div>
            <label for="ae-location">Location / online link <span class="muted small">(optional)</span></label>
            <input id="ae-location" placeholder="Venue name, or paste a link for online events">
          </div>
          <div>
            <label for="ae-status">Status</label>
            <select id="ae-status">${statusOpts}</select>
          </div>
          <div>
            <label style="display:flex;align-items:center;gap:8px;cursor:pointer;margin-top:28px">
              <input type="checkbox" id="ae-published" style="width:auto;margin-top:0">
              Publish immediately
            </label>
          </div>
          <div class="full" style="grid-column:1/-1">
            <label>Poster / banner image <span class="muted small">(optional)</span></label>
            <div class="photo-upload-box" onclick="document.getElementById('ae-posterInput').click()">
              <img id="ae-posterPreview" style="width:80px;height:56px;object-fit:cover;border-radius:6px;display:none" alt="">
              <span id="ae-posterPlaceholder" class="photo-placeholder">Click to upload poster image (JPG/PNG)</span>
            </div>
            <input type="file" id="ae-posterInput" accept="image/*" style="display:none">
          </div>
          <div class="full form-actions" style="grid-column:1/-1">
            <button id="ae-btn" type="submit" class="btn-primary" style="width:auto;padding:10px 22px">Save activity</button>
            <button type="button" id="ae-cancel" class="cancel-link">Cancel</button>
            <p id="ae-err" class="error" style="margin:0"></p>
          </div>
        </div>
      </form>
    </div>
    <div id="ae-list" style="margin-top:14px"><p class="muted">Loading…</p></div>
  </div>`;
}

function toggleForm() {
  const wrap = document.getElementById("ae-formWrap");
  const btn  = document.getElementById("ae-toggle");
  const open = wrap.classList.toggle("open");
  btn.textContent = open ? "− Close" : "+ Add activity";
}

function handleClick(e) {
  const btn = e.target.closest("[data-action]");
  if (!btn) return;
  const { action, id, published } = btn.dataset;
  if (action === "edit-act")   editActivity(id);
  if (action === "toggle-act") togglePublish(id, published === "true");
  if (action === "delete-act") deleteActivity(id);
}

async function loadActivities() {
  const el = document.getElementById("ae-list");
  try {
    const snap = await getDocs(query(collection(db, "activities"), orderBy("createdAt", "desc")));
    if (snap.empty) { el.innerHTML = "<p class='muted'>No activities yet. Add one above.</p>"; return; }
    el.innerHTML = snap.docs.map(d => actRow(d.id, d.data())).join("");
  } catch (e) { el.innerHTML = `<p class="error">${e.message}</p>`; }
}

function actRow(id, a) {
  const dateStr = a.date?.toDate
    ? a.date.toDate().toLocaleDateString("en-ZM", { day: "2-digit", month: "short", year: "numeric" })
    : "";
  const sc = STATUS_COLORS[a.status] || "#555";
  const thumb = a.posterUrl
    ? `<div class="profile-thumb" style="border-radius:6px;overflow:hidden;width:48px;height:36px;flex-shrink:0">
        <img src="${a.posterUrl}" alt="" style="width:100%;height:100%;object-fit:cover">
       </div>`
    : `<div class="profile-thumb" style="border-radius:6px;width:48px;height:36px;font-size:10px">${a.category||"ACT"}</div>`;
  const pubBadge = a.published
    ? `<span class="live-badge">LIVE</span>`
    : `<span class="draft-badge">DRAFT</span>`;
  return `<div class="profile-row">
    ${thumb}
    <div class="profile-info">
      <div class="profile-info-name">${a.title||"Untitled"}</div>
      <div class="profile-info-pos">
        ${a.category||"—"}
        <span class="act-status-pill" style="background:${sc};font-size:9px;padding:1px 6px">${(a.status||"").toUpperCase()}</span>
        ${dateStr ? `· ${dateStr}` : ""}
      </div>
    </div>
    ${pubBadge}
    <div class="row-actions">
      <button class="btn-sm" data-action="edit-act" data-id="${id}">Edit</button>
      <button class="btn-sm" data-action="toggle-act" data-id="${id}" data-published="${!!a.published}">
        ${a.published ? "Unpublish" : "Publish"}
      </button>
      <button class="btn-sm danger" data-action="delete-act" data-id="${id}">Delete</button>
    </div>
  </div>`;
}

async function saveActivity(e) {
  e.preventDefault();
  const errEl = document.getElementById("ae-err");
  const btn   = document.getElementById("ae-btn");
  errEl.textContent = "";
  btn.disabled = true; btn.textContent = "Saving…";

  try {
    let posterUrl = editingPosterUrl;
    let oldPosterToDelete = "";
    if (pendingPoster) {
      btn.textContent = "Uploading poster…";
      posterUrl = await uploadProof(pendingPoster, null, "uzes-activity-posters");
      if (editingPosterUrl && editingPosterUrl !== posterUrl) oldPosterToDelete = editingPosterUrl;
    }

    const dateVal = document.getElementById("ae-date").value;
    const data = {
      title:          document.getElementById("ae-title").value.trim(),
      category:       document.getElementById("ae-category").value,
      description:    document.getElementById("ae-description").value.trim(),
      date:           dateVal ? Timestamp.fromDate(new Date(dateVal + "T12:00:00")) : null,
      location:       document.getElementById("ae-location").value.trim(),
      status:         document.getElementById("ae-status").value,
      posterUrl,
      published:      document.getElementById("ae-published").checked,
      updatedAt:      serverTimestamp(),
      createdByName:  _profile.name || _user.email,
    };

    if (editing) {
      await updateDoc(doc(db, "activities", editing), data);
    } else {
      data.createdAt = serverTimestamp();
      data.createdBy = _user.uid;
      await addDoc(collection(db, "activities"), data);
    }
    if (oldPosterToDelete) deleteUpload(oldPosterToDelete); // best-effort R2 cleanup
    resetForm();
    await loadActivities();
  } catch (err) { errEl.textContent = err.message; }
  finally { btn.disabled = false; btn.textContent = "Save activity"; }
}

async function editActivity(id) {
  const snap = await getDoc(doc(db, "activities", id));
  if (!snap.exists()) return;
  const a = snap.data();
  editing = id; editingPosterUrl = a.posterUrl || ""; pendingPoster = null;

  document.getElementById("ae-title").value       = a.title       || "";
  document.getElementById("ae-category").value    = a.category    || CATEGORIES[0];
  document.getElementById("ae-description").value = a.description || "";
  document.getElementById("ae-location").value    = a.location    || "";
  document.getElementById("ae-status").value      = a.status      || "upcoming";
  document.getElementById("ae-published").checked = !!a.published;

  const dateVal = a.date?.toDate
    ? a.date.toDate().toISOString().split("T")[0]
    : (a.date || "");
  document.getElementById("ae-date").value = dateVal;

  const preview = document.getElementById("ae-posterPreview");
  const placeholder = document.getElementById("ae-posterPlaceholder");
  if (a.posterUrl) {
    preview.src = a.posterUrl; preview.style.display = "block"; placeholder.style.display = "none";
  } else {
    preview.style.display = "none"; placeholder.style.display = "";
  }

  document.getElementById("ae-formHead").textContent = "Edit activity";
  document.getElementById("ae-btn").textContent      = "Save changes";
  document.getElementById("ae-formWrap").classList.add("open");
  document.getElementById("ae-toggle").textContent   = "− Close";
  document.getElementById("ae-formWrap").scrollIntoView({ behavior: "smooth" });
}

function resetForm() {
  editing = null; editingPosterUrl = ""; pendingPoster = null;
  document.getElementById("ae-form").reset();
  document.getElementById("ae-posterPreview").style.display = "none";
  document.getElementById("ae-posterPlaceholder").style.display = "";
  document.getElementById("ae-formHead").textContent = "New activity";
  document.getElementById("ae-btn").textContent      = "Save activity";
  document.getElementById("ae-formWrap").classList.remove("open");
  document.getElementById("ae-toggle").textContent   = "+ Add activity";
  document.getElementById("ae-err").textContent      = "";
}

async function togglePublish(id, currentlyPublished) {
  await updateDoc(doc(db, "activities", id), { published: !currentlyPublished });
  await loadActivities();
}

async function deleteActivity(id) {
  if (!confirm("Delete this activity? This cannot be undone.")) return;
  try {
    const snap = await getDoc(doc(db, "activities", id));
    const posterUrl = snap.data()?.posterUrl;
    await deleteDoc(doc(db, "activities", id));
    if (posterUrl) deleteUpload(posterUrl); // remove the poster from R2 too
    await loadActivities();
  } catch (e) { alert("Delete failed: " + e.message); }
}
