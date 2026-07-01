# UZES Session Report — Electoral Commission Module (Build Start)

> **⚠️ SELF-REMINDER (read this every turn in this session):** Whenever ANY code
> change is made in this chat, update THIS file immediately afterward — new
> chapter or bullet under the current slice, what changed, which files, why,
> and any flags/decisions hit from `ELECTORAL_COMMISSION_WORKFLOW.md`. Do not
> batch updates until end of session. Also skim the other `.md` files in this
> `UPDATES/` folder at the start of a session to see where prior sessions left
> off — this file is that record for future sessions.

**Date:** 2026-07-01
**Covers:** Beginning implementation of the Electoral Commission module for UZES, per:
- `ELECTORAL_COMMISSION_PLAN.md` (constitutional/architecture spec)
- `ELECTORAL_COMMISSION_WORKFLOW.md` (file-by-file integration + break-risk flags)

**Status at start of session:** Planning complete, reviewed and refined (open questions Q1–Q10 answered — see below). No EC code exists in the repo yet. Starting Slice 1 (Foundation) per the workflow doc's recommended build order.

---

## Decisions Locked In (from planning discussion, before this session)

- **Q1 (4th Year requirement):** Warning banner, not hard block. EC Chair retains override authority.
- **Q2 (edit contestant after Campaigning starts):** Allowed, logged via `editHistory` array + "Updated on [date]" label to students.
- **Q3 (FCM push on phase change):** v1 = executives/officers only (not mass broadcast to all students — rate-limit risk). Mass broadcast deferred to v2.
- **Q4 (email vote receipt):** Implemented, but requires an external Cloudflare Worker `/email` endpoint update (`vote_receipt` type) — **external dependency, not fixable from this repo alone.**
- **Q6 (publish full vote counts):** Yes — publish per-contestant counts, not just winners.
- **Q8 (by-elections):** Modeled as a new mini `electionCycles` doc, not a special mode.
- **Q10 (manual revote without detected tie):** Allowed, requires a typed reason (min 10 chars), logged to `electionCycles.revote.reason` and the archive.
- **OTP fallback:** "Allow all students to vote" OTP → UZES Chairperson email; if missing/stale, falls back to Admin email.

## Known External Dependencies (not part of this repo, must be tracked separately)

- Cloudflare Worker `/email` endpoint needs a new `vote_receipt` type (Flag 24).
- Cloudflare Worker `/upload` endpoint must accept `elections/{cycleId}/contestants/{contestantId}` path prefix (should already work generically, but verify).
- Android Capacitor asset manifest may need `ec-chair.html` added if a custom WebView loader lists pages explicitly (check `android/` before Slice 1 is considered done).

---

## Slice Plan (from Workflow §5)

- **Slice 1 — Foundation (P1):** `EC Chairperson` position, `ec-chair.html` + `ec-chair.js` scaffold, `ecTabs()` in `nav.js`, guard redirect, `firestore.rules` base (`isECChair`, `ecPayments`), admin.js election creation card. Test: create cycle + EC Chair account + redirect works.
- **Slice 2 — Payment + Nominations (P2–P3):** student.js EC fee category + branch, EC Chair Nominations tab, payment→contestant pipeline (no manual bypass).
- **Slice 3 — Voting + Results (P4–P6):** student Elections tab, votes/voterTurnout/draftSelections, phase transitions, Results tab + tie/revote, public results page.
- **Slice 4 — Polish (P7–P8):** FCM (exec-only v1), email receipt (needs Worker update), CSS bar analytics, Excel archive export, 5th-year lock, warning banners, edit history, OTP fallback.

---

## Chapter 1 — Session Setup

- Read both planning docs (`ELECTORAL_COMMISSION_PLAN.md`, `ELECTORAL_COMMISSION_WORKFLOW.md`) in full.
- Verified via `ls`/`grep` that no EC-related files or code exist yet in `public/`, `public/js/`, `nav.js`, `admin.js` — confirmed clean starting point.
- Skimmed most recent prior session report (`SESSION-REPORT-2026-06-30-P2.md`) — unrelated work (Android APK/App Check), no conflict with EC work.
- Created this tracking file.

**No code changes yet this chapter.**

---

---

## Chapter 2 — Slice 1, Step 1: `EC Chairperson` position

**File changed:** `public/js/admin.js` — `POSITIONS` constant (line 93-97).

**Change:** Appended `"EC Chairperson"` to the `POSITIONS` array. This feeds the existing executive-account-creation dropdown (`sel.innerHTML = POSITIONS.map(...)`, admin.js line ~539) — no new UI needed, Admin can now create an EC Chairperson account the same way as any other executive.

**Discrepancy noted vs. planning docs:** The plan/workflow docs refer to `"Secretary"` and `"Vice Secretary"`. The actual codebase uses `"Secretary General"` and `"Vice Secretary General"`. Must use the real names later when implementing the Art. 9(a) 4th-Year warning check (Chairperson + Secretary General only). Also `"Committee Member"` in `POSITIONS` is singular — that's for assigning an executive's own account position, separate from the ballot's "3 Committee Members" ballot slot which is a different concept (contestants, not accounts).

**Verification:** Not run — this is a data-only change behind admin auth; no login credentials available to check the live dropdown in preview. Confirmed by grep that `POSITIONS` is consumed correctly at admin.js:539 and :616.

**User clarification (2026-07-01):** The Art. 9(a) 4th-Year-only warning applies **strictly to Chairperson and Secretary General**. Vice Secretary General (and all other positions) only need Art. 9(b): not graduating, paid-up, good character — so 2nd/3rd/4th Year is fine for Vice Secretary General, just not 5th Year/Graduate. Only Chairperson + Secretary General trigger the "not 4th Year" warning banner; all other positions (except the general 5th-Year/Graduate warning) trigger no warning.

**Next:** Slice 1, Step 2 — scaffold `ec-chair.html` (copy pattern from `industrial-secretary.html`).

---

## Chapter 3 — Slice 1, Step 2: `ec-chair.html` scaffold

**File created:** `public/ec-chair.html` (new).

