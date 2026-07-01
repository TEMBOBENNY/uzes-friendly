# UZES Industrial Attachment Letter System — Full Rebuild

**Project:** UZES Friendly Web (University of Zambia Engineering Society)  
**Session date:** 2026-06-30 (Part 3)  
**Chapters:** Session start · Live walkthrough & fixes · Relay rewrite · Multi-file feature update · Comprehensive fix pass · Gender, single toggle, pronouns  
**Deployment status:** Firebase Hosting deployed and live; Apps Script relay updated (paste + redeploy manually)

---

## Overview

This session completed and significantly extended the Industrial Attachment Letter system. Work started with finishing the two-template feature (split by year group) that was interrupted in a previous context window, then expanded into a full feature pass: gender-based pronouns from registration, flexible custom placeholder matching, single session toggle, and uniform date formatting.

**Major work:**
1. **Two Google Doc templates** — 2nd–4th year (attachment) vs 5th year (internship), each with its own URL
2. **Year-routing in `doApprove`** — detects year via regex, picks correct template URL, sends to relay
3. **Apps Script URL-based template** — relay extracts Doc ID from URL, falls back to folder/cached ID
4. **Gender pronouns** — auto-derived from `profile.gender` (set at registration); `{Title}`, `{He/She}`, `{His/Her}`, `{Him/Her}` tokens in Google Doc
5. **Student number auto-filled** — `{Student number}` / `{student number}` tokens added
6. **Single session toggle** — replaced two year-group toggles with one open/close
7. **Flexible custom placeholder matching** — `{nrc_number}` = `{nrc number}` = `{NRC Number}` (case-insensitive, underscore/space interchangeable)
8. **`customFields` sent to relay** — was missing from `doApprove` payload entirely
9. **Uniform date format** — all dates render as "June 23, 2026"

---

## Chapter 1 — Two-Template Feature Completion

### Problem
Session was cut off mid-implementation. `doApprove` in `industrial-secretary.js` had no year detection and sent no `templateDocUrl` to the relay. `email-relay.gs` had no URL-based template selection.

### Implementation

**`industrial-secretary.js` — `doApprove`:**
```js
const is5th = /\b5(th)?\b/i.test(r.yearOfStudy || "");
const templateDocUrl = is5th
  ? (settings.templateDocUrl5th  || "")
  : (settings.templateDocUrl2to4 || "");

await sendEmail({ ..., templateDocUrl });
```

**`email-relay.gs` — `getLetterTemplateDocId(templateDocUrl)`:**
```js
function getLetterTemplateDocId(templateDocUrl) {
  if (templateDocUrl) {
    var match = templateDocUrl.match(/\/document\/d\/([a-zA-Z0-9_-]+)/);
    if (match && match[1]) return match[1];
  }
  // fall back to cached folder-based conversion…
}
```

`buildLetterPdf(d)` calls `getLetterTemplateDocId(d.templateDocUrl || '')`.

### Secretary-side (HTML + JS)
Two template URL inputs on the Template tab (`templateDocUrl2to4`, `templateDocUrl5th`), each with a Save button, feedback message, and "Open in Google Docs" link. Stored in `attachmentSettings/main`.

### Files changed
- `public/js/industrial-secretary.js` — `doApprove`, `loadTemplate` wiring
- `apps-script/email-relay.gs` — `getLetterTemplateDocId`, `buildLetterPdf`
- `public/industrial-secretary.html` — two-URL template card

---

## Chapter 2 — Single Session Toggle

### Problem
Two separate toggles (`sessionOpen2to4` / `sessionOpen5th`) with mutual-exclusion logic were confusing and over-engineered. Year-routing is only needed to pick the correct template, not to control access.

### Implementation

**`industrial-secretary.html`** — replaced two-toggle card with:
```html
<div class="toggle-row" style="border-bottom:none">
  <div>
    <div class="toggle-label">Accept attachment requests</div>
    <div class="toggle-sub" id="sessionStatusText">Loading…</div>
  </div>
  <label class="toggle-switch">
    <input type="checkbox" id="sessionToggle">
    ...
  </label>
</div>
```

