# UZES Electoral Commission — Integration Workflow Plan

> **Purpose:** Audit existing source code, map exactly where each new EC feature fits, identify break-risk flags, and provide a blend-in implementation roadmap.  
> **Date:** July 2025  
> **Status:** Planning — no code changes yet.

---

## 1. Existing Codebase Architecture Audit

### 1.1 File Inventory

| File | Role | Size | Relevance to EC |
|---|---|---|---|
| `public/index.html` | Public landing page | 64 lines | Nav injection for published results |
| `public/activities.html` | Public events page | 71 lines | Results will NOT go here (dedicated page instead) |
| `public/student.html` | Student dashboard | 500 lines | Add `Elections` tab panel + My Finance dropdown change |
| `public/executive.html` | Executive dashboard | 531 lines | Unchanged — EC Chair gets own page |
| `public/admin.html` | Admin dashboard | 372 lines | Add election creation/archive card to System tab |
| `public/industrial-secretary.html` | Special role page | 504 lines | **Pattern to follow** for `ec-chair.html` |
| `public/election-results.html` | *(new)* | — | Public results page |
| `public/js/nav.js` | Tab definitions per role | 70 lines | Add `ecTabs()` function |
| `public/js/guard.js` | Auth + role protection | 124 lines | Add EC Chair redirect |
| `public/js/subhero.js` | Universal tab bar | 319 lines | No changes needed — consumed by pages |
| `public/js/student.js` | Student logic | 513 lines | Add `initElection()` lazy loader + payment logic change |
| `public/js/executive.js` | Executive logic | 1997 lines | Unchanged — EC Chair is redirected away |
| `public/js/admin.js` | Admin logic | 1325 lines | Add election create/archive section to System tab |
| `public/js/industrial-secretary.js` | Special role logic | 1216 lines | **Pattern to follow** for `ec-chair.js` |
| `public/js/fcm.js` | Push notifications | 196 lines | Reuse for election phase change pushes (Q3) |
| `public/js/upload.js` | File upload to Cloudflare | — | Reuse for contestant photos |
| `public/js/firebase.js` | Firebase init | — | No changes |
| `public/js/config.js` | Config constants | 43 lines | No changes |
| `public/css/styles.css` | Global styles | 59 KB | Reuse existing card/tab/badge patterns |
| `firestore.rules` | Security rules | 498 lines | Add `isECChair()`, `ecPayments`, `electionCycles`, `contestants`, `votes`, `voterTurnout`, `draftSelections`, `electionStats`, `electionArchives` |

### 1.2 Critical Patterns Already in Use

**Pattern A: Special Role Redirect**
```js
// industrial-secretary.js line 114-117
if (profile.role === "executive" && profile.position !== "Industrial Training Secretary") {
  location.replace("executive.html"); return;
}
```
→ We will use the **exact same pattern** in `guard.js` and `executive.js` for EC Chair.

**Pattern B: Lazy Tab Loading**
```js
// student.js line 46-69
window.shOnTab = async (id) => {
  if (id === "tab-lib" && !libInited) { libInited = true; await initLibrary(...); }
  else if (id === "tab-attach" && !attInited) { ... }
};
```
→ We will add `else if (id === "tab-election" && !electionInited)` to `student.js`.

**Pattern C: Event Delegation with Data Prefixes**
```js
// executive.js line 40-66
document.addEventListener("click", e => {
  const el = e.target.closest("[data-action^='ex:']");
  if (!el) return;
  const d = el.dataset;
  switch (d.action) { case "ex:view-proof": ... }
});
```
→ EC Chair will use `data-action^='ec:'` prefix. Student election tab will use `data-action^='ev:'` (or similar).

**Pattern D: Sub-Tabs Inside a Panel**
```js
// student.html line 184-248
// My Finance has two mini-tabs: Submit / History
```
→ Student Elections panel will have 8 position sub-tabs using the same `.fin-tabs` / `.fin-tab` CSS classes.

**Pattern E: Payment Collection Switching**
```js
// student.js line 350
await addDoc(collection(db, "payments"), { ... });
```
→ We will add a conditional: if category === "EC Nomination Fee", write to `ecPayments` instead of `payments`. All other categories stay unchanged.

