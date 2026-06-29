// Public content editor — lazy-loaded for Information & Publicity Secretary + Admin.
// Manages: exec profiles, about-page text, FAQ items.
import { db } from "./firebase.js";
import { uploadProof, deleteUpload } from "./upload.js";
import {
  collection, doc, getDoc, setDoc, addDoc, updateDoc, deleteDoc, getDocs,
  serverTimestamp
} from "https://www.gstatic.com/firebasejs/10.12.2/firebase-firestore.js";

// Event delegation (onclick attr removed from template for CSP compliance)
document.addEventListener("click", e => {
  if (e.target.closest("#ct-photoBox")) document.getElementById("ct-photoInput")?.click();
});

const EXEC_POSITIONS = [
  "Patron (Internal)", "Patron (External)",
  "Chairperson", "Vice Chairperson", "Secretary General", "Vice Secretary General",
  "Treasurer", "Information and Publicity Secretary",
  "Social and Cultural Secretary", "Committee Member"
];
const TIER_MAP = {
  "Patron (Internal)":                   { tier: 1, rank: 1 },
  "Patron (External)":                   { tier: 1, rank: 2 },
  "Chairperson":                         { tier: 2, rank: 1 },
  "Vice Chairperson":                    { tier: 3, rank: 1 },
  "Secretary General":                   { tier: 4, rank: 1 },
  "Treasurer":                           { tier: 4, rank: 2 },
  "Vice Secretary General":              { tier: 5, rank: 1 },
  "Information and Publicity Secretary": { tier: 5, rank: 2 },
  "Social and Cultural Secretary":       { tier: 5, rank: 3 },
  "Committee Member":                    { tier: 6, rank: 1 },
};
const FAQ_CATEGORIES = ["General", "Membership", "Payments", "Events", "Academic"];

// siteContent docs edited here → field name : input element id
const CONTACT_MAP = { email: "ct-c-email", whatsapp: "ct-c-whatsapp", poBox: "ct-c-pobox" };
const SOCIAL_MAP  = { facebook: "ct-s-fb", instagram: "ct-s-ig", tiktok: "ct-s-tt", linkedin: "ct-s-li" };
const SUPPORT_MAP = { donate: "ct-su-donate", careers: "ct-su-careers", attachments: "ct-su-attach" };
const DASH_MAP    = { mediaType: "ct-d-type", mediaUrl: "ct-d-url", caption: "ct-d-caption" };

let _user, _profile;
let profileEditing  = null; // doc id being edited, or null for new
let faqEditing      = null;
let pendingPhotoFile = null;
let editingPhotoUrl  = "";
let pendingFaqFile   = null; // unused but kept for symmetry