**`industrial-secretary.js` — `initSession()`:**
```js
toggle.addEventListener("change", async () => {
  const open = toggle.checked;
  await setDoc(doc(db, "attachmentSettings", "main"), {
    sessionOpen:     open,
    sessionOpen2to4: false,   // clear legacy flags
    sessionOpen5th:  false
  }, { merge: true });
  ...
});
```

**`attachment.js`** — simplified from complex `hasNewFlags` logic to:
```js
if (!settings.sessionOpen) { show("attSessionClosed"); return; }
```

### Files changed
- `public/industrial-secretary.html`
- `public/js/industrial-secretary.js`
- `public/js/attachment.js`

---

## Chapter 3 — Gender Pronouns

### Design decision
Gender already stored as `Male` / `Female` on `profile.gender` (set at student registration in `register.html` / `register.js`, saved to `students/{uid}` in Firestore). No new fields needed.

### Flow
1. Student submits form → `gender: _profile.gender || ""` saved on `attachmentRequests` doc
2. Secretary approves → `gender: r.gender || ""` included in `sendEmail()` payload
3. Apps Script relay derives pronouns from `d.gender`:
```js
var isMale = (d.gender || '').toLowerCase() === 'male';
var title  = isMale ? 'Mr.'  : 'Ms.';
var heShe  = isMale ? 'He'   : 'She';
var hisHer = isMale ? 'His'  : 'Her';
var himHer = isMale ? 'Him'  : 'Her';
```

### Token reference for Google Doc templates

| Token in template | Inserts | Notes |
|---|---|---|
| `{date}` | June 23, 2026 | Header date |
| `{Student name}` | Full name | Sentence start |
| `{student name}` | Full name | Mid-sentence |
| `{Student number}` | Comp/Reg # | Sentence start |
| `{student number}` | Comp/Reg # | Mid-sentence |
| `{Title}` | Mr. / Ms. | Before name |
| `{He/She}` | He / She | Sentence start |
| `{he/she}` | he / she | Mid-sentence |
| `{His/Her}` | His / Her | Sentence start |
| `{his/her}` | his / her | Mid-sentence |
| `{Him/Her}` | Him / Her | Sentence start |
| `{him/her}` | him / her | Mid-sentence |
| `{department}` | Department | Any |
| `{year of study}` | e.g. 3rd Year | Any |
| `{phone number}` | Student phone | Any |
| `{start date}` | June 23, 2026 | Training start |
| `{closing date}` | June 23, 2026 | Training end |
| `{industrial training secretary name}` | Secretary name | Any |
| `{email address-industrial training secretary}` | Secretary email | Any |
| `{phone number industrial training secretary}` | Secretary phone | Any |

All tokens are **case-sensitive** for the standard list. Custom placeholder keys are flexible (see Chapter 4).

### Files changed
- `public/js/attachment.js` — adds `gender` to `addDoc` payload
- `public/js/industrial-secretary.js` — adds `gender` to `sendEmail` payload; `previewRequestFields` shows all gender tokens
- `apps-script/email-relay.gs` — derives pronouns, adds tokens to `subs`

---

## Chapter 4 — Custom Placeholder Flexible Matching + `customFields` Bug Fix

### Root causes
1. `doApprove` never included `customFields` in the `sendEmail()` payload — relay received `undefined`
2. Even if it had, the relay only looped through the hardcoded `subs` object; custom fields were never substituted

### Fix 1 — Send `customFields`
```js
// industrial-secretary.js doApprove
await sendEmail({
  ...
  customFields: r.customFields || {},
  ...
});
```

### Fix 2 — Flexible matching in relay
```js
// email-relay.gs buildLetterPdf — after standard subs loop
if (d.customFields && typeof d.customFields === 'object') {
  for (var cfKey in d.customFields) {
    var cfValue = String(d.customFields[cfKey] || '');
    try {
      body.replaceText(buildFlexPlaceholder(cfKey), cfValue);
    } catch (e) {
      Logger.log('Custom field replace failed for "' + cfKey + '": ' + e.message);
    }
  }
}
```

```js
// Helper — builds case-insensitive regex treating _ and space as interchangeable
function buildFlexPlaceholder(key) {
  var parts = String(key).toLowerCase().split(/[_\s]+/).filter(function(p) { return p.length > 0; });
  var escaped = parts.map(function(p) { return p.replace(/[.*+?^$()|[\]\\]/g, '\\$&'); });
  return '(?i)\\{' + escaped.join('[_ ]+') + '\\}';
}
```