**Pattern F: Membership Gate**
```js
// student.html line 257-266 (library gate)
// Shows a centered card if not paid, with a button that redirects to My Finance
```
→ Student Elections tab will reuse this gate pattern if not paid and `allowAllStudentsVote === false`.

**Pattern G: Phase-Based Toggle UI**
```js
// industrial-secretary.js line 157-197
// Session toggle with change listener, save to Firestore, status text update
```
→ EC Chair Dashboard will use this exact pattern for the Election Control phase toggles.

**Pattern H: OTP Verification**
```js
// admin.js line 260-350
// sha256Hex, setDoc to settings/sysOtp, email via Worker, verify, deleteDoc
```
→ EC Chair OTP for "allow all students to vote" will copy this pattern exactly. **See Flag 4.**

---

## 2. Where Each Feature Fits — File-by-File

### 2.1 `public/js/guard.js` — EC Chair Redirect (1 line)

**Location:** Add after line 98 (the `routeByRole` block) or inside `protect()` after the `allowedRoles` check.

**Change:** After `if (!allowedRoles.includes(profile.role)) { routeByRole(profile.role); return; }`, add a **position-based redirect**:
```js
// If this is an executive and their position is EC Chairperson,
// redirect them to the dedicated EC Chair page.
if (profile.role === "executive" && profile.position === "EC Chairperson"
    && !location.pathname.includes("ec-chair")) {
  location.replace("ec-chair.html"); return;
}
```

**Flag 1:** ⚠️ **Do NOT add this to `executive.js` instead.** `executive.js` has its own `protect()` call. If you add the redirect there too, you create a double-redirect race condition. Put it **only in `guard.js`** so it fires once per page load regardless of which page the user lands on.

**Flag 2:** ⚠️ **Ensure `ec-chair.html` is in the `allowedRoles` for the `protect()` call.** In `ec-chair.js`, the `protect()` call should be `protect(["executive", "admin"], ...)` — same as `executive.js` and `industrial-secretary.js`.

---

### 2.2 `public/js/nav.js` — New Tab Definition (20 lines)

**Location:** Add after `secretaryTabs()` (line 70).

**New function:**
```js
export function ecTabs() {
  return [
    { id: "tab-dash",     label: "Dashboard",    icon: "dash"   },
    { id: "tab-nom",      label: "Nominations",  icon: "inbox"  },
    { id: "tab-overview", label: "Overview",     icon: "users"  },
    { id: "tab-results",  label: "Results",      icon: "chart"  },
    { id: "tab-profile",  label: "My Profile",   icon: "acc"    },
  ];
}
```

**Also add one new icon** to `ICO` in `subhero.js` if needed (vote icon). The existing `chart` icon is fine for Results. For Elections on the student tab, we can reuse an existing icon or add a simple one.

**Flag 3:** ⚠️ **Do NOT add a new icon to `subhero.js` unless you test it in both light and dark themes.** The `ICO` object uses inline SVG strings. If you add a new one, ensure it has `stroke="currentColor"` so it inherits the theme text color. Safer to reuse `check` or `chart` for now and add a custom icon later.

---

### 2.3 `public/js/admin.js` — Election Management Card (≈80 lines)

**Location:** Add inside the `#tab-system` panel, after the "Industrial Training Secretary" card (line 293) and before the "Library — Seed course list" card (line 295).

**What to add:**
- A new `.card` section titled "Election Management".
- If no active election cycle: show "Create Election Cycle" button + name input.
- If active cycle exists: show cycle name, current phase, "Archive Election" button (disabled unless phase === "published").
- Archive button triggers Excel export (reuse the existing `XLSX` library already loaded in `admin.html` line 368) then sets `status: "archived"`.

**Flag 4:** ⚠️ **The `XLSX` library (`SheetJS`) is already loaded on `admin.html` via CDN.** Do not add a second import. The existing `xlsx@0.18.5` is available globally. Use it for the archive export.

**Flag 5:** ⚠️ **Do NOT reuse the existing "Reset academic year" logic for election archiving.** The year reset deletes payment proofs and clears financial data. Election archiving should **only** set `status: "archived"` and generate an Excel file — it must **not** delete any files or contestant photos. Keep them as historical records.

---

### 2.4 `public/student.html` — Elections Tab Panel (≈60 lines)

**Location:** Add after the closing `</div>` of the `tab-placement` panel (line 486) and before `</main>` (line 487).