export function initContent(user, profile) {
  _user = user; _profile = profile;
  const panel = document.getElementById("tab-content");
  panel.innerHTML = buildUI();

  // Event delegation for list buttons
  panel.addEventListener("click", handlePanelClick);

  // Toggle form visibility
  document.getElementById("ct-toggleProfile").addEventListener("click", () => toggleSection("ct-profileFormWrap", "ct-toggleProfile"));
  document.getElementById("ct-toggleFaq").addEventListener("click", () => toggleSection("ct-faqFormWrap", "ct-toggleFaq"));

  // Photo upload
  const photoInput = document.getElementById("ct-photoInput");
  photoInput.addEventListener("change", () => {
    const file = photoInput.files[0];
    if (!file) return;
    pendingPhotoFile = file;
    const reader = new FileReader();
    reader.onload = e => {
      document.getElementById("ct-photoPreview").src = e.target.result;
      document.getElementById("ct-photoPreview").style.display = "block";
      document.getElementById("ct-photoPlaceholder").style.display = "none";
    };
    reader.readAsDataURL(file);
  });

  // Profile form submit
  document.getElementById("ct-profileForm").addEventListener("submit", saveProfile);
  document.getElementById("ct-profileCancel").addEventListener("click", resetProfileForm);

  // Position → auto-fill tier + rank
  document.getElementById("ct-position").addEventListener("change", () => {
    const pos = document.getElementById("ct-position").value;
    const t = TIER_MAP[pos];
    if (t) {
      document.getElementById("ct-tier").value = t.tier;
      document.getElementById("ct-rank").value = t.rank;
    }
  });

  // About form
  document.getElementById("ct-aboutForm").addEventListener("submit", saveAbout);

  // Contact / Social / Support forms
  document.getElementById("ct-contactForm").addEventListener("submit", e => { e.preventDefault(); saveSiteDoc("contact", CONTACT_MAP, "ct-contactBtn", "ct-contactOk", "ct-contactErr"); });
  document.getElementById("ct-socialForm").addEventListener("submit",  e => { e.preventDefault(); saveSiteDoc("social",  SOCIAL_MAP,  "ct-socialBtn",  "ct-socialOk",  "ct-socialErr"); });
  document.getElementById("ct-supportForm").addEventListener("submit", e => { e.preventDefault(); saveSiteDoc("support", SUPPORT_MAP, "ct-supportBtn", "ct-supportOk", "ct-supportErr"); });
  document.getElementById("ct-dashForm").addEventListener("submit",    e => { e.preventDefault(); saveSiteDoc("studentDashboard", DASH_MAP, "ct-dashBtn", "ct-dashOk", "ct-dashErr"); });

  // FAQ form
  document.getElementById("ct-faqForm").addEventListener("submit", saveFaq);
  document.getElementById("ct-faqCancel").addEventListener("click", resetFaqForm);

  loadProfiles();
  loadAbout();
  loadSiteDoc("contact", CONTACT_MAP);
  loadSiteDoc("social",  SOCIAL_MAP);
  loadSiteDoc("support", SUPPORT_MAP);
  loadSiteDoc("studentDashboard", DASH_MAP);
  loadFaq();
}

