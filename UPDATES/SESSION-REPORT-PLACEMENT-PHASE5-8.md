# UZES Placement System — Phase 5–8 Full Session Report

**Project:** UZES Friendly Web (University of Zambia Engineering Society)  
**Continues from:** SESSION-REPORT-2026-07-07.md  
**Covers:** Placement matching, TS/SG vacancy management, accept-mode flow, bug fixes, student form hardening  
**Deployment status:** Firebase Hosting + Firestore rules deployed and live

---

## Overview

This session built out the complete industrial attachment placement system across all roles (Student, Industrial Training Secretary, Secretary General). It also resolved a chain of three bugs discovered during testing, redesigned the accept-mode architecture, and fixed a persistent form-navigation bug on the student placement tab.

**Major work:**

1. SG "Placements" tab in executive dashboard (Phase 7)
2. Apps Script email relay updated to handle placement letters
3. Three bugs fixed: student accept permissions, vacancy delete permissions, executive skeleton
4. Student-facing accept flow redesigned with two modes (Auto / Manual)
5. TS review panel for manual-mode acceptances
6. Student "Update Details" form navigation bug fixed
7. Accept mode renamed and clarified (Auto vs Manual)

---

## Chapter 1 — Firebase Deployment Unblocked

**Problem:** User could not run `firebase deploy` — CLI not found in PATH.

**Root cause:** `npm install -g firebase-tools` was run in a normal PowerShell window. On Windows, global npm installs require Administrator PowerShell to write to the system PATH correctly.

**Fix:** User ran `npm install -g firebase-tools` in an Administrator PowerShell window. Firebase CLI now available system-wide.

**Command used for all deploys going forward:**
```powershell
firebase deploy --only firestore:rules,hosting
# or
firebase deploy --only hosting
```

---

## Chapter 2 — Phase 7: Secretary General Placements Tab

**New feature:** SG now has a "Placements" tab in the executive dashboard (alongside Library, Content, Activities for other roles).

### nav.js
Added `placements` flag to `executiveTabs()`:
```js
if (flags.placements) tabs.push({ id: "tab-placements", label: "Placements", icon: "attach" });
```

### executive.js
```js
const isPlacementMgr = ["Secretary General","Vice Secretary General"].includes(profile.position)
                       || profile.role === "admin";

tabs: executiveTabs({
  content: isContentMgr,
  activities: isActivitiesMgr,
  library: isLibrarian,
  placements: isPlacementMgr   // NEW
})
```

New lazy-load in `window.shOnTab`:
```js
if (id === "tab-placements" && !sgPlacementsLoaded) {
  sgPlacementsLoaded = true;
  initSGPlacements();
}
```

**`initSGPlacements()` function added (executive.js):**
- Renders dept-slot grid (7 departments, number inputs)
- Add vacancy form: company name, type, province, district, gender preference, accept mode, slots per department
- Vacancy list with Assign Now + Delete buttons
- `sgAssignVacancy(vacancyId)` — dynamically imports `placement-utils.js`, runs matching algorithm, commits matches
- `sgDeleteVacancy(vacancyId)` — deletes vacancy doc

### executive.html
Added full `tab-placements` panel:
- "Company Vacancies" card with skeleton loaders (`id="sgVacancyList"`)
- "Add Company Vacancy" form (`id="sgAddVacancyForm"`) with all fields including `sgVacAcceptMode`
- Dept slots grid (`id="sgDeptSlotsGrid"`)

**Access:** Secretary General, Vice Secretary General, Admin

---

## Chapter 3 — Apps Script Email Relay Update

User was given a complete replacement `email-relay.gs` file to copy-paste into Google Apps Script.

**New additions to the relay:**

### `doPost()` routing
```js
if (d.type === "placement_letter") {
  const pdf = buildPlacementLetterPdf(d);
  sendPlacementLetterEmail(d, pdf);
}
```