**What to add:**
```html
<!-- ── Elections ──────────────────────────────────────────── -->
<div id="tab-election" class="tab-panel hidden">
  <div id="electionLoading">
    <div class="sk sk-card" style="height:120px"></div>
  </div>
  <div id="electionContent" style="display:none">
    <!-- Gated states injected by JS: closed / not paid / already voted / active ballot -->
  </div>
</div>
```

**Flag 6:** ⚠️ **The existing `subhero.js` tab bar auto-detects `.tab-panel` elements.** The new `tab-election` div will be automatically hidden/shown by `subhero.js` when the student clicks the Elections tab. No changes to `subhero.js` needed.

---

### 2.5 `public/js/student.js` — My Finance + Elections Integration (≈200 lines)

**Location A — Category dropdown (line 297-302):**
Add "EC Nomination Fee" conditionally to the `CATEGORIES` array or build it dynamically:
```js
// After existing buildSelects()
async function buildCategorySelect() {
  const base = ["Membership Dues", "Event Fee", "Fine", "Subscription", "Other"];
  // Check if election is active and student is eligible
  const canNominate = await checkElectionNominationEligibility();
  if (canNominate) base.push("EC Nomination Fee");
  document.getElementById("category").innerHTML =
    base.map(c => `<option value="${c}">${c}</option>`).join("");
}
```

**Location B — Payment submit (line 350):**
Add a conditional branch before `addDoc(collection(db, "payments"), ...)`:
```js
if (category === "EC Nomination Fee") {
  await addDoc(collection(db, "ecPayments"), { ... });
} else {
  await addDoc(collection(db, "payments"), { ... });
}
```

**Location C — Lazy init (line 46-69):**
Add:
```js
else if (id === "tab-election" && !electionInited) {
  electionInited = true;
  try { await initElection(currentUser, currentProfile); }
  catch (e) { ... }
}
```

**Location D — New function `initElection()`:**
- Query `electionSettings` / `electionCycles` to get active cycle and phase.
- Check membership status (reuse `loadMembership()` logic or call it).
- Check `voterTurnout` for already voted.
- Render gated state or full ballot UI.

**Flag 7:** ⚠️ **Do NOT modify the existing `payForm` event listener structure.** The form submit listener (line 322) already handles validation, upload, and save. Add the `ecPayments` branch **inside** the existing try block, not as a separate listener. If you split it, the proof upload progress callback and error handling will be duplicated.

**Flag 8:** ⚠️ **The `CATEGORIES` constant is currently a module-level const (line 16).** Do not change it to a mutable array. Instead, make `buildSelects()` async or have it call a helper that dynamically adds the EC category. This keeps the existing `CATEGORIES` constant clean and makes the conditional logic explicit.

**Flag 9:** ⚠️ **5th Year / Graduate lock.** The eligibility check must inspect `currentProfile.yearOfStudy`. The constant `YEAR_OPTIONS` exists in `admin.js` (line 107) but not in `student.js`. Just hardcode the check: `if (yearOfStudy === "5th Year" || yearOfStudy === "Graduate")` — or better, import `YEAR_OPTIONS` from a shared constants file. Since `student.js` doesn't have it, the safest blend-in is to add the check inline in `student.js` without importing from `admin.js` (which would create a cross-module import dependency that's currently not used).

---

### 2.6 `public/js/student.js` — Payment History Display (line 418-465)

**Location:** `renderHistoryList()` currently only queries `payments`. It does **not** need to query `ecPayments` because students only care about their own payment history, and EC fees are still "their payments."

**Decision:** Keep EC nomination fees **out of the student payment history** on the student page. The student will see their EC fee status in the Elections tab ("Your nomination fee has been approved — you are now a contestant"). If you mix EC fees into the general payment history, the executive (Treasurer) will see them in the All Payments tab, which we want to avoid.

**Flag 10:** ⚠️ **If you decide to show EC fees in student history, you must query BOTH collections.** This means `onSnapshot` on two queries, which doubles the listener count. Given that the student will see EC status in the Elections tab anyway, it's cleaner to keep them separate. The EC Chair sees EC fees in their Nominations tab.

---

### 2.7 `public/ec-chair.html` — New Dedicated Page (≈500-600 lines)