// ── UI builder ────────────────────────────────────────────────────────────────
function buildUI() {
  return `
  <!-- EXEC PROFILES -->
  <div class="card" style="margin-top:16px">
    <p class="section-head">Executive Profiles</p>
    <p class="muted small" style="margin-bottom:12px">
      These appear on the public About page. Photos are uploaded to Cloudinary.
      Profiles are only visible when Published.
    </p>
    <button class="toggle-form-btn" id="ct-toggleProfile">+ Add new profile</button>
    <div class="form-collapse" id="ct-profileFormWrap">
      <form id="ct-profileForm">
        <p class="section-head" id="ct-profileFormHead" style="font-size:13px;margin-bottom:12px">New profile</p>
        <div class="form-grid">
          <div>
            <label for="ct-name">Full name</label>
            <input id="ct-name" required placeholder="e.g. Chanda Mwale">
          </div>
          <div>
            <label for="ct-position">Position</label>
            <select id="ct-position" required>
              <option value="">— Select —</option>
              ${EXEC_POSITIONS.map(p => `<option value="${p}">${p}</option>`).join("")}
            </select>
          </div>
          <div>
            <label for="ct-tier">Tier <span class="muted small">(auto)</span></label>
            <input id="ct-tier" type="number" min="1" max="9" required placeholder="1–6">
          </div>
          <div>
            <label for="ct-rank">Rank <span class="muted small">(within tier)</span></label>
            <input id="ct-rank" type="number" min="1" max="9" required placeholder="1–3">
          </div>
          <div>
            <label for="ct-email">Email <span class="muted small">(optional)</span></label>
            <input id="ct-email" type="email" placeholder="person@example.com">
          </div>
          <div>
            <label for="ct-phone">Phone <span class="muted small">(optional)</span></label>
            <input id="ct-phone" type="tel" placeholder="+260 97 ...">
          </div>
          <div>
            <label for="ct-dept">Department <span class="muted small">(optional)</span></label>
            <input id="ct-dept" placeholder="e.g. Mechanical Engineering">
          </div>
          <div>
            <label for="ct-year">Year of study <span class="muted small">(optional)</span></label>
            <input id="ct-year" placeholder="e.g. 4th Year">
          </div>
          <div class="full">
            <label for="ct-bio">Bio</label>
            <textarea id="ct-bio" rows="3" placeholder="Short biography…" style="resize:vertical"></textarea>
          </div>
          <div class="full">
            <label>Photo</label>
            <div class="photo-upload-box" id="ct-photoBox">
              <img id="ct-photoPreview" class="photo-preview" style="width:56px;height:56px;border-radius:50%;object-fit:cover;display:none" alt="">
              <div id="ct-photoPlaceholder" class="photo-placeholder">Click to upload photo (JPG/PNG)</div>
            </div>
            <input type="file" id="ct-photoInput" accept="image/*" style="display:none">
          </div>
          <div class="full">
            <label style="display:flex;align-items:center;gap:8px;cursor:pointer">
              <input type="checkbox" id="ct-published" style="width:auto;margin-top:0">
              Publish immediately (visible on public About page)
            </label>
          </div>
          <div class="full form-actions">
            <button id="ct-profileBtn" type="submit" class="btn-primary" style="width:auto;padding:10px 22px">Save profile</button>
            <button type="button" id="ct-profileCancel" class="cancel-link">Cancel</button>
            <p id="ct-profileErr" class="error" style="margin:0"></p>
          </div>
        </div>
      </form>
    </div>
    <div id="ct-profileList" style="margin-top:14px"><p class="muted">Loading…</p></div>
  </div>

  <!-- ABOUT TEXT -->
  <div class="card" style="margin-top:14px">
    <p class="section-head">About Page — Mission Text</p>
    <p class="muted small" style="margin-bottom:12px">
      This text appears at the top of the public About page and on the home page.
    </p>
    <form id="ct-aboutForm">
      <label for="ct-mission">Mission statement</label>
      <textarea id="ct-mission" rows="4" placeholder="Describe UZES's mission…" style="resize:vertical"></textarea>
      <div class="form-actions" style="margin-top:10px">
        <button type="submit" class="btn-primary" id="ct-aboutBtn" style="width:auto;padding:10px 22px;margin-top:0">Save text</button>
        <p id="ct-aboutErr" class="error" style="margin:0"></p>
        <p id="ct-aboutOk" style="color:var(--ok);font-size:13px;font-weight:600;margin:0"></p>
      </div>
    </form>
  </div>

  <!-- STUDENT DASHBOARD MEDIA -->
  <div class="card" style="margin-top:14px">
    <p class="section-head">Student Dashboard — Tutorial Media</p>
    <p class="muted small" style="margin-bottom:12px">
      Shown on the right side of every student's Dashboard. Use a YouTube link for a
      tutorial video, a direct video file URL, or an image. Leave the URL blank to show
      the default placeholder.
    </p>
    <form id="ct-dashForm">
      <div class="form-grid">
        <div>
          <label for="ct-d-type">Media type</label>
          <select id="ct-d-type">
            <option value="youtube">YouTube video</option>
            <option value="video">Video file (MP4 URL)</option>
            <option value="image">Image</option>
          </select>
        </div>
        <div>
          <label for="ct-d-caption">Caption</label>
          <input id="ct-d-caption" placeholder="e.g. How to use the UZES portal">
        </div>
        <div class="full">
          <label for="ct-d-url">Media URL</label>
          <input id="ct-d-url" placeholder="https://youtu.be/…  or  https://…/video.mp4  or image URL">
        </div>
      </div>
      <div class="form-actions" style="margin-top:10px">
        <button type="submit" class="btn-primary" id="ct-dashBtn" style="width:auto;padding:10px 22px;margin-top:0">Save dashboard media</button>
        <p id="ct-dashErr" class="error" style="margin:0"></p>
        <p id="ct-dashOk" style="color:var(--ok);font-size:13px;font-weight:600;margin:0"></p>
      </div>
    </form>
  </div>

  <!-- CONTACT DETAILS -->
  <div class="card" style="margin-top:14px">
    <p class="section-head">Contact Details</p>
    <p class="muted small" style="margin-bottom:12px">Shown on the public Contact page.</p>
    <form id="ct-contactForm">
      <div class="form-grid">
        <div><label for="ct-c-email">Email</label><input id="ct-c-email" type="email" placeholder="uzesofficial@gmail.com"></div>
        <div><label for="ct-c-whatsapp">WhatsApp line</label><input id="ct-c-whatsapp" placeholder="e.g. +260 97 123 4567"></div>
        <div class="full"><label for="ct-c-pobox">Postal address (Dean, School of Engineering)</label><textarea id="ct-c-pobox" rows="3" style="resize:vertical" placeholder="The Dean, School of Engineering, UNZA, P.O. Box 32379, Lusaka"></textarea></div>
      </div>
      <div class="form-actions" style="margin-top:10px">
        <button type="submit" class="btn-primary" id="ct-contactBtn" style="width:auto;padding:10px 22px;margin-top:0">Save contact</button>
        <p id="ct-contactErr" class="error" style="margin:0"></p>
        <p id="ct-contactOk" style="color:var(--ok);font-size:13px;font-weight:600;margin:0"></p>
      </div>
    </form>
  </div>

  <!-- SOCIAL LINKS -->
  <div class="card" style="margin-top:14px">
    <p class="section-head">Social Media Links</p>
    <p class="muted small" style="margin-bottom:12px">Paste the full link. Leave a field blank to hide that icon.</p>
    <form id="ct-socialForm">
      <div class="form-grid">
        <div><label for="ct-s-fb">Facebook</label><input id="ct-s-fb" placeholder="https://facebook.com/…"></div>
        <div><label for="ct-s-ig">Instagram</label><input id="ct-s-ig" placeholder="https://instagram.com/…"></div>
        <div><label for="ct-s-tt">TikTok</label><input id="ct-s-tt" placeholder="https://tiktok.com/@…"></div>
        <div><label for="ct-s-li">LinkedIn</label><input id="ct-s-li" placeholder="https://linkedin.com/…"></div>
      </div>
      <div class="form-actions" style="margin-top:10px">
        <button type="submit" class="btn-primary" id="ct-socialBtn" style="width:auto;padding:10px 22px;margin-top:0">Save links</button>
        <p id="ct-socialErr" class="error" style="margin:0"></p>
        <p id="ct-socialOk" style="color:var(--ok);font-size:13px;font-weight:600;margin:0"></p>
      </div>
    </form>
  </div>

  <!-- SUPPORT US -->
  <div class="card" style="margin-top:14px">
    <p class="section-head">Support Us Page</p>
    <p class="muted small" style="margin-bottom:12px">Describe each way to support UZES. Shown on the public Support page.</p>
    <form id="ct-supportForm">
      <label for="ct-su-donate">Donate</label>
      <textarea id="ct-su-donate" rows="3" style="resize:vertical" placeholder="How supporters can donate — e.g. mobile money details, and that the Treasurer coordinates donations…"></textarea>
      <label for="ct-su-careers" style="margin-top:10px;display:block">Career sessions</label>
      <textarea id="ct-su-careers" rows="3" style="resize:vertical" placeholder="Industry talks, mentorship, and how partners can offer a session…"></textarea>
      <label for="ct-su-attach" style="margin-top:10px;display:block">Attachment placements</label>
      <textarea id="ct-su-attach" rows="3" style="resize:vertical" placeholder="Industrial attachment opportunities and how companies can offer placements…"></textarea>
      <div class="form-actions" style="margin-top:10px">
        <button type="submit" class="btn-primary" id="ct-supportBtn" style="width:auto;padding:10px 22px;margin-top:0">Save support</button>
        <p id="ct-supportErr" class="error" style="margin:0"></p>
        <p id="ct-supportOk" style="color:var(--ok);font-size:13px;font-weight:600;margin:0"></p>
      </div>
    </form>
  </div>

  <!-- FAQ -->
  <div class="card" style="margin-top:14px">
    <p class="section-head">FAQ</p>
    <p class="muted small" style="margin-bottom:12px">
      Published FAQ items appear on the public FAQ page, grouped by category, sorted by Order.
    </p>
    <button class="toggle-form-btn" id="ct-toggleFaq">+ Add FAQ item</button>
    <div class="form-collapse" id="ct-faqFormWrap">
      <form id="ct-faqForm">
        <p class="section-head" id="ct-faqFormHead" style="font-size:13px;margin-bottom:12px">New FAQ item</p>
        <div class="form-grid">
          <div class="full">
            <label for="ct-question">Question</label>
            <input id="ct-question" required placeholder="e.g. How do I pay my membership fee?">
          </div>
          <div class="full">
            <label for="ct-answer">Answer</label>
            <textarea id="ct-answer" rows="3" required placeholder="Full answer…" style="resize:vertical"></textarea>
          </div>
          <div>
            <label for="ct-faqCat">Category</label>
            <select id="ct-faqCat">
              ${FAQ_CATEGORIES.map(c => `<option value="${c}">${c}</option>`).join("")}
            </select>
          </div>
          <div>
            <label for="ct-order">Display order <span class="muted small">(lower = first)</span></label>
            <input id="ct-order" type="number" min="0" value="10" placeholder="10">
          </div>
          <div class="full">
            <label style="display:flex;align-items:center;gap:8px;cursor:pointer">
              <input type="checkbox" id="ct-faqPublished" style="width:auto;margin-top:0">
              Publish immediately
            </label>
          </div>
          <div class="full form-actions">
            <button id="ct-faqBtn" type="submit" class="btn-primary" style="width:auto;padding:10px 22px">Save item</button>
            <button type="button" id="ct-faqCancel" class="cancel-link">Cancel</button>
            <p id="ct-faqErr" class="error" style="margin:0"></p>
          </div>
        </div>
      </form>
    </div>
    <div id="ct-faqList" style="margin-top:14px"><p class="muted">Loading…</p></div>
  </div>`;
}