**Result:** a placeholder key of `nrc_number` matches `{nrc_number}`, `{nrc number}`, `{NRC Number}`, `{NRC_NUMBER}` in the Google Doc.

### Files changed
- `public/js/industrial-secretary.js` — `customFields` in `sendEmail`
- `apps-script/email-relay.gs` — custom fields loop, `buildFlexPlaceholder` helper

---

## Chapter 5 — Date Format

### Requirement
All dates uniform: **"June 23, 2026"** (month day, year).

### Implementation

**Apps Script `formatDate` helper:**
```js
function formatDate(input) {
  if (!input) return '';
  var d;
  if (input instanceof Date) {
    d = input;
  } else {
    var parts = String(input).split('-');
    if (parts.length < 3) return String(input);
    // Split to avoid UTC-midnight timezone shift
    d = new Date(parseInt(parts[0], 10), parseInt(parts[1], 10) - 1, parseInt(parts[2], 10));
  }
  return d.toLocaleDateString('en-US', { month: 'long', day: 'numeric', year: 'numeric' });
}
```

Used for all three date slots:
```js
var today = formatDate(new Date());          // header date
'start date':   formatDate(d.startDate),    // from sessionStartDate (YYYY-MM-DD)
'closing date': formatDate(d.endDate),      // from sessionEndDate (YYYY-MM-DD)
```

The split-on-`-` approach prevents `new Date("2026-07-01")` from being interpreted as UTC midnight and rolling back to June 30 in some timezones.

**Test function hardcoded dates** also updated from `"01 July 2026"` → `"2026-07-01"` so they flow through `formatDate` correctly.

**`previewRequestFields`** in `industrial-secretary.js` uses a matching JS `fmtDate` helper (same logic, browser-side).

### Files changed
- `apps-script/email-relay.gs` — `formatDate` helper, `today`, `start date`, `closing date` entries, test data
- `public/js/industrial-secretary.js` — `fmtDate` helper in `previewRequestFields`

---

## Google Doc Template — Access Rules

For `DriveApp.getFileById(docId)` to copy the template, the Apps Script account (`uzesofficial@gmail.com`) needs access:

| Doc ownership | Required sharing | Works? |
|---|---|---|
| Owned by uzesofficial | — | Yes |
| Another account | Shared with uzesofficial (Viewer+) | Yes |
| Another account | "Anyone with the link — Viewer" | Yes |
| Another account | Private, not shared | No |

The simplest rule: **set the Google Doc to "Anyone with the link can view"**.

---

## Files Modified

| File | Change |
|---|---|
| `public/industrial-secretary.html` | Two-URL template card; single session toggle |
| `public/js/industrial-secretary.js` | Single toggle logic; `doApprove` adds gender + customFields; `previewRequestFields` shows all tokens with `fmtDate` |
| `public/js/attachment.js` | Saves `gender` on submission; simplified session check |
| `apps-script/email-relay.gs` | URL-based template selection; gender→pronouns mapping; student number token; custom fields flexible loop; `buildFlexPlaceholder`; `formatDate`; uniform date format |

---

## Deployment

| Component | Status |
|---|---|
| Firebase Hosting | ✅ Deployed 2026-06-30 |
| Apps Script relay | ⚠️ Paste `email-relay.gs` into editor → Deploy new version manually |

---

## Pending / Testing Checklist

- [ ] Paste updated `email-relay.gs` into Apps Script editor and deploy new version
- [ ] Set training session to open, run `testLetterEmail()` — verify date shows "June 23, 2026"
- [ ] Approve a real request for a 2nd–4th year male student → check Mr./He/His tokens
- [ ] Approve a real request for a 5th year female student → check Ms./She/Her tokens + internship template used
- [ ] Add a custom placeholder (e.g. `nrc_number`) via secretary settings, add `{nrc_number}` to the Doc template, approve → confirm value substituted
- [ ] Confirm `{nrc number}` (space) also works for the same key

---

*End of report — generated 2026-06-30 (P3)*