**Pattern:** Copy `public/industrial-secretary.html` as a template. It has:
- `<style>` block with `.tabs`, `.tab-btn`, `.tab-panel`, `.req-card`, `.section-head`, etc.
- 5 tab panels: `tab-dash`, `tab-nom`, `tab-overview`, `tab-results`, `tab-profile`.
- The `tab-profile` panel can reuse the existing `accPwBox` and `acc2faBox` pattern from `executive.html`.

**Flag 11:** ⚠️ **Do NOT copy the industrial-secretary's specific styles (like `.session-card`, `.toggle-row`, `.toggle-switch`) blindly.** The EC Dashboard will use a different layout (a phase pipeline, not a single toggle). Copy the CSS boilerplate (tabs, cards, buttons) but write the Dashboard-specific styles fresh.

**Flag 12:** ⚠️ **Ensure the page includes `<script type="module" src="js/ec-chair.js"></script>`** and the same footer/init.js/chrome.js pattern as all other pages. Missing `chrome.js` will break the theme toggle and mobile nav.

---

### 2.8 `public/js/ec-chair.js` — New Module (≈1200-1500 lines)

**Pattern:** Copy `public/js/industrial-secretary.js` as a starting scaffold. It has:
- `import` block at top (Firebase, guard, subhero, nav, config, upload).
- `document.addEventListener("click", e => { ... })` with `data-action^='is:'` prefix.
- `protect()` call with redirect logic.
- `initSubHero()` call with `ecTabs()`.
- `renderDash()` function.
- `window.shOnTab = (id) => { ... }` with lazy loading per tab.
- Separate async functions for each tab's data loading.