// ── Utilities ─────────────────────────────────────────────────────────────────
function toggleSection(wrapId, btnId) {
  const wrap = document.getElementById(wrapId);
  const btn  = document.getElementById(btnId);
  const open = wrap.classList.toggle("open");
  btn.textContent = open ? "− Close" : "+ Add new" + (wrapId.includes("Profile") ? " profile" : " FAQ item");
}

function handlePanelClick(e) {
  const btn = e.target.closest("[data-action]");
  if (!btn) return;
  const { action, id, published } = btn.dataset;
  if (action === "edit-profile")       editProfile(id);
  if (action === "toggle-profile")     toggleProfilePublish(id, published === "true");
  if (action === "delete-profile")     deleteProfile(id);
  if (action === "edit-faq")           editFaq(id);
  if (action === "toggle-faq")         toggleFaqPublish(id, published === "true");
  if (action === "delete-faq")         deleteFaq(id);
}

function badge(published) {
  return published
    ? `<span class="live-badge">LIVE</span>`
    : `<span class="draft-badge">DRAFT</span>`;
}

// ── Exec Profiles ─────────────────────────────────────────────────────────────
async function loadProfiles() {
  const el = document.getElementById("ct-profileList");
  try {
    const snap = await getDocs(collection(db, "execProfiles"));
    if (snap.empty) { el.innerHTML = "<p class='muted'>No profiles yet. Add one above.</p>"; return; }
    const sorted = snap.docs.map(d => ({ id: d.id, ...d.data() }))
      .sort((a, b) => (a.tier - b.tier) || (a.rank - b.rank));
    el.innerHTML = sorted.map(p => profileRow(p.id, p)).join("");
  } catch (e) { el.innerHTML = `<p class="error">${e.message}</p>`; }
}