### `buildPlacementLetterPdf(d)`
- Copies Google Doc template (internship or attachment based on type)
- Replaces all placeholders: `{date}`, `{student name}`, `{student number}`, `{Title}`, `{He/She}`, `{His/Her}`, `{Him/Her}`, `{company name}`, `{province}`, `{district}`, `{placement type}`, `{type}`, `{department}`, `{year of study}`, `{phone number}`
- Handles custom fields via `buildFlexPlaceholder()`
- Exports as PDF blob

### `checkPlacementExpirations()`
Time-triggered function (set to 4-hour interval by user):
- Queries Firestore REST API for placements where `placementStatus == "matched"` and `matchedAt` older than 48 hours
- Resets expired placements: `placementStatus → "pending"`, increments `rejectionCount`, clears `matchedCompanyId`/`matchedAt`
- Calls `_restoreVacancySlot()` to re-add the slot for that department

**Required Script Property:** `FIREBASE_PROJECT_ID = uzes-friendly-web`

---

## Chapter 4 — Three Bug Fixes

### Bug 1 — Student Accept: "Missing or insufficient permissions"

**Initial diagnosis (wrong):** Firestore rule for `placements/{uid}` student update only allowed `pending→pending`. Needed `matched→confirmed`.

**Actual root cause:** `doAccept()` in `placement.js` called `getDoc(doc(db, "settings", "emailRelay"))` to fetch the Apps Script relay URL. The Firestore rule was:
```js
match /settings/{id} {
  allow read: if id == 'adminApi' ? isAdmin() : isExec();  // students excluded!
}
```

Students are `role: "student"`, not execs. The `getDoc()` threw "Missing or insufficient permissions" BEFORE the `updateDoc()` was even reached.

**Fix — firestore.rules:**
```js
match /settings/{id} {
  allow read:  if id == 'adminApi'    ? isAdmin()
             : id == 'emailRelay'    ? (signedIn() && myActive())
             : isExec();
}
```
Students can now read `emailRelay` to obtain the relay URL. `adminApi` remains admin-only.

The student update rule was ALSO updated to allow `matched→confirmed` and `matched→pending` as those were legitimately blocked too:
```js
// Accept (auto mode → confirmed) or reject (→ pending, with rejectionCount)
allow update: if signedIn() && myActive()
              && myUid() == uid
              && resource.data.placementStatus == 'matched'
              && request.resource.data.placementStatus in ['confirmed', 'pending', 'awaiting_ts_approval']
              && !request.resource.data.diff(resource.data)
                   .affectedKeys().hasAny(['preferredProvince','phone','createdBy','createdAt']);
```

---

### Bug 2 — Vacancy Delete: "Missing or insufficient permissions"

**Root cause:** `vacancies/{id}` delete rule was `allow delete: if isAdmin()` only. TS and SG need to delete their own vacancies.

**Fix — firestore.rules:**
```js
allow delete: if isAdmin() || isSecretary() || isSG();
```

---

### Bug 3 — Executive Dashboard Skeleton on First Load

**Root cause:** `window.shOnTab` was assigned TWICE in `executive.js`:

1. **Module level** (runs first): full async version handling all tabs (`tab-all`, `tab-reports`, `tab-finances`, etc.)
2. **Inside `protect()` callback** (runs after auth resolves): a stub version handling only `tab-library-mod` — **this overwrote the full version**

After `protect()` ran, clicking any tab other than library did nothing. The pending list DID load (called explicitly), but navigating to Reports, All Payments, etc. left those tabs as skeletons forever.

**Fix — executive.js:**
- Removed the `window.shOnTab` assignment inside `protect()` entirely
- Updated the module-level `window.shOnTab` to always call `switchLibModTab` for the library tab (no `!libModLoaded` guard, ensuring it reloads every visit):
  ```js
  if (id === "tab-library-mod") {
    switchLibModTab(_libModTab || "pending");   // always reload
  }
  ```

---

## Chapter 5 — Accept Mode Feature

**Concept redesign:** The original "auto" mode meant "confirm immediately without student action." This was changed to match actual requirements.