**What to implement in `ec-chair.js`:**
1. **Dashboard:** `renderECDash()` — Election Control card with phase buttons, KPI cards (total nominations, fees collected, total votes, turnout %).
2. **Nominations:** `loadNominations()` — `onSnapshot` on `ecPayments`, render list with approve/reject buttons. Inline "Add as Contestant" modal per approved payment. Query `contestants` to show existing roster. Disqualify button.
3. **Overview:** `loadOverview()` — Aggregate queries on `students` collection (total count, by dept, by year). Count paid members via `payments` query. "Allow all students to vote" toggle with OTP flow.
4. **Results:** `loadResults()` — Read `electionStats` doc. Render bar charts. Tie detection logic. "Call Revote" button. "Publish Results" button. Analytics graph (reuse Chart.js or simple CSS bar charts — the existing codebase doesn't use a chart library, so use simple HTML/CSS bar charts to avoid a new dependency).
5. **My Profile:** Reuse the same pattern as `executive.js` — signature, password change. The `subhero.js` already mounts `#accPwBox` and `#acc2faBox` if they exist in the HTML.

**Flag 13:** ⚠️ **Do NOT import `executive.js` functions into `ec-chair.js`.** `executive.js` is 1997 lines and module-scoped. There are no exports. If you need shared functions (like `esc()`, `getDashGreeting()`), copy them into `ec-chair.js` or create a new `utils.js` module. The current codebase does not have a shared utils module — each page has its own copy of `esc()`. Follow this pattern to stay consistent.

**Flag 14:** ⚠️ **The `uploadProof()` function from `upload.js` is used for payment proofs.** For contestant photos, you can reuse the same function but pass a different folder path (`elections/{cycleId}/contestants/{contestantId}`). The Worker endpoint accepts any path. Ensure the EC Chair's upload progress callback updates a local UI element, not the payment submit button.

**Flag 15:** ⚠️ **Vote aggregation is the most complex part.** For v1, do client-side aggregation in `ec-chair.js` when the EC Chair opens the Results tab during Counting phase. Read all `votes` docs (there won't be thousands in a student election), count in JS, and write the result to `electionStats`. This avoids needing a Cloud Function. If the election grows beyond ~2000 votes, migrate to a Cloud Function later.

**Flag 16:** ⚠️ **For the analytics graph, do NOT add Chart.js or any chart library.** The existing codebase has no chart dependencies. Use simple CSS flexbox bar charts (a `div` with a percentage width and a green background). This keeps the bundle size zero and avoids breaking the build.

---

### 2.9 `firestore.rules` — New Rules (≈80 lines)

**Location:** Add after the existing `library` section (after line 310) and before the `FINANCES` section (line 314).

**New rules needed:**
1. `isECChair()` helper function.
2. `ecPayments/{id}` — read by EC Chair/Admin, create by students, update by EC Chair/Admin.
3. `electionCycles/{id}` — read by any signed-in user, create by Admin, update by EC Chair/Admin.
4. `contestants/{id}` — read by EC Chair/Admin + public (when published), create/update by EC Chair/Admin.
5. `votes/{id}` — create by eligible voters, read by EC Chair/Admin.
6. `voterTurnout/{uid}` — create by self, read by self + EC Chair/Admin, update by self (for revote only).
7. `draftSelections/{uid}` — self-only read/write.
8. `electionStats/{id}` — read/write by EC Chair/Admin.
9. `electionArchives/{id}` — read/write by Admin only.

**Flag 17:** ⚠️ **The `isECChair()` helper must be defined BEFORE any match blocks that use it.** Firestore rules evaluate top-to-bottom. Place it right after the existing `isSecretary()` helper (around line 333).

**Flag 18:** ⚠️ **Do NOT allow `isExec()` to read `ecPayments`.** Only `isECChair()` and `isAdmin()` should read it. If you accidentally grant `isExec()` read access, the Treasurer and other executives will see nomination fees in their dashboards, which breaks the isolation requirement.

**Flag 19:** ⚠️ **The `votes` collection must allow create without requiring the user to read existing votes.** This preserves anonymity — a student should not be able to query the votes collection to see how others voted. The rules should only allow: `allow create: if signedIn() && myActive() && isEligibleVoter();` and `allow read: if isECChair() || isAdmin();`. No `allow list` or `allow get` for students.

---

### 2.10 `public/election-results.html` — New Public Page (≈200 lines)

**Pattern:** Copy `public/activities.html` as the base. It has:
- `pub-nav` navigation.
- `pub-hero-sm` hero section.
- `pub-main` main content area.
- `pub-footer` footer.
- `init.js` + `chrome.js` scripts.

**What to add:**
- Read `electionCycles` (current active/published cycle) and `contestants` (winners only) from Firestore.
- Render winner cards with photo, name, position, comp#, dept, year.
- "View Statistics" toggle that expands to show vote counts, turnout, department/year breakdown.
- Link to contestant manifesto (Google Drive).

**Flag 20:** ⚠️ **This page must work without authentication.** The public results page is visible to anyone. Use `onSnapshot` or `getDoc` on collections that have public-read rules. Ensure the `contestants` rules allow `resource.data.published == true` or a similar flag. The `electionCycles` doc should also allow public read for published cycles.

**Flag 21:** ⚠️ **Do NOT put the results under `index.html` or `activities.html`.** The other AI suggested a dedicated page, and this is correct. Adding results to `index.html` would clutter the landing page and require dynamic DOM injection. A dedicated page is cleaner and easier to cache.

---

### 2.11 `public/index.html`, `public/activities.html`, etc. — Dynamic Nav Link

**Location:** Add a small script block (or modify `chrome.js` or `init.js`) that checks for a published election cycle and injects an "Election Results" link into the nav bar.

**Decision:** The cleanest approach is to add this logic to `chrome.js` (which runs on all public pages) or to a new `public/js/election-nav.js` that is included on all public pages. Since `index.html` and `activities.html` already include `chrome.js`, adding the check there covers all public pages.

**Flag 22:** ⚠️ **Do NOT query Firestore on every public page load if the election is not active.** The query should be lightweight (a single `getDoc` on `electionCycles/current`). If the doc doesn't exist or `resultsPublished !== true`, do nothing. The query cost is minimal (one read per page load).

---

## 3. Decisions from AI Review — Applied

### 3.1 Q1: 4th Year Requirement — Warning, Not Hard Block

**Applied:** In the EC Chair "Add as Contestant" modal, if the position is Chairperson or Secretary and the student's `yearOfStudy !== "4th Year"`, show a **yellow warning banner** at the top of the modal: "Constitution requires 4th Year for this position. Confirm this candidate is qualified?" The EC Chair can still save. The warning is logged in the `electionArchives` doc under `warnings`.

**Implementation location:** `ec-chair.js` — inside the "Add as Contestant" save handler.

### 3.2 Q2: Edit Contestant After Campaigning Starts — Allow with Log

**Applied:** The contestant card in the Nominations tab will have an "Edit" button (pencil icon) that is always visible. Clicking it opens the same modal with pre-filled values. After saving, the system updates `contestant.updatedAt` and adds a `editHistory` array to the contestant doc: `[{ field, oldValue, newValue, editedAt, editedBy }]`. The student UI will show a small "Updated on [date]" label if `updatedAt > createdAt + 5 minutes`.

**Implementation location:** `ec-chair.js` — contestant card renderer + save handler. `student.js` — check `updatedAt` when rendering contestant cards.

### 3.3 Q3: FCM Push Notifications — IMPLEMENTED (not skipped)

**Applied:** When the EC Chair advances the phase (Nominations → Campaigning, Campaigning → Voting, Voting → Counting, Counting → Published), the system sends a push notification to all registered student devices.

**Implementation:**
- In `ec-chair.js`, after the phase transition Firestore write succeeds, call `sendBulkPush()` (new function in `fcm.js` or inline in `ec-chair.js`).
- Query all student FCM tokens from `students/{uid}/fcmTokens` (or however the existing `fcm.js` stores them — check the actual collection structure).
- The existing `fcm.js` has `registerFCMToken(uid, collection)` which stores tokens in `students/{uid}`. We can query the `students` collection and send to each token.
- For v1, use the existing `sendPush(fcmToken, title, body)` in a loop. For 500 students, this is 500 Worker calls. If this is too slow, batch it or skip and send to officers only. **Flag 23:** ⚠️ **Sending 500 individual push notifications via the Worker in a loop will be slow and may hit rate limits.** A better approach: add a `sendBroadcast()` endpoint to the Cloudflare Worker that accepts an array of tokens, or use Firebase Admin SDK (but that requires server-side). For v1, send a push to the UZES Chairperson and the outgoing Executive only, and show a banner on the student portal. **Deferring mass broadcast to v2.**

### 3.4 Q4: Email Vote Receipt — IMPLEMENTED (not skipped)

**Applied:** After a student submits their vote, the system sends an email receipt.

**Implementation:**
- In `student.js`, after the vote submit succeeds, call a new Worker endpoint `/email` with type `vote_receipt`.
- The email contains: "Your vote has been recorded. Receipt token: [8-char hash]. Date: [timestamp]. Positions voted: [list]. This is confirmation that your vote was submitted, not who you voted for."
- The receipt token is stored in `voterTurnout.receiptToken` and is also shown on-screen for the student to screenshot.
- The Worker email endpoint already exists (`admin.js` uses it for OTP). Just add a new `type`.

**Flag 24:** ⚠️ **The existing Worker `/email` endpoint may not support a `vote_receipt` type.** You need to update the Cloudflare Worker code to handle this new type. The Worker code is NOT in this repository — it's deployed separately. Document this as a **deployment dependency** and flag it clearly in the implementation plan.

### 3.5 Q6: Publish Full Vote Counts — Yes

**Applied:** The `election-results.html` public page will show per-contestant vote counts for all positions, not just winners. This builds trust and is constitutionally transparent (Art. 11(e)).

**Implementation:** The `electionStats` doc already contains `positionResults.contestants` with vote counts per contestant ID. The public page reads this and renders it. No additional data collection needed.

### 3.6 Q10: Manual Revote Without Tie — Allow with Required Reason

**Applied:** In the EC Chair Results tab, add a "Call Revote" button next to every position, not just tied ones. Clicking it opens a modal requiring a text reason (min 10 characters). The reason is stored in `electionCycles.revote.reason` and included in the archive export. This gives the EC Chair the constitutional power to address irregularities while leaving an audit trail.

**Implementation:** `ec-chair.js` — Results tab renderer. Add a `reason` field to the `revote` object in `electionCycles`.

### 3.7 OTP Fallback — UZES Chairperson Email Missing/Stale

**Applied:** The "Allow all students to vote" toggle sends an OTP to the UZES Chairperson's email. If the UZES Chairperson doc cannot be found (e.g., no active Chairperson, or `email` field is missing), the system falls back to sending the OTP to the **Admin (Patron)** email.

**Implementation:** In `ec-chair.js`, when the toggle is clicked:
1. Query `executives` collection where `position === "Chairperson"` and `active === true`.
2. If found and `email` exists, send OTP there.
3. If not found, query `executives` where `role === "admin"`.
4. If found, send OTP to admin email.
5. If neither found, show error: "Cannot send OTP — no Chairperson or Admin email on file. Contact system administrator."

**Flag 25:** ⚠️ **The existing admin OTP flow (`admin.js` line 260-350) uses `settings/sysOtp`.** The EC Chair OTP should use a **different** settings doc, e.g., `settings/ecOtp`, to avoid collision if both an admin and an EC Chair are using OTP simultaneously. Use the same `sha256Hex` pattern but a separate doc path.

---

## 4. Break-Risk Flags Summary

| Flag | Risk | File(s) | Mitigation |
|---|---|---|---|
| **1** | Double redirect race if EC redirect is in both `guard.js` and `executive.js` | `guard.js`, `executive.js` | Add redirect **only** in `guard.js`. Remove from `executive.js` if present. |
| **2** | `ec-chair.html` not in `protect()` allowed roles | `ec-chair.js` | Use `protect(["executive", "admin"], ...)` — same as other exec pages. |
| **3** | New SVG icon doesn't inherit theme color | `subhero.js` | Use `stroke="currentColor"`. Safer to reuse existing icons for v1. |
| **4** | `XLSX` library double-import or missing | `admin.html` | It already has `xlsx@0.18.5` CDN. Do not add a second import. |
| **5** | Election archive accidentally deletes files like "Reset academic year" does | `admin.js` | Keep archive as **soft** (status change + Excel export). Do NOT delete proofs or photos. |
| **6** | `subhero.js` doesn't auto-detect new tab panel | `subhero.js` | It does — `.tab-panel` elements are toggled by ID. No changes needed. |
| **7** | Duplicate payment form listeners if EC branch is separate | `student.js` | Branch **inside** existing `payForm` submit listener, not a new listener. |
| **8** | `CATEGORIES` constant mutated | `student.js` | Keep const. Make `buildSelects()` call a dynamic helper. |
| **9** | `YEAR_OPTIONS` not available in `student.js` | `student.js` | Add inline check or create a shared `constants.js` module (breaking change). Safer: inline check. |
| **10** | Student payment history queries wrong collection | `student.js` | Keep EC fees out of student history. Show status in Elections tab only. |
| **11** | Copied industrial-secretary styles break EC layout | `ec-chair.html` | Copy CSS boilerplate only. Write Dashboard styles fresh. |
| **12** | Missing `chrome.js` or `init.js` on new page | `ec-chair.html` | Copy the exact `<script>` footer pattern from `industrial-secretary.html`. |
| **13** | Cross-import from `executive.js` fails (no exports) | `ec-chair.js` | Copy `esc()` and `getDashGreeting()` into `ec-chair.js`. Do not import. |
| **14** | `uploadProof()` callback targets wrong UI element | `ec-chair.js`, `upload.js` | Pass a custom progress callback that updates a contestant modal progress bar, not the payment submit button. |
| **15** | Vote aggregation too slow for large elections | `ec-chair.js` | Client-side aggregation for v1 (fine for <2000 votes). Flag for Cloud Function migration in v2. |
| **16** | Chart library dependency breaks build | `ec-chair.html` | Use CSS flexbox bars, not Chart.js. No new dependency. |
| **17** | `isECChair()` helper defined after match blocks | `firestore.rules` | Place it before any match blocks that use it. |
| **18** | `isExec()` accidentally granted `ecPayments` read | `firestore.rules` | Explicitly restrict to `isECChair() || isAdmin()`. No `isExec()` fallback. |
| **19** | `votes` collection allows student reads (breaks secrecy) | `firestore.rules` | Only `create` for students. `read` only for EC Chair/Admin. |
| **20** | Public results page requires auth | `firestore.rules`, `election-results.html` | Allow public read on `contestants` and `electionCycles` when published. |
| **21** | Results injected into `index.html` clutter | `index.html` | Use dedicated `election-results.html`. Inject nav link only. |
| **22** | Firestore query on every public page load (cost) | `chrome.js` | Single `getDoc` on `electionCycles/current`. One read per load. Negligible. |
| **23** | Mass push notification rate limit | `fcm.js`, Cloudflare Worker | Send to execs only for v1. Defer mass broadcast to v2. |
| **24** | Worker `/email` endpoint doesn't support `vote_receipt` | Cloudflare Worker (external) | Update Worker code before deploying. Document as external dependency. |
| **25** | Admin OTP and EC OTP collide | `admin.js`, `ec-chair.js` | Use `settings/ecOtp` instead of `settings/sysOtp`. |
| **26** | Revote UI shows previous vote names on locked positions | `student.js` | Show blank cards with "Already voted" text. No names, no photos. |
| **27** | Committee Members multi-select with <3 candidates | `student.js` | Adaptive UI: "Select up to N" where N = min(3, candidateCount). |
| **28** | EC Chair edit during voting phase | `ec-chair.js` | Allow edit but log to `editHistory`. Show "Updated" label to students. |
| **29** | 5th Year student sees EC fee in dropdown if already loaded | `student.js` | The dropdown rebuilds on every tab focus or page load. Check eligibility each time. |
| **30** | Published results page accessible before publish | `election-results.html` | Query `electionCycles` and show "Results not yet published" if phase !== "published". |

---

## 5. Implementation Order — Recommended Slice

The other AI recommended building **P1–P3 as a slice** and testing the nomination pipeline live before touching voting/counting. This is the safest approach given the codebase complexity.

### Slice 1: Foundation (P1)
1. Add `EC Chairperson` to `POSITIONS` in `admin.js`.
2. Create `ec-chair.html` (copy from `industrial-secretary.html`, strip content, add 5 tab panels).
3. Create `ec-chair.js` (copy from `industrial-secretary.js`, strip logic, add scaffold).
4. Add `ecTabs()` to `nav.js`.
5. Add EC Chair redirect to `guard.js`.
6. Update `firestore.rules` with `isECChair()` and `ecPayments` rules.
7. Add election creation card to `admin.html` → System tab + `admin.js`.
8. Test: Create an election cycle, create an EC Chair account, verify redirect works.

### Slice 2: Student Payment + Nominations (P2–P3)
9. Add "EC Nomination Fee" to `student.js` category dropdown (gated by membership and year).
10. Add `ecPayments` branch in `student.js` pay form submit.
11. Build EC Chair Nominations tab: load `ecPayments`, approve/reject, inline "Add as Contestant" modal.
12. Build `contestants` collection writes from approved `ecPayments`.
13. Test: Student pays EC fee → EC Chair approves → contestant appears. Verify no manual bypass.

### Slice 3: Voting + Results (P4–P6)
14. Build student Elections tab: gated states, position sub-tabs, contestant cards, Done/Submit flow.
15. Build `votes`, `voterTurnout`, `draftSelections` collections.
16. Build phase transitions in EC Chair Dashboard.
17. Build EC Chair Results tab: aggregation, tie detection, revote, publish.
18. Build `election-results.html` public page.
19. Test: Full end-to-end vote, counting, publish, public results.

### Slice 4: Polish (P7–P8)
20. Add FCM push notifications (exec-only broadcast for v1).
21. Add email vote receipt (Worker update required).
22. Add analytics graph (CSS bars).
23. Add archive to Excel export.
24. Add 5th Year lock, warning banners, edit history, OTP fallback.

---

## 6. External Dependencies Requiring Manual Updates

| Dependency | Location | What to Update | Who |
|---|---|---|---|
| **Cloudflare Worker `/email` endpoint** | Deployed externally | Add `vote_receipt` type. Add `sendBroadcast` or bulk push endpoint. | Developer with Worker access |
| **Cloudflare Worker `/upload` endpoint** | Deployed externally | Ensure it accepts `elections/{cycleId}/...` path prefix. | Developer with Worker access |
| **Firebase Console** | Firebase project | Add `EC Chairperson` position to any external exec lists if used. | Firebase admin |
| **reCAPTCHA / App Check** | Firebase Console | Whitelist `election-results.html` if App Check is strict. | Firebase admin |
| **Android Capacitor app** | `android/` directory | Add `ec-chair.html` to the web asset manifest if using a custom WebView asset loader. | Android developer |
| **GitHub Actions CI/CD** | `.github/workflows/` | No changes needed — the build is static files. | N/A |
| **Firebase Hosting deploy** | Firebase CLI | Standard `firebase deploy` will pick up new files. | Developer with Firebase CLI |

---

*End of Integration Workflow Plan.*