function profileRow(id, p) {
  const initials = (p.name||"?").split(" ").map(w=>w[0]).join("").slice(0,2).toUpperCase();
  const thumb = p.photoUrl
    ? `<div class="profile-thumb"><img src="${p.photoUrl}" alt="${p.name}" style="width:100%;height:100%;object-fit:cover;border-radius:50%"></div>`
    : `<div class="profile-thumb">${initials}</div>`;
  return `<div class="profile-row">
    ${thumb}
    <div class="profile-info">
      <div class="profile-info-name">${p.name||"—"}</div>
      <div class="profile-info-pos">${p.position||"—"} · Tier ${p.tier||"?"}·${p.rank||"?"}</div>
    </div>
    ${badge(p.published)}
    <div class="row-actions">
      <button class="btn-sm" data-action="edit-profile" data-id="${id}">Edit</button>
      <button class="btn-sm" data-action="toggle-profile" data-id="${id}" data-published="${!!p.published}">
        ${p.published ? "Unpublish" : "Publish"}
      </button>
      <button class="btn-sm danger" data-action="delete-profile" data-id="${id}">Delete</button>
    </div>
  </div>`;
}

async function saveProfile(e) {
  e.preventDefault();
  const errEl = document.getElementById("ct-profileErr");
  const btn   = document.getElementById("ct-profileBtn");
  errEl.textContent = "";
  btn.disabled = true; btn.textContent = "Saving…";

  try {
    let photoUrl = editingPhotoUrl;
    let oldPhotoToDelete = "";
    if (pendingPhotoFile) {
      btn.textContent = "Uploading photo…";
      photoUrl = await uploadProof(pendingPhotoFile, null, "uzes-exec-photos");
      // Old photo is now replaced — flag it for cleanup after a successful save.
      if (editingPhotoUrl && editingPhotoUrl !== photoUrl) oldPhotoToDelete = editingPhotoUrl;
    }

    const data = {
      name:        document.getElementById("ct-name").value.trim(),
      position:    document.getElementById("ct-position").value,
      tier:        parseInt(document.getElementById("ct-tier").value) || 1,
      rank:        parseInt(document.getElementById("ct-rank").value) || 1,
      bio:         document.getElementById("ct-bio").value.trim(),
      email:       document.getElementById("ct-email").value.trim(),
      phone:       document.getElementById("ct-phone").value.trim(),
      department:  document.getElementById("ct-dept").value.trim(),
      yearOfStudy: document.getElementById("ct-year").value.trim(),
      photoUrl,
      published:   document.getElementById("ct-published").checked,
      updatedAt:   serverTimestamp(),
      updatedBy:   _user.uid,
    };

    if (profileEditing) {
      await updateDoc(doc(db, "execProfiles", profileEditing), data);
    } else {
      await addDoc(collection(db, "execProfiles"), data);
    }
    if (oldPhotoToDelete) deleteUpload(oldPhotoToDelete); // best-effort R2 cleanup
    resetProfileForm();
    await loadProfiles();
  } catch (err) {
    errEl.textContent = err.message;
  } finally {
    btn.disabled = false; btn.textContent = "Save profile";
  }
}