### Correct accept mode definitions:

| Mode | Flow |
|------|------|
| **Auto** | System matches student → student reviews company → student accepts (letter sent, confirmed immediately) or rejects (back to pending with penalty) |
| **Manual** | System matches student → student reviews company → student accepts (submitted to TS for review, no letter yet) or rejects (back to pending with penalty). TS then approves (letter sent, confirmed) or rejects (back to pending, NO penalty, slot restored) |

---

### Firestore — new status: `awaiting_ts_approval`

Placement state machine updated:

```
pending → matched → confirmed           (auto accept)
pending → matched → awaiting_ts_approval → confirmed    (manual, TS approves)
pending → matched → awaiting_ts_approval → pending      (manual, TS rejects, no penalty)
pending → matched → pending             (student rejects, with penalty)
```

---

### placement.js changes

**`renderPlacementPanel()`** — added new state:
```js
} else if (_placement.placementStatus === "awaiting_ts_approval") {
  panel.innerHTML = renderAwaitingApprovalState();
}
```

**`renderAwaitingApprovalState()`** — new function showing "Pending TS Review" state with orange badge and message.

**Accept button click handler** — now loads company data early (before modal) to show correct button label:
```js
const [companySnap, placeholders] = await Promise.all([
  getDoc(doc(db, "vacancies", _placement.matchedCompanyId)),
  loadPlacementPlaceholders()
]);
const isManual = _company.acceptMode === "manual";
const confirmLabel = isManual ? "Submit for TS Review" : "Accept &amp; Send Letter";
```

Modal note for manual mode:
```html
<p style="color:#e67e22;font-size:12px;">
  Your acceptance will be reviewed by the Training Secretary before being confirmed.
</p>
```

**`doAccept(modal, placeholders, company)`** — new company parameter (pre-loaded), branches on mode:
```js
if (company.acceptMode === "manual") {
  await updateDoc(doc(db, "placements", _user.uid), {
    placementStatus: "awaiting_ts_approval",
    customFields,      // saved for TS to see
    cvUrl: ""
  });
  modal.remove();
  return;  // no letter sent yet
}
// Auto: send letter immediately and confirm
```

**`renderConfirmedState()`** — detects auto vs manual confirmation and shows appropriate note:
- Auto: "Your acceptance letter has been sent to your email."
- Manual (auto-confirmed by TS): "Your placement letter will be issued by the Industrial Training Secretary."

---

### industrial-secretary.html — "Pending TS Review" card

New card added above the vacancy management section in the Session Control tab:
```html
<div class="card" style="margin-top:24px;max-width:700px">
  <p class="section-head">Placement — Pending TS Review</p>
  <div id="tsReviewList">...</div>
</div>
```

---

### industrial-secretary.js — TS review functions

**`loadTSReview()`** — called on page init:
- Queries `placements` where `placementStatus == "awaiting_ts_approval"`
- Batch-loads unique vacancies
- Loads student profiles in parallel
- Renders review cards

**`window.approvePlacement(uid)`:**
1. Loads placement doc (has `customFields`, `matchedCompanyId`)
2. Loads student profile, vacancy, template URL, relay config in parallel
3. Sends placement letter via Apps Script relay
4. Updates placement: `confirmed`, `cvUrl: ""`
5. Refreshes `tsReviewList`

**`window.rejectPlacementNopenalty(uid)`:**
1. Loads student's department
2. Restores vacancy slot for that department (`slotsRemaining[dept] += 1`)
3. Updates placement: `pending`, clears `matchedCompanyId`, `matchedAt`, `customFields`
4. Does NOT change `rejectionCount` (no penalty)
5. Refreshes `tsReviewList` and `vacancyList`

---

### Form fields added

**industrial-secretary.html** — Accept mode dropdown in "Add vacancy" form:
```html
<select id="vacAcceptMode">
  <option value="manual">Manual — student reviews &amp; accepts</option>
  <option value="auto">Auto — confirm immediately on match</option>
</select>
```

