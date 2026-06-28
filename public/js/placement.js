import { auth, db } from "./firebase.js";
import { uploadCV, deleteUpload } from "./upload.js";
import {
  collection, doc, getDoc, setDoc, updateDoc, onSnapshot, query, where,
  serverTimestamp, getDocs, deleteField
} from "https://www.gstatic.com/firebasejs/10.12.2/firebase-firestore.js";

let _user, _profile;
let _placement = null; // Current placement doc data
let _unsubPlace = null; // Real-time listener
let _isSubmitting = false; // Gate: prevents onSnapshot re-render during submit

export async function initPlacement(user, profile) {
  _user = user;
  _profile = profile;

  const panel = document.getElementById("tab-placement");
  if (!panel) return;

  // Check has_paid (live)
  const hasPaid = await checkHasPaid();
  if (!hasPaid) {
    panel.innerHTML = `<div class="card" style="max-width:600px;margin:20px auto">
      <p style="font-size:16px;font-weight:700;margin-bottom:10px">Membership Required</p>
      <p class="muted">You must pay your Membership Dues to access placement matching.</p>
      <p style="margin-top:12px;font-size:14px">Go to the <strong>My Finance</strong> tab to submit a payment.</p>
    </div>`;
    return;
  }

  // Load placement doc
  await loadPlacement();

  // Real-time listener
  _unsubPlace = onSnapshot(
    doc(db, "placements", _user.uid),
    snap => {
      if (snap.exists()) _placement = snap.data();
      // Don't re-render while the user is mid-submit; they will see the success state
      if (_isSubmitting) return;
      renderPlacementPanel().catch(e => console.error("Render error:", e));
    },
    err => {
      console.error("Placement listener error:", err);
      if (!_isSubmitting) renderPlacementPanel().catch(() => {});
    }
  );
}

async function checkHasPaid() {
  try {
    const snap = await getDocs(query(
      collection(db, "payments"),
      where("studentUid", "==", _user.uid),
      where("category", "==", "Membership Dues"),
      where("status", "==", "confirmed")
    ));
    return !snap.empty;
  } catch (_) {
    return false;
  }
}

async function loadPlacement() {
  try {
    const snap = await getDoc(doc(db, "placements", _user.uid));
    if (snap.exists()) {
      _placement = snap.data();
    } else {
      _placement = null;
    }
  } catch (err) {
    console.error("Failed to load placement:", err);
    _placement = null;
  }
}

async function renderPlacementPanel() {
  const panel = document.getElementById("tab-placement");
  if (!panel) return;

  if (!_placement || _placement.placementStatus === "pending") {
    panel.innerHTML = renderPendingForm();
    attachPendingFormListeners();
  } else if (_placement.placementStatus === "matched") {
    panel.innerHTML = await renderMatchedState();
    attachMatchedListeners();
  } else if (_placement.placementStatus === "awaiting_ts_approval") {
    panel.innerHTML = renderAwaitingApprovalState();
  } else if (_placement.placementStatus === "confirmed") {
    panel.innerHTML = renderConfirmedState();
  }
}