async function editProfile(id) {
  const snap = await getDoc(doc(db, "execProfiles", id));
  if (!snap.exists()) return;
  const p = snap.data();
  profileEditing = id;
  editingPhotoUrl = p.photoUrl || "";
  pendingPhotoFile = null;

  document.getElementById("ct-name").value     = p.name        || "";
  document.getElementById("ct-position").value = p.position    || "";
  document.getElementById("ct-tier").value     = p.tier        || 1;
  document.getElementById("ct-rank").value     = p.rank        || 1;
  document.getElementById("ct-bio").value      = p.bio         || "";
  document.getElementById("ct-email").value    = p.email       || "";
  document.getElementById("ct-phone").value    = p.phone       || "";
  document.getElementById("ct-dept").value     = p.department  || "";
  document.getElementById("ct-year").value     = p.yearOfStudy || "";
  document.getElementById("ct-published").checked = !!p.published;

  const preview = document.getElementById("ct-photoPreview");
  const placeholder = document.getElementById("ct-photoPlaceholder");
  if (p.photoUrl) {
    preview.src = p.photoUrl; preview.style.display = "block"; placeholder.style.display = "none";
  } else {
    preview.style.display = "none"; placeholder.style.display = "";
  }

  document.getElementById("ct-profileFormHead").textContent = "Edit profile";
  document.getElementById("ct-profileBtn").textContent      = "Save changes";
  document.getElementById("ct-profileFormWrap").classList.add("open");
  document.getElementById("ct-toggleProfile").textContent   = "− Close";
  document.getElementById("ct-profileFormWrap").scrollIntoView({ behavior: "smooth" });
}