**What it contains:**
- Copied CSS boilerplate from `industrial-secretary.html`: `.tabs`/`.tab-btn`/`.tab-panel`, `.section-head`/`.section-sub`, `.req-card` family (approve/reject cards for Nominations), `.status-pill`, `.btn-danger-sm`, dark-mode overrides.
- **Wrote fresh** (per Flag 11 — do not blindly reuse industrial-secretary's session-toggle/pipeline styles): `.ec-phase-pipeline`/`.ec-phase-step` (Dashboard phase pipeline), `.ec-warn-banner` (yellow warning banner for Q1's 4th-Year check), `.ec-kpi-grid`/`.ec-kpi-card` (Dashboard KPIs), `.ec-bar-row`/`.ec-bar-track`/`.ec-bar-fill` (Results tab CSS-only bar chart — no chart library, per Flag 16). Reused the existing `.toggle-switch` pattern from industrial-secretary for the "Allow all students to vote" toggle (Overview tab) since it's functionally identical to the session toggle.
- 5 tab panels matching the planned `ecTabs()` ids: `tab-dash`, `tab-nom`, `tab-overview`, `tab-results`, `tab-profile`. Content is skeleton/placeholder only — no live data wiring yet (that's Slice 1 step 3 onward, `ec-chair.js`).
- Footer + script tags follow the exact pattern from `industrial-secretary.html` (`init.js`, `js/ec-chair.js` as a module, `chrome.js`) — per Flag 12, missing `chrome.js` breaks theme toggle/mobile nav, so kept it.

**Verification:** Not run yet. The page references `js/ec-chair.js`, which does not exist yet — loading it now in preview would just show a 404/console error for the missing module and no subhero (since `subhero.js` is invoked from within `ec-chair.js`, not the HTML). Deferring preview check until `ec-chair.js` scaffold exists (next step).

**Next:** Slice 1, Step 3 — scaffold `public/js/ec-chair.js` (copy pattern from `industrial-secretary.js`).

---

## Chapter 4 — User clarification: 4th-Year rule scope

**No code change** — clarification only, recorded for later implementation of the Art. 9(a) warning banner:
- The 4th-Year-only warning applies **strictly to Chairperson and Secretary General** (matches actual codebase position names, not the plan doc's generic "Secretary").
- **Vice Secretary General** and all other positions only need Art. 9(b) (not graduating/5th-Year/Graduate) — 2nd/3rd/4th Year is all fine, no warning.
- This will matter in the "Add as Contestant" modal in `ec-chair.js` (Slice 2/3).

---

## Chapter 5 — Slice 1, Step 3a: `ecTabs()` in `nav.js`

**File changed:** `public/js/nav.js` — added `ecTabs()` function (before `secretaryTabs()`), returning the 5 tabs matching `ec-chair.html`'s panel ids: `tab-dash`, `tab-nom`, `tab-overview`, `tab-results`, `tab-profile`.

**Icons used:** `dash`, `inbox`, `users`, `chart`, `acc` — all already exist in `subhero.js`'s `ICO` map. No new icon added (Flag 3 — new SVGs need testing in both themes; safer to reuse existing ones for v1).

**Verification:** Not run — `ecTabs()` isn't imported/consumed anywhere yet (that happens when `ec-chair.js` calls `initSubHero(..., { tabs: ecTabs() })`). Nothing renders differently in the browser yet. Confirmed via reading `subhero.js` that all 5 icon keys exist in the `ICO` object.

**Next:** Slice 1, Step 3b — scaffold `public/js/ec-chair.js` (copy pattern from `industrial-secretary.js`: imports, event delegation with `data-action^='ec:'`, `protect()` bootstrap, lazy tab loading via `window.shOnTab`).

---

## Chapter 6 — Correction to Workflow Flag 1: redirect pattern

**Important deviation from `ELECTORAL_COMMISSION_WORKFLOW.md` §2.1 / Flag 1.** The workflow doc assumed the redirect should live only in `guard.js` to avoid a "double redirect race." Reading the actual code showed this is **not** how the existing Industrial Training Secretary redirect works — `guard.js` has no position-based logic at all. The real, working pattern is a two-way check split across two files:
- `public/js/executive.js:78-81` — if `profile.position === "Industrial Training Secretary"`, redirect to `industrial-secretary.html`.
- `public/js/industrial-secretary.js:115-117` — if position is NOT that value, redirect back to `executive.html`.

**File changed:** `public/js/executive.js` — added the mirrored EC Chairperson check immediately after the existing Industrial Training Secretary check (line ~82-84):
```js
if (profile.role === "executive" && profile.position === "EC Chairperson") {
  location.replace("ec-chair.html"); return;
}
```

The reverse check (redirect away from `ec-chair.html` if position isn't `EC Chairperson`) will be added when `ec-chair.js` is scaffolded next, mirroring `industrial-secretary.js:114-117`.

**Verification:** Not run yet — this redirect only fires for a logged-in executive whose position is `EC Chairperson`, and no such account exists yet (Admin hasn't created one). Will verify end-to-end once Slice 1 is far enough to create a test EC Chair account.

**Next:** Slice 1, Step 3b — scaffold `public/js/ec-chair.js`, including the reverse redirect check.

---

## Chapter 7 — Slice 1, Step 3b: `ec-chair.js` scaffold + live verification

**File created:** `public/js/ec-chair.js` (new).

**What it contains:**
- Imports mirrored from `industrial-secretary.js`: `db`, `protect`, `initSubHero`, and the new `ecTabs()` from `nav.js`.
- Event delegation stub for `data-action^='ec:'` (empty switch — populated in Slice 2/3 as Nominations/Overview/Results actions are built).
- `esc()` and `getDashGreeting()` copied inline (per Flag 13 — no shared utils module exists in this codebase, every page keeps its own copy; do not cross-import from `executive.js`).
- `renderECDash()` — shows a greeting card + "No active election cycle yet" placeholder (real phase pipeline/KPIs come once `electionCycles` exists, Slice 1 continuing / Slice 2).
- `loadNominations()`, `loadOverview()`, `loadResults()` — placeholder stubs wired to `window.shOnTab` lazy loading, matching the `industrial-secretary.js` lazy-tab pattern.
- **Reverse redirect** (completes Chapter 6's fix to Flag 1): `protect()` bootstrap checks `profile.position !== "EC Chairperson"` and bounces non-EC executives back to `executive.html` — mirrors `industrial-secretary.js:114-117` exactly. Admins pass through untouched (role check only fires for `role === "executive"`).

**Verification — ran live in preview:**
1. Started the `uzes` dev server (`npx serve public -l 5500`, mapped to port 5050 in this session).
2. Navigated to `/ec-chair.html` unauthenticated.
3. Confirmed via `preview_eval` that it correctly redirected to `/login.html` (expected — `protect()` sends anonymous users there).
4. Checked `preview_console_logs` — only expected Firebase App Check init logs, **no script errors, no failed module resolution** (confirms `ec-chair.html`'s `<script type="module" src="js/ec-chair.js">` and all its imports resolve correctly).
5. Checked `preview_network` for failures — found only a pre-existing, unrelated issue: a 403 on the App Check reCAPTCHA token exchange endpoint. This is a known environment issue (see `APPCHECK-RECOVERY-GUIDE.md` in this folder — reCAPTCHA domain whitelist doesn't include the local preview host) and is **not caused by this session's changes**. Confirmed not a regression since it's an infra-level App Check config issue, not related to EC code.

**Not yet verifiable:** Full authenticated flow (actual EC Chair dashboard rendering, redirect-if-wrong-position) requires a real EC Chairperson test account, which doesn't exist yet — Admin must create one first (Slice 1 continues below).

**Next:** Slice 1, Step 4 — add `isECChair()` helper + `ecPayments`/`electionCycles` rules to `firestore.rules`.

---

## Chapter 8 — Slice 1, Step 4: `firestore.rules` — full EC ruleset

**File changed:** `firestore.rules` — added an "ELECTORAL COMMISSION" section at the end (before the closing braces), containing `isECChair()` and all 8 collections from plan §3 in one pass (not just `ecPayments`/`electionCycles` as the minimal Slice 1 step called for) — reasoning: rules are inert until a collection is actually written to, and adding them all now avoids the real risk of forgetting rules later when Slice 2/3 UI code starts writing to `contestants`/`votes`/etc.

**What was added:**
- `isECChair()` — placed near the other position-helpers pattern (defined close to its feature section, matching how `isSecretary()`/`isSG()`/`isViceSG()` are defined near Industrial Attachment/Placement sections, not hoisted to the top common-helpers block).
- `ecPayments` — read restricted to `isECChair() || isAdmin()` only, explicitly **not** `isExec()` (Flag 18 — Treasurer and other execs must never see nomination fees).
- `electionCycles` — create: Admin only; update (phase advance): EC Chair or Admin.
- `contestants` — create/update restricted to EC Chair/Admin (app enforces the "must come from an approved ecPayment" pipeline; the rule itself can't verify that provenance).
- `votes` — **create-only** for students, no read/list at all for students (Flag 19 — ballot secrecy). Only EC Chair/Admin can read.
- `voterTurnout` — self-read/write plus EC Chair/Admin, matching the "shows which positions voted, never which contestant" design.
- `draftSelections` — fully self-scoped.
- `electionStats`, `electionArchives` — EC Chair/Admin (stats) and Admin-only (archives).

**Two bugs caught and fixed before they became live issues (self-review during this step, not user-reported):**
1. **`contestants` public-read bug:** Initially wrote `resource.data.published == true` for the Flag 20 "public read once published" requirement — but the plan's `contestants` schema (§3.3) has **no `published` field**. That condition would always evaluate false, silently breaking `election-results.html` later (a bug that wouldn't surface until Slice 3, hard to trace back). Fixed to check the parent cycle's phase instead: `get(.../electionCycles/$(resource.data.cycleId)).data.phase == 'published'`.
2. **`electionCycles` public-read gap:** The Flag 20 requirement ("public results page works without auth") also needs `electionCycles` itself readable unauthenticated once published — original rule required `signedIn()` unconditionally, which would have blocked the public results page from ever loading a published cycle. Fixed: `allow read: if (signedIn() && myActive()) || resource.data.phase == 'published';`.

**Verification:**
- Confirmed `firebase.json` already points `firestore.rules` at this file (no config change needed).
- Ran `npx firebase emulators:start --only firestore` — reached "All emulators ready!" before being stopped, confirming the rules file **parses/compiles without syntax errors**. (A malformed rules file fails before reaching "ready".)
- Did not run functional rule-simulation tests (no test harness exists in this repo for firestore rules) — that would require the emulator + test data, out of scope for a syntax-level check at Slice 1.
- Cleaned up the `firestore-debug.log` the emulator left behind; not committed.

**Next:** Slice 1, Step 5 — add election-cycle creation card to `admin.html` / `admin.js` (System tab): Admin creates the cycle, later archives it.

---

## Chapter 9 — Slice 1, Step 5: Election Management card (`admin.html` + `admin.js`)

**Files changed:**
- `public/admin.html` — added an "Election Management" card in the System tab, placed between the existing "Industrial Training Secretary" card and "Library — Seed course list" (per Workflow §2.3 location), with a single `#electionMgmtStatus` mount point (skeleton "Loading…" placeholder, filled by JS).
- `public/js/admin.js` — added `initElectionCard()`, `renderElectionCreate()`, `renderElectionActive()`, called from `initSettings()` right after the existing `initSecretaryCard()` call (so it loads when the System tab's OTP re-auth gate passes, same as every other System tab section).

**Design decision — no dedicated EC Chairperson account-creation UI needed:** Unlike the Industrial Training Secretary (which needs a bespoke lecturer-account card because it's not in the normal `POSITIONS` dropdown), `EC Chairperson` **was already added to `POSITIONS`** in Chapter 2. So Admin creates the EC Chairperson account through the existing, generic Executives tab flow — no new form required. This card only handles the election **cycle** (create/archive), matching plan §7.1.

**What it does:**
- Queries `electionCycles` for a doc with `status == "active"`. None found → shows the create form (name input only, matching plan §3.1's minimal cycle fields: `phase: "nominations"`, `status: "active"`, `allowAllStudents: false`, `revote: null`, etc.) via `setDoc(doc(collection(db,"electionCycles")), {...})` (auto-generated ID, no need to import `addDoc`).
- Found → shows cycle name + human-readable phase label, and an "Archive election" button **disabled unless `phase === "published"`** (matches plan §4's lifecycle and Admin's read-only-until-published constraint from plan §7.1).
- Archive click: confirms, then does a **soft archive only** — flips `status: "archived"` + `archivedAt`. The full `electionArchives` snapshot doc + Excel export (Flag 4/5, XLSX library reuse) is explicitly deferred to Slice 4 / P7 per the agreed build order — this is not a forgotten feature, it's sequenced. A muted note is shown to Admin only when the archive button is *disabled* (before publish); once enabled, clicking it archives immediately without an extra "export not ready yet" caveat, since the export is additive and doesn't block the archive action itself.

**Verification:**
- Syntax-checked `admin.js` with `node --input-type=module --check` — no errors.
- Live in preview: navigated to `/admin.html` unauthenticated, confirmed correct redirect to `/login.html`, zero console errors (confirms no import/parse errors from the new functions).
- **Not verified:** the actual create → view → archive flow, since that requires a real Admin login plus the System tab's OTP re-auth gate (`showSystemVerify()`), and no test credentials are available in this session. This is the same limitation noted in Chapter 2 for the `POSITIONS` change — will need a live admin session to fully confirm.

**Slice 1 status:** All 5 planned steps done (position, `ec-chair.html`, `ec-chair.js`, `nav.js`, redirects, `firestore.rules`, admin System tab card). What's still unverified end-to-end: actually creating a cycle + an EC Chairperson account + confirming the redirect fires — needs a real login session, which the user should do manually or provide credentials for.

**Next:** Either (a) user tests Slice 1 live (create cycle, create EC Chair account, confirm redirect), or (b) proceed straight into Slice 2 (student My Finance EC fee category + EC Chair Nominations tab) and defer live testing to a combined checkpoint.

---

## Chapter 10 — Commit, push, and production deploy

**User report:** Could not create the EC Chairperson account testing on `localhost:5000`.

**Root cause identified:** This repo's local dev server (`npx serve public`) only serves static files — it talks to the **real** `uzes-friendly-web` Firebase project for Auth/Firestore (no local emulator wired into `firebase.js`). The new `firestore.rules` changes (Chapter 8) were sitting in the working tree only — never deployed — so the live Firestore was still running the **old** rules with no `ecPayments`/`electionCycles`/etc. collections defined at all (default-deny). That's almost certainly why the EC account/cycle flow didn't work locally: it's not a localhost issue, it's an undeployed-rules issue.

**Actions taken (per explicit user request "commit and push"):**
1. `git add` on all EC-related changes (`firestore.rules`, `admin.html`, `admin.js`, `executive.js`, `nav.js`, `ec-chair.html`, `ec-chair.js`, both planning docs, this session report) **plus** several stray untracked session-report `.md` files left over from prior sessions (`SESSION-REPORT-2026-06-30-P3.md`, `-2026-07-07-P2.md`, `-2026-07-07.md`, `-APPCHECK-EMAIL-FIXES.md`, `-PLACEMENT-PHASE5-8.md`) that were sitting uncommitted — folded into the same commit since they're harmless docs and shouldn't be left stranded.
2. Committed as `16bb8f3` — "Add Electoral Commission foundation (Slice 1)".
3. Pushed to `origin/main` (`3b83ea0..16bb8f3`).
4. **Checked `.github/workflows/`** — confirmed the only CI workflow is `build-android.yml` (APK build). There is **no CI step that deploys Firestore rules or Firebase Hosting** — pushing to GitHub alone does not update the live site or live rules.
5. **Asked the user** whether to deploy now or let them do it manually — user chose "deploy now."
6. Ran `npx firebase deploy --only hosting,firestore:rules`. Result: rules compiled successfully and released to `cloud.firestore`; hosting uploaded and released. Live at https://uzes-friendly-web.web.app.

**Current state:** The EC foundation (position, `ec-chair.html`/`.js`, redirects, rules, Admin System-tab card) is now live in production. The user should be able to create the EC Chairperson account and an election cycle against the real deployed site now (not localhost).

**Reminder for future sessions:** This repo has **no automatic Firestore-rules or Hosting deploy in CI** — only `git push` triggers the Android APK workflow. Any `firestore.rules` or `public/` change made in a coding session must be **manually deployed** with `firebase deploy` (scoped to `hosting,firestore:rules` as needed) before the user can test it live — a `git push` alone is not sufficient and this has already caused one false "it's broken" report today.

**Next:** Await user's live test results (create EC Chair account + election cycle + confirm redirect against production), then proceed to Slice 2 (student My Finance EC fee category + EC Chair Nominations tab pipeline).

---

## Chapter 11 — Live test result: App Check error (pre-existing, not EC-related)

**User report:** Creating the EC Chairperson account on the live site failed with `Firebase: Error (auth/firebase-app-check-token-is-invalid.)`. Worked around it by changing an **existing** executive's position to `EC Chairperson` to preview the dashboard instead.

**Assessment:** This is the same pre-existing App Check/reCAPTCHA problem already documented in `APPCHECK-RECOVERY-GUIDE.md` (and seen earlier in this session's own preview testing — Chapter 7 — as a 403 on the reCAPTCHA token-exchange endpoint). It is **not caused by anything in this session's EC changes**; it affects any authenticated write action across the whole app, not just EC account creation. Not fixing it in this session — out of scope for the EC feature build and there's already a dedicated recovery guide for it.

**Confirmed working via the workaround:** EC dashboard (`ec-chair.html`) rendered correctly for a repurposed executive account — meaning the redirect logic (`executive.js` → `ec-chair.html`, and the reverse check in `ec-chair.js`) **works end-to-end in production**, which was the main thing Slice 1 needed to prove. The App Check hiccup only blocked *creating a new* account, not the redirect/dashboard itself.

**User decision:** Move on to Slice 2 rather than fix App Check now.

**Next:** Begin Slice 2 — student My Finance "EC Nomination Fee" category (gated by paid-membership + not 5th Year/Graduate) and the EC Chair Nominations tab (approve payment → "Add as Contestant", no manual bypass).

---

## Chapter 12 — Slice 2: student My Finance EC fee + EC Chair Nominations tab

**File changed:** `public/js/student.js`
- Added `EC_INELIGIBLE_YEARS = ["5th Year", "Graduate"]` inline (Flag 9 — no shared constants module in this codebase, kept local).
- `checkElectionNominationEligibility()` — gates the EC fee option on: not 5th Year/Graduate, an active `electionCycles` doc exists, its `phase === "nominations"` (decision: fees should stop being accepted once nominations close, even though plan §9.1 only said "cycle is active" — logged as a deliberate interpretation), and the student has a confirmed `Membership Dues` payment (reused the exact query `loadMembership()` already uses).
- `buildCategorySelect()` — async, appends `"EC Nomination Fee"` to the existing `CATEGORIES` list only when eligible. `buildSelects()` now calls this instead of statically listing categories (Flag 8 — `CATEGORIES` const itself is untouched).
- Payment submit handler: added an `if (category === "EC Nomination Fee")` branch **inside** the existing `payForm` submit listener (Flag 7 — not a separate listener, so upload/proof/error handling isn't duplicated). Writes to `ecPayments` (not `payments`) with `cycleId`, `department`, `yearOfStudy` fields that the plain `payments` schema doesn't have. After a successful submit of either kind, also calls `buildCategorySelect()` again to refresh eligibility (e.g. a student who just got their Membership Dues confirmed elsewhere becomes newly eligible without a page reload) — a partial answer to Flag 29 without adding a full re-check on every tab focus.
- Confirmed (no code change needed): `renderHistoryList()` still only queries `payments`, so EC fees correctly stay out of the student's own payment history, per plan's Q/Flag 10 decision.

**File rewritten:** `public/js/ec-chair.js` — Nominations tab is now fully implemented, plus the Dashboard was upgraded from a static placeholder to real data:
- `loadActiveCycle()` — shared helper, used by both Dashboard and Nominations.
- **Dashboard:** now shows the real cycle name, current phase, and two live KPI cards (pending nominations count, approved contestant count) once a cycle exists. Phase-advance buttons and the full KPI set (fees collected, votes cast, turnout) are explicitly deferred to Slice 3/4 — noted directly in the UI copy so it doesn't look broken/half-done.
- **Nominations tab:** loads `ecPayments` + `contestants` for the active cycle in parallel. Pending payments get Approve/Reject (with a reject-reason form, mirroring the exact `industrial-secretary.js` reject-form pattern). Confirmed payments get **"+ Add as Contestant"** — and only that; once a contestant already exists for a payment, the button is replaced with a checkmark showing the assigned position (Flag: "no manual bypass" — there is no other way to create a `contestants` doc in this UI).
- **Add as Contestant modal:** built dynamically (matches the `viewProof` pattern in `student.js` — inject once, reuse). Position dropdown (8 `BALLOT_POSITIONS`), required photo upload (reuses `uploadProof()` from `upload.js` with folder `elections/{cycleId}/contestants`, per Flag 14 — custom progress callback updates the modal's own progress text, not any payment-submit button), optional manifesto URL. **Warning banner** recomputes live on position change: shows if the student is 5th Year/Graduate (constitutionally ineligible generally) OR if the selected position is `Chairperson`/`Secretary General` and the student isn't 4th Year (Art. 9(a), per the user's Chapter 4 clarification — Vice Secretary General does NOT trigger this warning). Banner is advisory only — EC Chair can still save, matching the Q1 decision.
- **Contestant roster:** grouped by position, shows status pill, and a "Disqualify" button on approved contestants (prompts for a reason, sets `status: "disqualified"` — hidden from future ballot rendering in Slice 3, but kept in the record per plan §2.10's edge case).
- Overview and Results tabs remain scaffolded placeholders (Slice 4 and Slice 3 respectively) — untouched this chapter.

**Verification:**
- Both files syntax-checked with `node --input-type=module --check` — no errors.
- Live in preview: navigated to `/student.html` and `/ec-chair.html` unauthenticated — both correctly redirect to `/login.html`, zero console errors (confirms all new imports/functions parse and load without error).
- **Not verified live:** the actual authenticated flow (submit EC fee as a student → approve as EC Chair → add as contestant → see it in the roster). This needs real student + EC Chair login sessions, which aren't available in this tool session. Self-reviewed the logic carefully against the `firestore.rules` written in Chapter 8 (`ecPayments` update requires `isECChair()||isAdmin()` — matches `ecApprovePay`/`ecRejectPay`; `contestants` create requires the same — matches the modal's `setDoc` call) to catch rule/code mismatches before they'd surface at test time.

**Next:** User to test Slice 2 live (submit an EC fee as a student, approve + add as contestant as EC Chair) — will need a fresh `firebase deploy` first, same as Slice 1, since there's no CI auto-deploy (Chapter 10's reminder still applies). After that, Slice 3 begins: student Elections tab (ballot UI), `votes`/`voterTurnout`/`draftSelections`, phase transitions, Results tab with tie detection/revote, and the public results page.

---

## Chapter 13 — Live test confirmed: Nominations pipeline works

**User report:** Successfully uploaded/added a contestant via the Nominations tab on localhost. This confirms the full Slice 2 pipeline works against the real deployed Firestore (payment approve → "Add as Contestant" modal → photo upload → `contestants` doc created → shows in roster) — no reported bugs.

**Note:** This was tested against whatever was last deployed (Chapter 10's `firebase deploy --only hosting,firestore:rules`, before Slice 2 code existed on that deploy) — actually, re-checking: the Slice 2 code (student.js EC fee branch, ec-chair.js Nominations tab) was written in Chapter 12 but **not yet deployed**. If the user tested against localhost and it worked, `ec-chair.html`/`ec-chair.js` are static files served directly by the local dev server (no deploy needed for JS/HTML changes to be visible locally) — only `firestore.rules` changes require a deploy to take effect, and those were already deployed in Chapter 10 before Slice 2 began, so no rules gap here. Confirmed: the Slice 2 code changes are pure client-side JS/HTML which the local `npx serve public` picks up directly from disk — deploy is only required for the user to test on the **production URL**, not localhost. Local testing already exercises the real Firestore backend (per Chapter 10's root-cause note), so this live pass is a genuine end-to-end confirmation.

**User decision:** Proceed straight to Slice 3 (Voting + Results) — no separate commit/push/deploy checkpoint requested yet.

**Next:** Begin Slice 3 — student Elections tab (gated ballot UI, position sub-tabs, Committee Members multi-select), `votes`/`voterTurnout`/`draftSelections` collections, EC Chair phase transitions (Nominations → Campaigning → Voting → Counting → Published), Results tab (live counts, tie detection, revote), and the public `election-results.html` page.

---

## Chapter 14 — Slice 3: Voting + Results (full slice, built in one pass)

Built the entire remaining slice in sequence since the pieces are tightly coupled (phase transitions gate the ballot; the ballot writes the votes the Results tab counts; Results feeds the public page). Verified each file with a syntax check + live preview load as it was written, same discipline as prior chapters.

**1. `public/js/ec-chair.js` — Dashboard phase transitions.**
Replaced the static "phase controls added later" note with a real phase pipeline (`.ec-phase-pipeline` steps, done/active/upcoming states) and an "Advance to {next phase}" button. Advances Nominations → Campaigning → Voting → Counting directly from the Dashboard. **Counting → Published is deliberately NOT here** — it requires the tie check, so that transition lives on the Results tab's Publish button instead (matches plan §6.3/§6.5 exactly: Dashboard owns the first four transitions, Results owns the last one).

**Bug caught and fixed before it shipped:** `window.shOnTab`'s lazy-tab-loading used a `loaded` Set to load each tab only once per page load. That's fine for Nominations (which self-refreshes after actions) but wrong for **Results and Dashboard**, whose entire content depends on the cycle's *current phase* — a real workflow is: EC Chair opens Results during Voting (sees "not ready"), later advances phase from the Dashboard, returns to Results expecting live counts, and would have seen the stale "not ready" message forever because `tab-results` was already marked `loaded`. Fixed by removing the once-only guard for `tab-dash`/`tab-nom`/`tab-results` (all reload every visit now); kept it for `tab-overview` only, since that tab has no live logic yet (Slice 4).

**2. `public/student.html` + `public/js/nav.js` — Elections tab scaffold.**
Added `#tab-election` panel (skeleton loader + content div, per Flag 6 — all real UI built dynamically by JS, matching how Dashboard/History are already built) and an `.elec-*` CSS block (position sub-tabs, contestant cards, committee multi-select grid, confirm panel) directly in `student.html`'s existing `<style>` block. Added the "Elections" tab to `studentTabs()` in `nav.js`, reusing the existing `check` icon (no new SVG, per Flag 3).

**3. `public/js/student.js` — full ballot logic (`initElection()` and friends).**
- Gating priority, in order: no active cycle → closed. Not paid-up & `!allowAllStudents` → pay message (applies even during Campaigning — a deliberate reading of plan §5.2, since only paid/allowed students should preview or draft a ballot at all). `phase === "nominations"` → "candidate list coming soon." Revote active for a position → checks `voterTurnout.revotes[position]` first (so a revote takes priority over the "already voted" gate — lets a student who voted in the main round back in for just that one position). Otherwise, `voterTurnout.mainRound` exists → locked "already voted." Else render the full ballot for Campaigning (draft-only, submit disabled) or Voting (submit enabled).
- Position sub-tabs render from a local `BALLOT_POSITIONS` array (same 8 as `ec-chair.js`, no shared constants module — consistent with the rest of this codebase). Committee Member gets its own multi-select panel with a live "(x/N selected)" counter, `N = min(3, candidateCount)` per the plan's adaptive-UI edge case, and a manual cap so a 4th checkbox can't be selected.
- Selections are held in a module-level `_selections` object and **fully re-rendered on every click** (select a candidate, toggle a committee member, press Done) rather than doing fine-grained DOM patches — simpler to keep correct, and cheap given contestant counts are small. The currently active tab is preserved across re-renders via `_activePosition` so clicking doesn't bounce the student back to the first tab.
- **Campaigning phase:** pressing "Done" on a tab persists the whole `_selections` object to `draftSelections/{uid}` (best-effort — a retry is just pressing Done again). Submit button stays disabled with the exact tooltip text from the plan.
- **Voting/Revote phase:** draft selections are pre-loaded (Voting only — Revote always starts blank per plan §5.8) and the student can change them before final submit.
- **Submit:** writes one `votes` doc per selection (3 separate docs for Committee Members), a `voterTurnout/{uid}` doc (merge, so `revotes.{position}` doesn't clobber a prior revote entry for a different position — Firestore's `setDoc(..., {merge:true})` deep-merges nested maps, confirmed this is safe before relying on it), generates and shows an 8-character receipt token (not linked to choices, per plan), and deletes `draftSelections` on a **main-round** submit only (revote submits don't touch it, since campaigning/voting for other positions isn't happening again).

**4. `public/js/ec-chair.js` — Results tab (aggregation, tie detection, revote, publish).**
- `loadResults()` shows a "come back after Counting" message during Nominations/Campaigning/Voting, then aggregates client-side (Flag 15 — no Cloud Function for v1) by reading all `votes` for the cycle plus all `status:"approved"` `contestants`.
- `computePositionResults()` counts main-round votes per contestant; if a position has ANY `round:"revote"` votes recorded, those fully replace the main-round counts for that position only (so a closed revote's result is authoritative, matching plan §6.5's revote flow — "previous main-round votes remain in `votes` for audit but are ignored in the final result"). Tie detection: for single-seat positions, top-2 counts equal; for Committee Member (3 seats), 3rd/4th place counts equal.
- **Known, deliberate scope gap flagged in a code comment:** votes for a **disqualified** contestant are excluded from counting (since `computePositionResults` only receives `status:"approved"` contestants) — this is intentional, disqualification is an EC-integrity action. But the plan's edge-case table also describes a separate **"withdrawn"** status whose votes *should* still count (a voluntary withdrawal, different from EC-initiated disqualification) — that status and its UI action were never built (Nominations tab only has a Disqualify button, no Withdraw). Flagged explicitly in the code so a future slice doesn't assume "withdraw" already works.
- Bar chart rendering reuses the `.ec-bar-*` CSS written in Slice 1 (Flag 16 — no chart library).
- **"Call Revote for {position}"** appears on every position (not just tied ones, per the Q10 decision — manual revote allowed with a required reason, min 10 characters, stored in `electionCycles.revote.reason`). **"Close Revote"** appears in place of it once active. Both call `loadResults()` again afterward to re-render immediately.
- **Publish** button is disabled if any position has an unresolved tie, or if already published. On click: confirms, sets `phase: "published"` + `publishedAt`.
- Every aggregation run also does a best-effort write to `electionStats/{cycleId}` (doc ID **must equal** the cycle ID — enforced by using `_cycle.id` directly, not an auto-generated ID) so the public page never needs to touch the anonymity-protected `votes` collection.

**5. `firestore.rules` — fixed a gap caught before it shipped.**
`electionStats` had no public-read path at all — only `isECChair()||isAdmin()`. Since the public results page is required to read exactly this collection (not raw `votes`, which must stay private for ballot secrecy), this would have silently 403'd the public page the moment Slice 3 tried to use it. Fixed the same way as `contestants`/`electionCycles` in Chapter 8: `get(.../electionCycles/$(id)).data.phase == 'published'`, relying on the doc-ID-equals-cycle-ID convention.

**6. `public/election-results.html` + `public/js/election-results.js` — new public page.**
Copied the `activities.html` boilerplate (nav/hero/footer/`init.js`+`chrome.js`) per Flag 21, and used `firebase-public.js` (not `firebase.js`) for the Firestore import — this is the existing lightweight public-page Firebase init that includes App Check, already used by `activities.js` (Flag 20 — must work unauthenticated). Queries `electionCycles` for `phase == "published"` (takes the most recently published one if there's ever more than one), then reads `contestants` (approved only) + `electionStats/{cycleId}` in parallel, and renders winner cards per position with photo/name/year/department/vote count/percentage/manifesto link — full vote counts are shown per the Q6 decision, not just winner names.

**7. `public/js/chrome.js` — dynamic "Election Results" nav link (Flag 22).**
Added a self-contained IIFE that only runs on pages with a `#navLinks` element, dynamically imports `firebase-public.js`, and runs a single `where("phase","==","published") limit(1)` query. If found, appends an "Election Results" link. **Deviation from the workflow doc's literal Flag 22 suggestion** (a single `getDoc` on a fixed `electionCycles/current` doc) — that assumes a fixed-ID convention this implementation doesn't use (cycles get auto-generated IDs, per plan §3.1's "auto-generated or timestamp-based"). A `where + limit(1)` query is the correct equivalent here; still one lightweight read per page load, so Flag 22's actual concern (query cost) is still satisfied.

**Verification (this chapter):**
- All five touched/new JS files (`ec-chair.js`, `student.js`, `election-results.js`, `chrome.js`) passed `node --input-type=module --check` (or `--check` for the non-module `chrome.js`).
- `firestore.rules` re-verified via `firebase emulators:start --only firestore` reaching "ready" (compiles cleanly) after the `electionStats` fix.
- Live in preview: `/ec-chair.html`, `/student.html` — unauthenticated redirect to `/login.html`, zero console errors. `/election-results.html` — loaded fully unauthenticated (as designed), no script errors; displayed "Could not load results: Missing or insufficient permissions." which is the **expected, gracefully-handled** result of the pre-existing App Check throttling issue (now escalated to a 24h throttle in this dev session from repeated testing — documented in `APPCHECK-RECOVERY-GUIDE.md`, not caused by this session's code). Confirmed the try/catch degrades to a message instead of a crash. `/index.html` — nav-link injection IIFE runs silently with no console errors (its own try/catch swallows the same App Check failure).
- **Not verified live:** the full authenticated ballot flow (submit as student, advance phases as EC Chair, call/close a revote, publish, see it on the public page) — blocked by the same App Check throttle for the rest of this session, and even without that, needs real login sessions this tool doesn't have. This is the largest untested surface of the whole build so far and should be the top priority for the user's next live testing pass, once App Check's throttle window clears (~24h per the console warning) or the recovery guide's fix is applied.

**Next:** User to live-test Slice 3 once App Check's throttle clears — full cycle: Nominations → Campaigning → Voting → Counting → (tie/revote if any) → Published, plus the public results page. Slice 4 (polish: FCM exec-only push, email vote receipt requiring an external Worker update, Overview tab's real student stats + "allow all students" OTP toggle, Excel archive export) remains after that.

---

## Chapter 15 — Slice 4 begins: Overview tab (student stats + Allow-All OTP toggle)

**File changed:** `firestore.rules` — the `settings/{id}` match block was `allow write: if isAdmin();` unconditionally, which would have blocked the EC Chair from ever writing the OTP doc needed for this feature. Fixed to carve out `ecOtp` specifically: `allow write: if id == 'ecOtp' ? (isECChair() || isAdmin()) : isAdmin();`, and correspondingly widened read for that one doc ID. Kept `sysOtp` (Admin's own System-tab unlock) untouched and still admin-only, per Flag 25 — the two OTP flows use separate settings docs so an admin and the EC Chair can each have a live pending code without colliding.

**File changed:** `public/js/ec-chair.js` — implemented the Overview tab in full:
- **Student stats:** total student count + department breakdown (from a one-time `students` collection read), paid-up member count + year-of-study breakdown (cross-referencing confirmed `Membership Dues` payments by `studentUid`). `DEPARTMENTS`/`YEAR_OPTIONS` are local copies, not imported from `admin.js` — `admin.js` calls `protect(["admin"], ...)` at module load time and expects admin-only DOM elements, so importing it into `ec-chair.js` would run that side effect against the wrong page's DOM (same reasoning as Flag 13's "no cross-import from executive.js").
- **"Allow all students to vote" toggle:** turning it OFF is immediate (with a confirm dialog); turning it ON opens an OTP modal (built dynamically, same pattern as the Add-Contestant modal). `findOtpRecipient()` looks for an active executive with `position == "Chairperson"` first, falling back to any `role == "admin"` executive if none is found with an email on file — implements the OTP-fallback decision from the original planning conversation exactly (§3.7 of the workflow doc). The OTP itself mirrors `admin.js`'s `sysOtp` pattern (`sha256Hex`, 10-minute expiry, one-time use) but writes to `settings/ecOtp` and tracks `requestedBy` (the EC Chair's uid) instead of the recipient's uid, since the person entering the code isn't the person who received the email here.
- Wired into the existing `tab-overview` HTML scaffold from Slice 1 (`#ecOverviewStats`, `#allowAllToggle`, `#allowAllStatusText`, `#allowAllMsg`) — no HTML changes needed, that markup was already in place.

**Verification:** `ec-chair.js` syntax-checked (`node --check`), `firestore.rules` re-verified via emulator startup (compiles cleanly after the `settings` rule change), live preview redirect-only check (no login available) shows zero console errors.

**Next:** Continue Slice 4 — contestant edit-after-Campaigning-starts with `editHistory` (Q2 decision), Excel archive export (upgrading Slice 1's soft-only archive), FCM push on phase change (exec-only v1, Q3 decision), and the email vote receipt (client-side call only — needs an external Cloudflare Worker update to actually send, flagged as a deployment dependency per Flag 24).

---

## Chapter 16 — Slice 4: Contestant edit + editHistory (Q2)

**Files changed:** `public/js/ec-chair.js`, `public/js/student.js`.

- **`ec-chair.js`:** Added an always-visible "Edit" button to every roster card (not gated by phase — plan §3.2 allows editing any time, logged either way). Opens a new modal (`ecEditContestantModal`, separate from the Add-Contestant modal since the data model differs — payment vs. existing contestant) pre-filled with the current position/manifesto; photo replacement is optional. Reuses the same live 4th-Year/graduating warning banner logic as Add-Contestant. On save, only the fields that actually changed get written, each pushed into an `editHistory` array via `arrayUnion` with `{field, oldValue, newValue, editedAt, editedBy}` — `editedAt` is a plain client `Date().toISOString()` string, not `serverTimestamp()`, because **Firestore rejects the `serverTimestamp()` sentinel inside array elements** (only allowed as a top-level/nested map field) — caught this before it could throw a runtime error on first use. Also stamps a top-level `updatedAt: serverTimestamp()` on the contestant doc.
- **`student.js`:** Added `wasRecentlyUpdated(c)` — compares `createdAt`/`updatedAt` seconds, flags only if the edit happened more than 5 minutes after creation (plan §3.2's exact threshold, so an edit made moments into initial setup doesn't confusingly show "Updated" to students). Both the single-select and Committee Member contestant cards now show "· Updated" in the meta line when true.

**Verification:** Both files syntax-checked (`node --check`), live preview redirect-only check on `/ec-chair.html` — zero console errors. The `arrayUnion`-with-`serverTimestamp()` incompatibility was caught by reasoning through Firestore's documented sentinel-value restrictions during writing, not by a failed test run (no live authenticated session available to actually trigger the write and confirm) — worth double-checking on the first real edit during live testing.

**Next:** Excel archive export (upgrade Slice 1's soft-only archive in `admin.js` to produce a real `.xlsx`, reusing the existing `buildArchiveWorkbook`-style pattern and the `XLSX` global already loaded on `admin.html`), then FCM push on phase change (exec-only v1) and the email vote receipt (external Worker dependency, Flag 24).

---

## Chapter 17 — Slice 4: Excel archive export

**File changed:** `public/js/admin.js`. Upgraded the Slice 1 "soft archive only" placeholder (Chapter 9) to a real export, mirroring the existing `buildArchiveWorkbook()` pattern used by the year-end financial reset (same `window.XLSX` global already loaded on `admin.html` — Flag 4, no second import).

- `buildElectionArchiveWorkbook(cycle, contestants, ecPayments, positionResults)` — 4 sheets: Summary (cycle name, counts), Contestants (position/name/comp#/dept/year/status/manifesto), EC Payments (fee submissions with status), Results (per-position, per-contestant vote counts with a Winner column, sourced from `electionStats.positionResults` written by the Results tab).
- Archive button handler now: loads `contestants` + `ecPayments` (both `where cycleId==`) + `electionStats/{cycleId}` in parallel → builds the workbook → uploads to Cloudflare via the existing `uploadArchive()` helper → writes an `electionArchives/{cycleId}` doc (summary + `archiveUrl`) → **then** does the same soft `status:"archived"` flip as before. Explicitly does **not** delete `contestants`/`ecPayments`/`votes` — this must never behave like the year-end financial reset, which does delete records and proof files (Flag 5, re-confirmed here since this was the exact risk the plan called out).

**Verification:** `admin.js` syntax-checked (`node --check`), live preview redirect-only check on `/admin.html` — zero console errors. Not verified against a real cycle with data (needs a login session + an actual published cycle to archive) — the workbook-building logic was reviewed by hand against the `electionStats.positionResults` shape written in Chapter 14 to make sure field names line up (`r.contestants`, `r.winner` as array-or-string) before trusting it.

**Next:** FCM push on phase change (exec-only broadcast for v1, per the Q3 decision — not a mass student broadcast, which risks Worker rate limits per Flag 23) and the email vote receipt (client-side call only; needs an external Cloudflare Worker update to actually deliver, flagged as a deployment dependency per Flag 24 — cannot be fully implemented or tested from this repo alone).

---

## Chapter 18 — Slice 4: FCM push on phase change (exec-only v1)

**Discovered gap:** `fcm.js`'s `registerFCMToken()` was only ever called from `student.js`. Executive/EC Chair/Admin accounts never registered a device token, so sending them a push would silently do nothing — the feature would look "built" but never actually fire. Fixed by adding the same one-line `registerFCMToken(user.uid, profile.__collection || "executives")` call to `executive.js`, `admin.js`, and `ec-chair.js`'s bootstraps (mirroring `student.js`'s existing call exactly).

**File changed:** `public/js/ec-chair.js` — after a successful phase advance (Dashboard's "Advance to {phase}" button), calls `notifyExecsOfPhaseChange(next)`: queries all `active == true` executives, and for each with an `fcmToken` on file, sends a push via the existing `sendPush()` from `fcm.js` (already-deployed `/push` Worker endpoint — **not** a new external dependency, unlike the email receipt below). Deliberately **not** a mass broadcast to students, per the Q3/Flag 23 decision (500 individual Worker calls in a loop was explicitly flagged as a v2 concern) — only active executives get notified.

**Files changed:** `public/js/executive.js`, `public/js/admin.js` — added `registerFCMToken` import + bootstrap call, each with a one-line comment explaining why (so a future session doesn't wonder why exec accounts suddenly register push tokens).

**Verification:** All three files syntax-checked (`node --check`), live preview redirect-only check on `/executive.html` — zero console errors. **Not verified**: actual push delivery, which requires a real device/browser with notification permission granted and a live phase-advance action — neither is available in this tool session.

---

## Chapter 19 — Slice 4: Email vote receipt (external dependency, Flag 24)

**File changed:** `public/js/student.js` — after a **main-round** vote submit succeeds (not revote — the plan's receipt design is for the main round only), fires `sendVoteReceiptEmail(receiptToken, positionsToSubmit)`: a best-effort `POST` to the existing `UPLOAD_WORKER_URL + "/email"` endpoint with a **new** `type: "vote_receipt"`, matching the exact call pattern already used elsewhere (`admin.js`'s OTP email, `industrial-secretary.js`'s letter emails) — including `authHeaders()`, which I initially forgot and then added after checking that every other `/email` call site in this codebase includes it.

**This is a genuine, unavoidable external dependency (Flag 24) — flagged explicitly in a code comment, not just here:** the Cloudflare Worker that backs `/email` lives **outside this repository** and does not currently have a handler for `type: "vote_receipt"`. Until someone with Worker access adds that handler (reading `to`/`receiptToken`/`positions` from the request body and sending an email via whatever provider the Worker uses for the other email types), this call will silently fail — which is fine, because it's wrapped in try/catch and never blocks the vote confirmation UI (the vote is already recorded in Firestore before this fires). **This cannot be completed or tested from this repo alone.**

**Verification:** `student.js` syntax-checked (`node --check`), live preview check — zero console errors. Actual delivery is untestable without Worker-side access, which this session doesn't have.

---

## Slice 4 status: essentially complete

All of Slice 4's planned items are now built:
- ✅ Overview tab — real student/department/year stats, "Allow all students to vote" OTP toggle with Chairperson→Admin fallback (Chapter 15)
- ✅ Contestant edit with `editHistory` + student-facing "Updated" label (Chapter 16)
- ✅ Excel archive export, uploaded to Cloudflare, `electionArchives` doc, original data preserved (Chapter 17)
- ✅ FCM push on phase change, exec-only v1 (Chapter 18)
- ⚠️ Email vote receipt — client-side implemented, but **cannot function until the external Worker is updated** (Chapter 19) — this is a hard external blocker, not a bug in this repo

**What remains untested end-to-end across the whole build:** the full authenticated flow (student votes, EC Chair approves/adds contestants/advances phases/calls revotes/publishes, admin creates/archives cycles) has never been exercised live in this tool session beyond the Slice 1/2 confirmations the user already ran locally. The App Check throttle (Chapter 13/14) blocked further live testing from this side for most of Slices 3–4. **Recommended next step:** a full live walkthrough of one complete election cycle, ideally once the App Check throttle clears or its underlying issue is fixed (see `APPCHECK-RECOVERY-GUIDE.md`).

**Next:** Await user decision — live-test the full build, or commit/push/deploy first and test against production.

---

## Chapter 20 — Commit, push, and deploy (Slices 2–4)

User confirmed the rules gap (Chapter 14's `electionStats` fix and Chapter 15's `settings/ecOtp` fix, both written after the Chapter 10 deploy, never made it to the live Firestore) needed fixing before local testing of the Allow-All OTP toggle and Results/public-page reads would work — since local dev still points at the real cloud project.

**Actions:**
1. Committed all of Slices 2–4 (`546a921`) — student ballot, EC Chair Nominations/Results/Overview tabs, public results page, Excel archive export, FCM push, email receipt, plus this session report.
2. Pushed to `origin/main` (`16bb8f3..546a921`).
3. Ran `npx firebase deploy --only hosting,firestore:rules` — rules compiled and released, hosting uploaded (57 files) and released. Live at https://uzes-friendly-web.web.app.

**Current state:** All rules changes from this entire session (Chapters 8, 14, 15) are now live. The user can test the full build — nomination pipeline (already confirmed working earlier), student ballot, phase transitions, revote, publish, public results page, Overview stats + Allow-All OTP toggle, contestant edit, Excel export — against localhost, which reads/writes the same now-updated cloud Firestore.

**Known remaining gaps (not fixable from this repo / deliberately descoped, not bugs):**
- Email vote receipt won't actually send until the external Cloudflare Worker adds a `vote_receipt` handler (Flag 24).
- "Withdraw" contestant status (votes still count) was never built — only "Disqualify" (votes excluded) exists.
- Mass FCM push to all students on phase change was deliberately descoped to v2; only executives get notified in v1.
- App Check throttle (Chapters 13–14) prevented this session from live-verifying the authenticated flows itself — the user's own local testing is the first real end-to-end validation of Slices 3–4.

**Next:** User to run a full live test locally now that rules are deployed. Report back any issues for fixes.

---

## Chapter 21 — Bug found & fixed: "blank receipt" on the Allow-All OTP email

**User report:** Testing the "Allow all students to vote" OTP toggle, the email that arrived was a blank receipt instead of a one-time code.

**Root cause (confirmed by reading the actual email pipeline):** Earlier session chapters (13, 19) assumed the Cloudflare Worker's email-sending logic lived entirely outside this repo and was untouchable — **that assumption was wrong.** The repo actually contains **both** pieces:
- `workers/upload-worker/index.js` — the Worker's `/email` endpoint just forwards the payload verbatim to a Google Apps Script Web App (`env.EMAIL_RELAY_URL`), adding the shared secret. It does no template logic itself.
- `apps-script/email-relay.gs` — **this** is where email content is actually built, dispatched by `data.type` in `doPost()`. It only had cases for `attachment_letter`, `attachment_rejection`, `placement_letter`, `admin_otp`, and `reject` — everything else fell into a final, unconditional `else` branch that calls `buildReceiptPdf(data)` + `sendReceiptEmail(data, pdf)`, the **payment-receipt** template. My two new types from this session, `ec_allow_all_otp` (Chapter 15) and `vote_receipt` (Chapter 19), were never added as explicit cases — so both were silently misrouted into the payment-receipt builder, which expects fields like `receiptNo`/`category`/`amount` that don't exist in an OTP or vote-receipt payload. That's exactly the "blank receipt" — the payment PDF template rendering with none of its expected data.

**Fix — `apps-script/email-relay.gs`:**
- Added two explicit `doPost()` routing cases: `ec_allow_all_otp` → `sendEcAllowAllOtpEmail(data)`, `vote_receipt` → `sendVoteReceiptEmail(data)`.
- `sendEcAllowAllOtpEmail(d)` — new function, mirrors the existing `sendAdminOtpEmail(d)` pattern exactly (same 10-minute-expiry code display), but explains what's being confirmed and includes the cycle name if provided.
- `sendVoteReceiptEmail(d)` — new function, sends the receipt token + list of positions voted (never the chosen candidates), matching the plan's Q4 anonymity requirement.

**Fix — `public/js/ec-chair.js`:** added `cycleName: _cycle?.name || ""` to the OTP request payload so the new email template has something to reference (was missing before, would have rendered as a blank string but not broken anything — a smaller gap caught in the same pass).

**⚠️ This requires manual action from the user — this is NOT auto-deployed:** unlike `firestore.rules`/hosting, this repo has **no CLI/clasp pipeline for Apps Script** (confirmed: no `.clasp.json`, `npx clasp` isn't installed). Editing `apps-script/email-relay.gs` in this repo only updates the local backup copy — **the live Google Apps Script Web App deployment is a separate thing that must be updated by hand**:
1. Open the Apps Script project in the Google account that owns the deployment (`uzesofficial@gmail.com`, per the file header comment).
2. Replace the script content with the updated `apps-script/email-relay.gs` (or paste in just the new/changed functions + the two new `doPost` cases).
3. **Deploy → Manage deployments → Edit → New version** (editing the script alone does not update a live Web App deployment; a new version must be published, or the existing "Anyone" Web App deployment must be redeployed at its current URL — if a *new* URL is generated, `EMAIL_RELAY_URL` in the Worker's environment must be updated to match, otherwise everything breaks, not just elections).

**Verification:** Syntax-checked `email-relay.gs` (`node --check` via stdin, since `.gs` isn't a recognized extension for path-based checks) — no errors. `ec-chair.js` re-checked, live preview redirect-only check — zero console errors. **Not verified:** actual email delivery/content — requires the user to manually redeploy the Apps Script (above) and then retest the OTP flow.

**Also re-flags:** this same misrouting bug logic means the vote-receipt email (Chapter 19) had the identical "blank receipt" problem and is fixed by the same deployment step — no separate fix needed, but worth testing both in the same pass once redeployed.

**Next:** User must manually redeploy `apps-script/email-relay.gs` to Google Apps Script (steps above), then retest both the Allow-All OTP email and the vote-receipt email.

---

## Chapter 22 — Commit, push, deploy (email-routing fix)

- Committed (`7956a73`) and pushed (`546a921..7956a73`) — `apps-script/email-relay.gs` fix, `ec-chair.js` cycleName addition.
- Ran `npx firebase deploy --only hosting` (no `firestore.rules` changes this round, so hosting-only) — released successfully, live at https://uzes-friendly-web.web.app.
- **Still outstanding, user action required:** the Apps Script itself is not deployed by `firebase deploy` — it needs the manual copy-paste + "New version" redeploy described in Chapter 21 before the OTP/vote-receipt emails will actually render correctly. This is the one remaining manual step blocking full email verification.

**Next:** User to manually redeploy the Apps Script, then retest the full flow end-to-end (OTP email content, vote receipt email content, and everything else in Slices 1–4).

---

## Chapter 23 — Two more bugs found and fixed live

**User report 1:** Apps Script redeployed — OTP email and vote-receipt email now both work correctly (confirms Chapter 21's fix was correct and the manual redeploy step worked).

**User report 2 — Allow-All toggle reverts after refresh:** The OTP flow completed successfully and the toggle showed ON, but refreshing the page showed OFF again. User also asked that turning it back OFF should require OTP too (previously only ON did; OFF just used a plain `confirm()`).

**Root cause investigation:** Reasoned through the rules (`isECChair()`, `electionCycles` update) and found no typo or logic error — the update *should* be permitted. Given the exact symptom (UI shows success immediately, but the server's true state reverts on the next fresh read), the most likely explanation is that Firestore's `updateDoc()` can resolve its promise from a local optimistic write before/without the server actually accepting it, so a rules rejection or other server-side failure can happen invisibly after the UI has already declared success. Rather than keep guessing without live access, fixed this at the root by adding a **post-write verification read-back**: after the OTP-confirmed `updateDoc`, immediately re-`getDoc` the same document and confirm the field actually matches what was just written, throwing a visible error in the modal if it doesn't. This turns any future silent failure (rules rejection, network issue, race condition) into an immediate, visible error instead of a delayed, confusing one.

**File changed:** `public/js/ec-chair.js`:
- `wireAllowAllToggle()`'s change handler now **always** opens the OTP modal regardless of direction (`target = toggle.checked`), immediately snapping the visual toggle back to the last-confirmed server state so it only actually flips once OTP verification succeeds — matching the user's explicit request that OFF requires OTP too, same as ON.
- `openAllowAllOtpModal(target)` now takes the intended direction, adjusts the modal title/intro text accordingly ("Allow all students to vote" vs. "Restrict voting to paid-up members"), and includes it in the emailed OTP payload as both `target` (stored in the `settings/ecOtp` doc for `handleVerify` to read back) and a human-readable `action` string (for the email template).
- `handleVerify()` now writes `allowAllStudents: data.target` (not a hardcoded `true`), and immediately re-reads the document to confirm the write stuck before updating the local UI — the fix described above.

**File changed:** `apps-script/email-relay.gs` — `sendEcAllowAllOtpEmail(d)` now reads `d.action` to describe which direction is being confirmed in both the email body and subject line, instead of always saying "allow all students to vote" regardless of direction. **This also needs the manual Apps Script redeploy step** (same as Chapter 21) before it takes effect live.

**User report 3 — Archive Election crash:** `Cannot read properties of undefined (reading 'utils')` when clicking Archive in Admin.

**Root cause found and independently confirmed:** `window.XLSX` was undefined at the point `buildElectionArchiveWorkbook`/`buildArchiveWorkbook` ran `XLSX.utils.book_new()`. Checked whether the SheetJS CDN script was even loading — network logs showed a 200 response, but `window.XLSX` still came back `undefined` afterward, which is the classic signature of a **Subresource Integrity (SRI) hash mismatch**: the browser fetches the file successfully but silently refuses to *execute* it because the `integrity` attribute doesn't match the file's actual hash. Verified this directly (not just inferred) by downloading the exact CDN file (`curl`) and computing its SHA-384 hash myself: the real hash is `vtjasyidUo0kW94K5MXDXntzOJpQgBKXmE7e2Ga4LG0skTTLeBi97eFAXsqewJjw` — completely different from the `OLBgp1Gs...` hash that had been pinned in `admin.html` since before this session (a pre-existing bug, not something introduced this session — the Electoral Commission archive feature was just the first thing to actually exercise this code path).

**File changed:** `public/admin.html` — corrected the `integrity` attribute on the SheetJS `<script>` tag to the verified real hash.

**File changed:** `public/js/admin.js` — added an explicit `if (!XLSX) throw new Error(...)` guard at the top of both `buildArchiveWorkbook()` and `buildElectionArchiveWorkbook()`, with a clear, actionable message ("check your internet connection or ad-blocker, then refresh"). This means if the CDN or an SRI hash ever breaks again for any reason, the failure surfaces as a readable message instead of a cryptic `TypeError`.

**Verification note — a real limitation encountered while testing this:** Tried to verify the hash fix live in preview, but `admin.html` redirects unauthenticated visitors to `login.html` almost instantly (via `guard.js`), so checking `window.XLSX` after navigating there was actually checking `login.html` (which has no XLSX script at all) both before and after the fix — a flawed test methodology on my part, caught before drawing a wrong conclusion from it. The hash correctness itself is independently verified via direct `openssl` hash computation, which doesn't depend on live browser testing at all — that part is solid regardless. Full end-to-end confirmation (clicking Archive and getting a real file) still needs the user's own login session.

**Next:** User to redeploy the updated Apps Script (email wording fix), then retest: (1) Allow-All toggle in both directions, confirming OTP is required each way and the state survives a refresh; (2) Archive Election in Admin, confirming the Excel file downloads correctly.