**executive.html** — Same dropdown in SG vacancy form (`id="sgVacAcceptMode"`).

**industrial-secretary.js + executive.js** — Both now save `acceptMode` to vacancy doc and display it on vacancy cards.

**placement-utils.js** — `commitMatches()` no longer branches on `acceptMode` (was reverted; the auto-confirm-immediately behavior was removed per user clarification):
```js
// All modes write "matched" — student always sees the match and responds
tx.update(placementRef, {
  placementStatus: "matched",
  matchedCompanyId: vacancyId,
  matchedAt: serverTimestamp()
});
```

---

## Chapter 6 — Student "Update Details" Bug

**Symptom:** Clicking "Update Details" or "Complete Profile" on the placement tab caused the page to navigate to the student dashboard (tab-dash).

**Root cause:** In `attachPendingFormListeners()`, the drag-and-drop event listeners were wired up BEFORE the form submit listener:

```js
// OLD CODE (broken order):
cvDropZone.addEventListener("dragover", ...);   // throws if cvDropZone is null
cvDropZone.addEventListener("dragleave", ...);
cvDropZone.addEventListener("drop", ...);
cvInput.addEventListener("change", ...);
form.addEventListener("submit", ...);           // NEVER REACHED if above throws
```

If any element reference was null (timing or DOM issue), the function threw before `form.addEventListener("submit", ...)` was reached. With no submit listener on the form, clicking "Update Details" triggered the default HTML form submission (GET request to `student.html` without the `#tab-placement` hash), which showed the dashboard.

**Secondary bug:** CV was required even when updating existing details. `if (!file) throw new Error("Upload a CV.")` blocked province/phone updates when student already had a CV on file.

**Fix — placement.js:**

```js
function attachPendingFormListeners() {
  const form = document.getElementById("placementForm");
  if (!form) return;  // guard

  // Submit listener FIRST — navigation never happens even if other els are missing
  form.addEventListener("submit", async e => {
    e.preventDefault();
    if (errEl) errEl.textContent = "";
    if (saveBtn) { saveBtn.disabled = true; saveBtn.textContent = "Saving…"; }

    try {
      ...
      const hasExistingCv = !!_placement?.cvUrl;
      if (!file && !hasExistingCv) throw new Error("Upload a CV.");  // only if no existing CV

      let cvUrl = _placement?.cvUrl || "";   // keep existing CV if no new file selected
      if (file) {
        if (hasExistingCv) await deleteUpload(_placement.cvUrl);  // replace old CV
        cvUrl = await uploadCV(file);
      }
      ...
    }
  });

  // Drop zone — guarded, non-critical
  if (cvDropZone && cvInput) {
    cvDropZone.addEventListener("dragover", ...);
    ...
  }
}
```

**Additional fixes:**
- Added `novalidate` attribute to form (prevents HTML5 validation from blocking submit in edge cases)
- All null-check wrappers on `errEl` and `saveBtn` usage

**Cache busting:**
- `student.html` bumped from `student.js?v=12` to `?v=13`
- `student.js` import changed from `./placement.js` to `./placement.js?v=2`

---

## Files Modified This Session

| File | What changed |
|------|-------------|
| `firestore.rules` | Students can read `emailRelay`; student update allows `matched→confirmed/pending/awaiting_ts_approval`; vacancy delete allows TS + SG |
| `js/nav.js` | Added `placements` flag to `executiveTabs()` |
| `executive.html` | Added `tab-placements` panel with vacancy form + `sgVacAcceptMode` dropdown |
| `js/executive.js` | Added `isPlacementMgr`, `initSGPlacements()`, `sgInitDeptGrid()`, `sgLoadVacancies()`, `sgRenderVacancyCard()`, `sgAssignVacancy()`, `sgDeleteVacancy()`; fixed `window.shOnTab` double-assignment; added `acceptMode` field to vacancy create |
| `industrial-secretary.html` | Added TS Review card; added `vacAcceptMode` dropdown to vacancy form |
| `js/industrial-secretary.js` | Added `loadTSReview()`, `renderTSReviewCard()`, `approvePlacement()`, `rejectPlacementNopenalty()`; saves `acceptMode` on vacancy create |
| `js/placement.js` | Fixed `attachPendingFormListeners()` order; CV optional on update; `novalidate`; `?v=2` cache bust; added `awaiting_ts_approval` state rendering; `doAccept()` now accepts pre-loaded company and branches on `acceptMode`; `renderAwaitingApprovalState()` added |
| `js/student.js` | Import changed to `placement.js?v=2` |
| `student.html` | Bumped `student.js?v=12` → `?v=13` |
| `apps-script/email-relay.gs` | Full replacement with placement letter support + 4-hour expiry cron |