function resetProfileForm() {
  profileEditing = null; editingPhotoUrl = ""; pendingPhotoFile = null;
  document.getElementById("ct-profileForm").reset();
  document.getElementById("ct-photoPreview").style.display = "none";
  document.getElementById("ct-photoPlaceholder").style.display = "";
  document.getElementById("ct-profileFormHead").textContent = "New profile";
  document.getElementById("ct-profileBtn").textContent      = "Save profile";
  document.getElementById("ct-profileFormWrap").classList.remove("open");
  document.getElementById("ct-toggleProfile").textContent   = "+ Add new profile";
  document.getElementById("ct-profileErr").textContent      = "";
}

async function toggleProfilePublish(id, currentlyPublished) {
  await updateDoc(doc(db, "execProfiles", id), { published: !currentlyPublished });
  await loadProfiles();
}

async function deleteProfile(id) {
  if (!confirm("Delete this profile? This cannot be undone.")) return;
  try {
    const snap = await getDoc(doc(db, "execProfiles", id));
    const photoUrl = snap.data()?.photoUrl;
    await deleteDoc(doc(db, "execProfiles", id));
    if (photoUrl) deleteUpload(photoUrl); // remove the photo from R2 too
    await loadProfiles();
  } catch (e) { alert("Delete failed: " + e.message); }
}

// ── About text ────────────────────────────────────────────────────────────────
async function loadAbout() {
  try {
    const snap = await getDoc(doc(db, "siteContent", "about"));
    if (snap.exists()) document.getElementById("ct-mission").value = snap.data().mission || "";
  } catch (_) {}
}

async function saveAbout(e) {
  e.preventDefault();
  const errEl = document.getElementById("ct-aboutErr");
  const okEl  = document.getElementById("ct-aboutOk");
  const btn   = document.getElementById("ct-aboutBtn");
  errEl.textContent = ""; okEl.textContent = "";
  btn.disabled = true; btn.textContent = "Saving…";
  try {
    await setDoc(doc(db, "siteContent", "about"), {
      mission:   document.getElementById("ct-mission").value.trim(),
      updatedAt: serverTimestamp(),
      updatedBy: _user.uid,
    }, { merge: true });
    okEl.textContent = "Saved.";
  } catch (err) { errEl.textContent = err.message; }
  finally { btn.disabled = false; btn.textContent = "Save text"; }
}

// ── Contact / Social / Support (generic siteContent docs) ───────────────────────
async function loadSiteDoc(id, map) {
  try {
    const snap = await getDoc(doc(db, "siteContent", id));
    if (!snap.exists()) return;
    const data = snap.data();
    for (const field in map) {
      const el = document.getElementById(map[field]);
      if (el) el.value = data[field] || "";
    }
  } catch (_) { /* leave fields blank */ }
}

async function saveSiteDoc(id, map, btnId, okId, errId) {
  const btn   = document.getElementById(btnId);
  const okEl  = document.getElementById(okId);
  const errEl = document.getElementById(errId);
  errEl.textContent = ""; okEl.textContent = "";
  const orig = btn.textContent;
  btn.disabled = true; btn.textContent = "Saving…";
  try {
    const payload = { updatedAt: serverTimestamp(), updatedBy: _user.uid };
    for (const field in map) {
      const el = document.getElementById(map[field]);
      payload[field] = el ? el.value.trim() : "";
    }
    await setDoc(doc(db, "siteContent", id), payload, { merge: true });
    okEl.textContent = "Saved.";
  } catch (err) { errEl.textContent = err.message; }
  finally { btn.disabled = false; btn.textContent = orig; }
}