function esc(s) {
  return String(s ?? "")
    .replace(/&/g, "&amp;").replace(/</g, "&lt;")
    .replace(/>/g, "&gt;").replace(/"/g, "&quot;");
}

// ── PENDING STATE ──────────────────────────────────────────────────────────────
function renderPendingForm() {
  const p = _placement || {};
  const provinces = ["Central","Copperbelt","Eastern","Luapula","Lusaka","Muchinga","Northern","North-Western","Southern","Western"];
  const selected = p.preferredProvinces || (p.preferredProvince ? [p.preferredProvince] : []);

  return `<div class="card" style="max-width:600px;margin:20px auto">
    <p style="font-size:16px;font-weight:700;margin-bottom:4px">Your Placement</p>
    <p class="muted" style="margin-bottom:16px">Complete your details to be matched with companies.</p>

    <form id="placementForm" novalidate>
      <div style="margin-bottom:16px">
        <label style="display:block;font-weight:600;margin-bottom:6px">Preferred Provinces <span style="font-weight:400;color:var(--muted);font-size:13px">(select at least 2)</span></label>
        <div style="display:grid;grid-template-columns:1fr 1fr;gap:6px">
          ${provinces.map(prov => `<label style="display:flex;align-items:center;gap:8px;padding:8px 10px;border:1px solid var(--line);border-radius:6px;cursor:pointer;font-weight:400;font-size:14px">
            <input type="checkbox" name="province" value="${prov}" ${selected.includes(prov) ? "checked" : ""} style="width:15px;height:15px;flex-shrink:0">
            ${prov}
          </label>`).join("")}
        </div>
        <p id="provinceCount" style="font-size:12px;margin-top:6px"></p>
      </div>

      <div style="margin-bottom:16px">
        <label for="placePhone" style="display:block;font-weight:600;margin-bottom:6px">Phone Number</label>
        <input id="placePhone" type="tel" required placeholder="+260 97 123 4567" value="${esc(p.phone || "")}"
          style="width:100%;padding:10px;border:1px solid var(--line);border-radius:6px">
      </div>

      <div style="margin-bottom:16px">
        <label style="display:block;font-weight:600;margin-bottom:6px">CV (PDF, DOC, or DOCX)</label>
        <div style="border:2px dashed var(--line);border-radius:8px;padding:20px;text-align:center;cursor:pointer;background:#f8fafc;transition:border-color .15s"
          id="cvDropZone" onclick="document.getElementById('cvInput').click()">
          <p style="margin:0;color:var(--muted);font-size:14px" id="cvLabel">
            ${p.cvUrl ? "✓ CV uploaded" : "Click to upload or drag and drop"}
          </p>
        </div>
        <input id="cvInput" type="file" accept=".pdf,.doc,.docx" style="display:none">
      </div>

      <p id="placeErr" class="error" style="margin-bottom:12px"></p>
      <button id="placeSaveBtn" type="submit" class="btn-primary" style="width:100%;padding:11px;font-weight:700">
        ${(p.preferredProvinces?.length > 0 || p.preferredProvince) ? "Update Details" : "Complete Profile"}
      </button>
    </form>
  </div>`;
}

function attachPendingFormListeners() {
  const form      = document.getElementById("placementForm");
  const cvInput   = document.getElementById("cvInput");
  const cvDropZone = document.getElementById("cvDropZone");
  const cvLabel   = document.getElementById("cvLabel");
  const errEl     = document.getElementById("placeErr");
  const saveBtn   = document.getElementById("placeSaveBtn");
  const phoneInput = document.getElementById("placePhone");

  if (!form) return; // panel not yet in DOM

  // Province live counter
  const provinceBoxes = document.querySelectorAll('input[name="province"]');
  const countEl = document.getElementById("provinceCount");
  function updateProvinceCount() {
    const n = document.querySelectorAll('input[name="province"]:checked').length;
    if (!countEl) return;
    countEl.innerHTML = n >= 2
      ? `<span style="color:var(--ok)">✓ ${n} province${n > 1 ? "s" : ""} selected</span>`
      : `<span style="color:var(--danger)">${n} selected — choose at least 2</span>`;
  }
  provinceBoxes.forEach(cb => cb.addEventListener("change", updateProvinceCount));
  updateProvinceCount();

  // Phone number formatter: +260 XX XXX XXXX
  if (phoneInput) {
    phoneInput.addEventListener("input", (e) => {
      let val = e.target.value.replace(/\D/g, ""); // strip all non-digits
      if (val.startsWith("260")) val = val.slice(3);
      if (val.startsWith("0")) val = val.slice(1);
      // val now contains just the 9-digit number without country code
      let formatted = "+260";
      if (val.length > 0) {
        formatted += " " + val.slice(0, 2);
        if (val.length > 2) formatted += " " + val.slice(2, 5);
        if (val.length > 5) formatted += " " + val.slice(5, 9);
      }
      e.target.value = formatted.trim();
    });
    phoneInput.addEventListener("blur", () => {
      const val = phoneInput.value.replace(/\D/g, "");
      if (val.length !== 12 && val.length !== 9) { // +260 is 3 digits, so total is 12 with prefix, 9 without
        // Don't enforce strictly, just let validation catch it
      }
    });
  }

  // Submit handler — guard with _isSubmitting so onSnapshot can't clobber the form mid-save
  form.addEventListener("submit", async e => {
    e.preventDefault();
    e.stopPropagation(); // extra safety
    if (_isSubmitting) return;

    if (errEl) errEl.textContent = "";
    if (saveBtn) { saveBtn.disabled = true; saveBtn.textContent = "Saving…"; }
    _isSubmitting = true;

    try {
      const provinces = [...document.querySelectorAll('input[name="province"]:checked')].map(cb => cb.value);
      const phone    = document.getElementById("placePhone").value.trim();
      const file     = cvInput ? cvInput.files[0] : null;
      const hasExistingCv = !!_placement?.cvUrl;

      if (provinces.length < 2) throw new Error("Select at least 2 preferred provinces.");
      if (!phone)    throw new Error("Enter a phone number.");
      if (!file && !hasExistingCv) throw new Error("Upload a CV.");

      let cvUrl = _placement?.cvUrl || "";

      if (file) {
        if (saveBtn) saveBtn.textContent = "Uploading CV…";
        if (hasExistingCv) await deleteUpload(_placement.cvUrl);
        cvUrl = await uploadCV(file);
      }

      if (saveBtn) saveBtn.textContent = "Saving…";

      if (_placement) {
        await updateDoc(doc(db, "placements", _user.uid), {
          preferredProvinces: provinces,
          preferredProvince: deleteField(),
          phone,
          cvUrl,
          updatedAt: serverTimestamp()
        });
      } else {
        await setDoc(doc(db, "placements", _user.uid), {
          placementStatus: "pending",
          preferredProvinces: provinces,
          phone,
          cvUrl,
          rejectionCount: 0,
          createdAt: serverTimestamp(),
          updatedAt: serverTimestamp()
        });
      }

      // Show success state instead of silently re-rendering the form
      if (typeof window.showToast === "function") {
        window.showToast({ type: "success", title: "Details Saved", message: "Your placement details have been updated successfully." });
      }
      const panel = document.getElementById("tab-placement");
      if (panel) {
        panel.innerHTML = `
          <div class="card" style="max-width:600px;margin:20px auto;text-align:center;padding:28px 24px">
            <p style="font-size:28px;margin:0">✓</p>
            <p style="font-size:18px;font-weight:700;color:var(--ok);margin:8px 0 4px">Details Saved</p>
            <p class="muted" style="font-size:14px;margin-bottom:16px">Your placement details have been updated successfully.</p>
            <button type="button" id="placeEditBtn" class="btn-primary" style="width:auto;padding:10px 22px">Edit Details</button>
          </div>`;
        document.getElementById("placeEditBtn").addEventListener("click", () => {
          renderPlacementPanel();
        });
      }

   } catch (err) {
      if (errEl) errEl.textContent = err.message;
      if (saveBtn) { saveBtn.disabled = false; saveBtn.textContent = _placement ? "Update Details" : "Complete Profile"; }
      if (typeof window.showToast === "function") {
        window.showToast({ type: "error", title: "Save failed", message: err.message });
      }
    } finally {
      _isSubmitting = false;
    }
  });

  // Drag-and-drop wiring (non-critical — form works even if these are absent)
  if (cvDropZone && cvInput) {
    cvDropZone.addEventListener("dragover", e => {
      e.preventDefault();
      cvDropZone.style.borderColor = "var(--green)";
      cvDropZone.style.background  = "rgba(0,85,165,.04)";
    });
    cvDropZone.addEventListener("dragleave", () => {
      cvDropZone.style.borderColor = "var(--line)";
      cvDropZone.style.background  = "#f8fafc";
    });
    cvDropZone.addEventListener("drop", e => {
      e.preventDefault();
      cvDropZone.style.borderColor = "var(--line)";
      cvDropZone.style.background  = "#f8fafc";
      if (e.dataTransfer.files[0]) cvInput.files = e.dataTransfer.files;
    });
  }
  if (cvInput && cvLabel) {
    cvInput.addEventListener("change", () => {
      if (cvInput.files[0]) cvLabel.textContent = "✓ " + cvInput.files[0].name;
    });
  }
}

// ── MATCHED STATE ──────────────────────────────────────────────────────────────
async function renderMatchedState() {
  if (!_placement?.matchedCompanyId) return renderPendingForm();

  let company = null;
  try {
    const snap = await getDoc(doc(db, "vacancies", _placement.matchedCompanyId));
    if (snap.exists()) company = snap.data();
  } catch (_) {}

  if (!company) return renderPendingForm();

  const matchedAt = _placement.matchedAt?.toDate?.() || new Date();
  const expiresAt = new Date(matchedAt.getTime() + 48 * 60 * 60 * 1000);
  const now = new Date();
  const remainingMs = expiresAt - now;
  const hours = Math.max(0, Math.floor(remainingMs / (1000 * 60 * 60)));
  const mins = Math.max(0, Math.floor((remainingMs % (1000 * 60 * 60)) / (1000 * 60)));

  return `<div class="card" style="max-width:600px;margin:20px auto">
    <p style="font-size:16px;font-weight:700;margin-bottom:4px">Placement Match</p>
    <p class="muted" style="margin-bottom:16px">You have been matched with a company. Review the details and decide whether to accept.</p>

    <div style="background:var(--card);border:1px solid var(--line);border-radius:8px;padding:16px;margin-bottom:16px">
      <p style="font-weight:700;font-size:15px;margin-bottom:8px">${esc(company.companyName)}</p>
      <div class="pay-row" style="padding:6px 0;border:none;font-size:13px">
        <span><strong>Province:</strong> ${esc(company.province)}</span>
      </div>
      <div class="pay-row" style="padding:6px 0;border:none;font-size:13px">
        <span><strong>District:</strong> ${esc(company.district)}</span>
      </div>
      <div class="pay-row" style="padding:6px 0;border:none;font-size:13px">
        <span><strong>Type:</strong> ${esc(company.type)}</span>
      </div>
    </div>

    <div style="background:#fff3e0;border:1px solid #ffe0b2;border-radius:8px;padding:12px;margin-bottom:16px;text-align:center">
      <p style="font-weight:700;color:#e67e22;margin:0;font-size:14px">
        ⏱ ${hours}h ${mins}m remaining
      </p>
      <p style="color:#d97706;font-size:12px;margin:4px 0 0">Respond before ${expiresAt.toLocaleTimeString("en-ZM", {hour:"2-digit",minute:"2-digit"})}</p>
    </div>

    <div id="matchErr" class="error" style="margin-bottom:12px"></div>

    <div style="display:flex;gap:10px">
      <button id="acceptBtn" class="btn-primary" style="flex:1;padding:11px;font-weight:700">Accept</button>
      <button id="rejectBtn" style="flex:1;padding:11px;background:none;border:1px solid var(--line);border-radius:8px;cursor:pointer;font-weight:600;color:var(--text)">Reject</button>
    </div>
  </div>`;
}

function attachMatchedListeners() {
  const acceptBtn = document.getElementById("acceptBtn");
  const rejectBtn = document.getElementById("rejectBtn");
  const errEl = document.getElementById("matchErr");

  acceptBtn.addEventListener("click", async () => {
    acceptBtn.disabled = true;
    acceptBtn.textContent = "Opening form…";

    try {
      // Load company + placeholders in parallel
      const [companySnap, placeholders] = await Promise.all([
        getDoc(doc(db, "vacancies", _placement.matchedCompanyId)),
        loadPlacementPlaceholders()
      ]);
      if (!companySnap.exists()) throw new Error("Company vacancy not found.");
      const _company = companySnap.data();
      const isManual = _company.acceptMode === "manual";

      const customHtml = placeholders
        .map(p => `
          <div style="margin-bottom:12px">
            <label for="ph_${esc(p.key)}" style="display:block;font-weight:600;margin-bottom:4px;font-size:13px">
              ${esc(p.label)} ${p.required ? '<span style="color:var(--danger)">*</span>' : ''}
            </label>
            <input id="ph_${esc(p.key)}" type="text" ${p.required ? "required" : ""} placeholder="${esc(p.label)}"
              style="width:100%;padding:8px;border:1px solid var(--line);border-radius:6px;font-size:13px">
          </div>`)
        .join("");

      const confirmLabel = isManual ? "Submit for TS Review" : "Accept &amp; Send Letter";
      const modal = document.createElement("div");
      modal.style.cssText = "position:fixed;inset:0;z-index:1000;background:rgba(0,0,0,.5);display:flex;align-items:center;justify-content:center;padding:16px";
      modal.innerHTML = `
        <div style="background:#fff;border-radius:12px;padding:26px;max-width:480px;width:100%;box-shadow:0 12px 48px rgba(0,0,0,.25)">
          <p style="font-size:16px;font-weight:700;margin:0 0 4px">Complete your details</p>
          <p style="color:var(--muted);font-size:13px;margin:0 0 ${isManual ? "4px" : "16px"}">Fill in any required fields below.</p>
          ${isManual ? `<p style="color:#e67e22;font-size:12px;margin:0 0 14px">Your acceptance will be reviewed by the Training Secretary before being confirmed.</p>` : ""}
          <form id="customFieldsForm">
            ${customHtml}
            <div id="acceptErr" class="error" style="margin-bottom:12px"></div>
            <div style="display:flex;gap:10px;margin-top:18px">
              <button type="submit" class="btn-primary" id="acceptConfirmBtn" style="flex:1;padding:10px;font-weight:700">${confirmLabel}</button>
              <button type="button" id="acceptCancelBtn" style="flex:1;padding:10px;background:none;border:1px solid var(--line);border-radius:8px;cursor:pointer">Cancel</button>
            </div>
          </form>
        </div>`;

      document.body.appendChild(modal);

      document.getElementById("acceptCancelBtn").addEventListener("click", () => {
        modal.remove();
        acceptBtn.disabled = false;
        acceptBtn.textContent = "Accept";
      });

      document.getElementById("customFieldsForm").addEventListener("submit", async e => {
        e.preventDefault();
        await doAccept(modal, placeholders, _company);
      });
    } catch (err) {
      errEl.textContent = err.message;
      acceptBtn.disabled = false;
      acceptBtn.textContent = "Accept";
    }
  });

  rejectBtn.addEventListener("click", async () => {
    if (!confirm("Reject this placement? You will return to pending and be eligible for matching again.")) return;
    rejectBtn.disabled = true;
    rejectBtn.textContent = "Rejecting…";

    try {
      // Delete CV, increment rejection count, return to pending
      if (_placement.cvUrl) {
        await deleteUpload(_placement.cvUrl);
      }

      await updateDoc(doc(db, "placements", _user.uid), {
        placementStatus: "pending",
        rejectionCount: (_placement.rejectionCount || 0) + 1,
        matchedCompanyId: null,
        matchedAt: null,
        cvUrl: "" // Keep empty; student can re-upload
      });

      // Listener will re-render
    } catch (err) {
      errEl.textContent = err.message;
      rejectBtn.disabled = false;
      rejectBtn.textContent = "Reject";
    }
  });
}

async function loadPlacementPlaceholders() {
  try {
    const snap = await getDocs(collection(db, "placementPlaceholders"));
    return snap.docs
      .map(d => ({ id: d.id, ...d.data() }))
      .sort((a, b) => (a.order ?? 0) - (b.order ?? 0));
  } catch (_) {
    return [];
  }
}

async function doAccept(modal, placeholders, company) {
  const acceptErr = document.getElementById("acceptErr");
  const confirmBtn = document.getElementById("acceptConfirmBtn");
  acceptErr.textContent = "";
  confirmBtn.disabled = true;
  confirmBtn.textContent = "Sending…";

  try {
    // Collect custom fields
    const customFields = {};
    for (const p of placeholders) {
      const input = document.getElementById(`ph_${p.key}`);
      if (input) customFields[p.key] = input.value.trim();
    }

    let templateDocUrl = "";
    try {
      const templSnap = await getDoc(doc(db, "siteContent", "placementLetterTemplates"));
      if (templSnap.exists()) {
        const t = templSnap.data();
        templateDocUrl = company.type === "Internship"
          ? (t.internshipDocUrl || "")
          : (t.attachmentDocUrl || "");
      }
    } catch (_) {}

    const payload = {
      type: "placement_letter",
      to: _user.email,
      studentName: _profile.name || "",
      studentNumber: _profile.compNumber || "",
      department: _profile.department || "",
      yearOfStudy: _profile.yearOfStudy || "",
      gender: _profile.gender || "",
      phone: _placement.phone || _profile.phone || "",
      companyName: company.companyName || "",
      province: company.province || "",
      district: company.district || "",
      placementType: company.type || "",
      templateDocUrl,
      customFields
    };

    if (company.acceptMode === "manual") {
      // Manual mode: TS must review CV before confirming — preserve cvUrl so TS can see it
      await updateDoc(doc(db, "placements", _user.uid), {
        placementStatus: "awaiting_ts_approval",
        customFields,
      });
      modal.remove();
      // onSnapshot re-renders to awaiting state
      return;
    }

    // Auto mode: send letter immediately and confirm
    const relaySnap = await getDoc(doc(db, "settings", "emailRelay"));
    const { url, token } = relaySnap.exists() ? relaySnap.data() : {};

    if (!url) throw new Error("Email relay not configured.");

    await fetch(url, {
      method: "POST",
      mode: "no-cors",
      headers: { "Content-Type": "text/plain" },
      body: JSON.stringify({ _token: token || "", ...payload })
    });

    await updateDoc(doc(db, "placements", _user.uid), {
      placementStatus: "confirmed",
      cvUrl: ""
    });
    // Clean up CV from R2 after auto-confirm (TS review not needed for auto mode)
    if (_placement.cvUrl) await deleteUpload(_placement.cvUrl);

    modal.remove();
  } catch (err) {
    acceptErr.textContent = err.message;
    confirmBtn.disabled = false;
    confirmBtn.textContent = "Accept & Send Letter";
  }
}

// ── AWAITING TS APPROVAL STATE ─────────────────────────────────────────────────
function renderAwaitingApprovalState() {
  return `<div class="card" style="max-width:600px;margin:20px auto">
    <div style="text-align:center;padding:20px 0">
      <p style="font-size:28px;margin:0">⏳</p>
      <p style="font-size:18px;font-weight:700;color:#e67e22;margin:8px 0 4px">Pending TS Review</p>
      <p class="muted">Your acceptance has been submitted and is awaiting approval from the Industrial Training Secretary.</p>
      <p style="margin-top:16px;font-size:14px">Once approved, your placement letter will be sent to your email.</p>
    </div>
  </div>`;
}

// ── CONFIRMED STATE ────────────────────────────────────────────────────────────
function renderConfirmedState() {
  const autoConfirmed = !_placement?.cvUrl && _placement?.matchedAt;
  const letterNote = autoConfirmed
    ? "<p class='muted' style='margin-top:8px;font-size:13px'>Your placement letter will be issued by the Industrial Training Secretary.</p>"
    : "<p class='muted'>Your acceptance letter has been sent to your email.</p>";

  return `<div class="card" style="max-width:600px;margin:20px auto">
    <div style="text-align:center;padding:20px 0">
      <p style="font-size:24px;margin:0">✓</p>
      <p style="font-size:18px;font-weight:700;color:var(--ok);margin:8px 0 4px">Placement Confirmed</p>
      ${letterNote}
      <p style="margin-top:16px;font-size:14px">Keep an eye on your inbox for further instructions from the company.</p>
    </div>
  </div>`;
}

export function disposePlacement() {
  if (_unsubPlace) _unsubPlace();
}