---

## Firestore Rules Summary (placement section)

```js
match /placements/{uid} {
  allow read: if signedIn() && (myUid() == uid || isSecretary() || isSG());

  allow create: if signedIn() && myActive() && myUid() == uid && myRole() == 'student'
                && request.resource.data.placementStatus == 'pending'
                && request.resource.data.cvUrl.size() > 0
                && request.resource.data.rejectionCount == 0;

  // Student edits own pending doc (province, phone, CV)
  allow update: if signedIn() && myActive() && myUid() == uid
                && resource.data.placementStatus == 'pending'
                && request.resource.data.placementStatus == 'pending'
                && !...affectedKeys().hasAny(['matchedCompanyId','matchedAt','rejectionCount']);

  // Student responds to match: accept (auto→confirmed, manual→awaiting_ts_approval) or reject (→pending)
  allow update: if signedIn() && myActive() && myUid() == uid
                && resource.data.placementStatus == 'matched'
                && request.resource.data.placementStatus in ['confirmed','pending','awaiting_ts_approval']
                && !...affectedKeys().hasAny(['preferredProvince','phone','createdBy','createdAt']);

  // TS/SG can update any field (matching, expiry, TS review decisions)
  allow update: if (isSecretary() || isSG());

  allow delete: if isAdmin();
}

match /vacancies/{id} {
  allow read: if signedIn() && myActive();
  allow create: if (isSecretary() || isSG()) && ...field validation...;
  allow update: if isSecretary() || (isSG() && !...affectedKeys().hasAny(['departmentsRequired']));
  allow delete: if isAdmin() || isSecretary() || isSG();
}

match /settings/{id} {
  allow read: if id == 'adminApi'  ? isAdmin()
            : id == 'emailRelay'  ? (signedIn() && myActive())
            : isExec();
  allow write: if isAdmin();
}
```

---

## Deployment Record

| Deploy | What | Status |
|--------|------|--------|
| 1 | `firestore:rules` — Bug 1 student accept fix | ✅ Live |
| 2 | `hosting` — executive.js shOnTab fix (Bug 3) | ✅ Live |
| 3 | `firestore:rules,hosting` — settings rule + accept mode + TS review | ✅ Live |
| 4 | `firestore:rules,hosting` — awaiting_ts_approval rule + all placement flow | ✅ Live |
| 5 | `hosting` — student form navigation fix + v=2 cache bust | ✅ Live |

**Live URL:** https://uzes-friendly-web.web.app

---

## Known Issues / Carry-Forward

| Issue | Status |
|-------|--------|
| Student form may still show issue for users with old cache | Tell users to hard-refresh (`Ctrl+Shift+R`) once |
| `uploadCV` function — exists in `upload.js?v=?` but may need version bump | Verify on next session |
| TS approval sends letter with student's email from Firestore — confirm `student.email` field exists | Verify during testing |
| Vacancy `acceptMode` defaults to "manual" in UI — older vacancies have no `acceptMode` field | In code: `v.acceptMode === "auto"` check correctly falls through to "Manual review" label |
| `checkPlacementExpirations()` in Apps Script only handles `matched` status, not `awaiting_ts_approval` | Future: add expiry for stale TS reviews if needed |

---

*End of report — Placement Phase 5–8 session*