// ── FAQ ───────────────────────────────────────────────────────────────────────
async function loadFaq() {
  const el = document.getElementById("ct-faqList");
  try {
    const snap = await getDocs(collection(db, "faq"));
    if (snap.empty) { el.innerHTML = "<p class='muted'>No FAQ items yet. Add one above.</p>"; return; }
    const sorted = snap.docs.map(d => ({ id: d.id, ...d.data() }))
      .sort((a, b) => (a.order ?? 10) - (b.order ?? 10) || (a.category||"").localeCompare(b.category||""));
    el.innerHTML = sorted.map(f => faqRow(f.id, f)).join("");
  } catch (e) { el.innerHTML = `<p class="error">${e.message}</p>`; }
}

function faqRow(id, f) {
  return `<div class="profile-row">
    <div class="profile-info" style="flex:1;min-width:0">
      <div class="profile-info-name" style="white-space:nowrap;overflow:hidden;text-overflow:ellipsis">
        ${f.question||"—"}
      </div>
      <div class="profile-info-pos">${f.category||"General"} · Order: ${f.order??10}</div>
    </div>
    ${badge(f.published)}
    <div class="row-actions">
      <button class="btn-sm" data-action="edit-faq" data-id="${id}">Edit</button>
      <button class="btn-sm" data-action="toggle-faq" data-id="${id}" data-published="${!!f.published}">
        ${f.published ? "Unpublish" : "Publish"}
      </button>
      <button class="btn-sm danger" data-action="delete-faq" data-id="${id}">Delete</button>
    </div>
  </div>`;
}

async function saveFaq(e) {
  e.preventDefault();
  const errEl = document.getElementById("ct-faqErr");
  const btn   = document.getElementById("ct-faqBtn");
  errEl.textContent = "";
  btn.disabled = true; btn.textContent = "Saving…";
  try {
    const data = {
      question:  document.getElementById("ct-question").value.trim(),
      answer:    document.getElementById("ct-answer").value.trim(),
      category:  document.getElementById("ct-faqCat").value,
      order:     parseInt(document.getElementById("ct-order").value) || 10,
      published: document.getElementById("ct-faqPublished").checked,
      updatedAt: serverTimestamp(),
      updatedBy: _user.uid,
    };
    if (faqEditing) {
      await updateDoc(doc(db, "faq", faqEditing), data);
    } else {
      await addDoc(collection(db, "faq"), data);
    }
    resetFaqForm();
    await loadFaq();
  } catch (err) { errEl.textContent = err.message; }
  finally { btn.disabled = false; btn.textContent = "Save item"; }
}

async function editFaq(id) {
  const snap = await getDoc(doc(db, "faq", id));
  if (!snap.exists()) return;
  const f = snap.data();
  faqEditing = id;
  document.getElementById("ct-question").value    = f.question  || "";
  document.getElementById("ct-answer").value      = f.answer    || "";
  document.getElementById("ct-faqCat").value      = f.category  || "General";
  document.getElementById("ct-order").value       = f.order     ?? 10;
  document.getElementById("ct-faqPublished").checked = !!f.published;

  document.getElementById("ct-faqFormHead").textContent = "Edit FAQ item";
  document.getElementById("ct-faqBtn").textContent      = "Save changes";
  document.getElementById("ct-faqFormWrap").classList.add("open");
  document.getElementById("ct-toggleFaq").textContent   = "− Close";
  document.getElementById("ct-faqFormWrap").scrollIntoView({ behavior: "smooth" });
}

function resetFaqForm() {
  faqEditing = null;
  document.getElementById("ct-faqForm").reset();
  document.getElementById("ct-faqFormHead").textContent = "New FAQ item";
  document.getElementById("ct-faqBtn").textContent      = "Save item";
  document.getElementById("ct-faqFormWrap").classList.remove("open");
  document.getElementById("ct-toggleFaq").textContent   = "+ Add FAQ item";
  document.getElementById("ct-faqErr").textContent      = "";
}

async function toggleFaqPublish(id, currentlyPublished) {
  await updateDoc(doc(db, "faq", id), { published: !currentlyPublished });
  await loadFaq();
}

async function deleteFaq(id) {
  if (!confirm("Delete this FAQ item?")) return;
  try { await deleteDoc(doc(db, "faq", id)); await loadFaq(); }
  catch (e) { alert("Delete failed: " + e.message); }
}
