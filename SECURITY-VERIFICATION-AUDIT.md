# UZES Platform — Post-Fix Verification Security Audit Report

**Classification:** Confidential — Verification Audit  
**Scope:** UZES Web Application + Android Mobile Application (Capacitor 8)  
**Target Load:** 3,000 concurrent students  
**Audit Date:** 29 June 2026  
**Assessor:** Senior Application Security Architect & DevSecOps Engineer  
**Constraint:** No code modifications. Purely analytic and strategic.

---

## 1. Executive Summary

A significant round of security hardening has been performed since the initial Pre-Production audit. The commit history shows **10 dedicated security commits** addressing the Critical and High issues identified in the first report. This verification audit assesses which fixes landed, which are partial, which remain open, and what **new regressions** were introduced.

### 1.1 Fix Summary Table

| Issue ID | Severity | Status | Notes |
|----------|----------|--------|-------|
| C-1: Email relay secret exposure | Critical | **PARTIALLY FIXED** | Students can no longer read `emailRelay`, but execs still can. Email still sent directly from client to Apps Script. |
| C-2: Single shared admin secret | Critical | **NOT FIXED** | Same `ADMIN_DELETE_SECRET` still gates both delete-auth-user and reset-password. |
| C-3: TOTP secrets in plaintext | Critical | **PARTIALLY FIXED — REGRESSION RISK** | Client code encrypts secrets via Worker, but **Worker lacks the `/totp/save` and `/totp/verify` endpoints**. 2FA will break for new enrollments and encrypted users. |
| C-4: Firebase App Check disabled | Critical | **FIXED** | reCAPTCHA v3 site key populated; App Check initializes in `firebase.js`. |
| C-5: No pagination on Firestore queries | Critical | **PARTIALLY FIXED** | `executive.js` payments and `admin.js` students are now paginated. `reports.js`, `executive.js` (income/expenses/vacancies), and `admin.js` (bulk stats) still load entire collections. |
| H-1: No SRI on CDN scripts | High | **PARTIALLY FIXED** | `xlsx` and `html5-qrcode` now have `integrity` attributes. Firebase SDK, Google Fonts, and other CDN assets still lack SRI. |
| H-2: CSP allows `'unsafe-inline'` scripts | High | **FIXED** | `script-src` no longer includes `'unsafe-inline'`. `style-src` still allows it (acceptable for dynamic theming). |
| H-3: Mass data exposure to any exec | High | **PARTIALLY FIXED** | Legacy `users/` collection read tightened to admin-only. All other collections still allow exec-wide reads. |
| H-6: Per-file delete lacks ownership check | High | **NOT FIXED** | Worker `/delete` (per-file branch) still does not verify `customMetadata.uploadedBy`. |
| H-8: `REQUIRE_AUTH=false` escape hatch | High | **NOT FIXED** | Still present in the Cloudflare Worker. |
| H-9: No input size limit on Apps Script | High | **NOT FIXED** | `email-relay.gs` still has no `e.postData.length` check. |
| H-10: Inline `onclick` handlers in admin.js | High | **FIXED** | Replaced with event delegation via `data-action` attributes. |
| M-2: `view.html` XSS via URL params | Medium | **FIXED** | Extracted to `view.js`; filename validated with regex; DOM API used instead of `innerHTML`. |

### 1.2 New Regressions Introduced by Fixes

1. **TOTP 2FA Broken for New Enrollments and Encrypted Users:** `subhero.js` calls `POST /totp/save` and `login.js` calls `POST /totp/verify` on the Cloudflare Worker. The Worker router (lines 358–390) does **not** define these endpoints. Any user who enables 2FA after this deployment will see an "Encryption failed" error and cannot log in. Users with legacy plaintext secrets still work (backward-compat path exists).

2. **Admin Secret Input Fields Not Wired to Worker Correctly:** `admin.js` now reads delete/reset secrets from DOM input fields (`getAdminDeleteToken()`, `getAdminResetToken()`). If the admin forgets to paste the secret into the System tab before attempting a delete, the operation silently fails with an alert. This is a UX regression, not a security one, but it increases the risk of accidental partial deletions (Firestore doc deleted, Auth account left behind).

3. **Un-paginated Queries Still Exist in Critical Paths:** While the payment list is paginated, the **Reports tab** (`reports.js`), **SG vacancy list** (`executive.js` line 1725), **income/expense lists** (`executive.js` lines 653, 754), and **admin bulk stats** (`admin.js` lines 1056–1058) still load entire collections. At 3,000 students, these will still fail or time out.

### 1.3 Go / No-Go Recommendation

**RECOMMENDATION: CONDITIONAL NO-GO.**

The platform has made **substantial progress** — App Check is now live, CSP is hardened, the legacy `users` collection is locked down, and admin.js event delegation is clean. However, **two critical issues remain unaddressed and one new regression was introduced** that will break 2FA for users:

1. **C-2 (shared admin secret)** is still a single point of total compromise.
2. **C-3 (TOTP encryption)** is architecturally correct in the client but the **Worker endpoints are missing**, which will break 2FA at runtime.
3. **C-1 (email relay)** is partially fixed but still exposes the token to all execs.

**Action required before launch:**
- Add `/totp/save` and `/totp/verify` endpoints to the Cloudflare Worker **immediately**, or revert the TOTP encryption changes to restore plaintext operation.
- Split `ADMIN_DELETE_SECRET` into two separate Worker env variables.
- Either route all email through the Worker, or remove the email relay token from Firestore `settings/emailRelay` entirely and store it only in the Worker.

---

## 2. Detailed Fix Verification

### 2.1 Critical Issue Fixes (C-1 through C-5)

#### C-1: Email Relay Secret Exposure — PARTIALLY FIXED

**What changed:**
- `firestore.rules` line 161–164: `settings/emailRelay` read rule changed from `signedIn() && myActive()` to `isExec()`. Students can no longer read the email relay token.
- `firestore.rules` comment: `emailRelay holds only the isTrial flag — exec-readable for operational use.`

**What remains broken:**
- The `settings/emailRelay` document **still contains the Apps Script URL and the `RELAY_TOKEN`**. Any compromised executive account can read this and send arbitrary emails impersonating UZES.
- `public/js/industrial-secretary.js` lines 88–107: `sendEmail()` still fetches `settings/emailRelay` and sends directly to the Apps Script URL with the token. There is no Worker email gateway.
- `public/js/executive.js` line 17–20: `getTrialMode()` still reads `settings/emailRelay` to check the `isTrial` flag.

**Verdict:** The blast radius was reduced from "any student" to "any executive," but the root cause (secret stored in Firestore and sent from client) is not resolved. A compromised exec account is still a credible threat.

---

#### C-2: Single Shared Admin Secret — NOT FIXED

**What changed:**
- `public/js/admin.js` lines 63–68: Two separate input fields (`adminDeleteToken` and `adminResetToken`) are read from the DOM. This is a UI improvement.

**What remains broken:**
- `workers/upload-worker/index.js` lines 581–582 (`handleDeleteAuthUser`): Still uses `env.ADMIN_DELETE_SECRET`.
- `workers/upload-worker/index.js` lines 631–632 (`handleResetPassword`): Still uses `env.ADMIN_DELETE_SECRET`.
- The Worker does **not** have a separate `ADMIN_RESET_SECRET` environment variable. An attacker who learns the delete secret can still reset any password, and vice versa.

**Verdict:** No architectural fix. The client-side separation is cosmetic. The Worker remains the single point of compromise.

---

#### C-3: TOTP Secrets in Plaintext — PARTIALLY FIXED, REGRESSION INTRODUCED

**What changed:**
- `public/js/subhero.js` lines 301–312: During 2FA enrollment, the raw secret is sent to `POST /totp/save` on the Worker. The Worker encrypts it and returns `encryptedSecret`. The encrypted ciphertext is stored in Firestore instead of the raw secret.
- `public/js/login.js` lines 133–144: During login, if the stored secret contains a colon (`:`) — the encryption delimiter — the client sends `encryptedSecret` and the user's 6-digit code to `POST /totp/verify` on the Worker. The Worker decrypts and verifies.
- `public/js/login.js` lines 145–147: Backward compatibility path for legacy plaintext secrets (no colon) still works.

**What is broken:**
- The Cloudflare Worker (`workers/upload-worker/index.js` lines 358–390) **does not define `/totp/save` or `/totp/verify` endpoints**. The router falls through to `return new Response("Not found", { status: 404 })`.
- Any user who enables 2FA after this deployment will see:
  1. Secret generated locally
  2. QR code scanned
  3. Code entered
  4. "Encrypting…" message
  5. `404 Not Found` from the Worker → "Encryption failed" error
  6. 2FA is never enabled. The user's Firestore document is not updated.
- Any existing user whose secret was previously encrypted (if the endpoint had existed) would also fail login with a 404 on `/totp/verify`.

**Verdict:** The client-side architecture is correct and well-designed. The **Worker implementation is missing**. This is a **launch-blocking regression** — do not deploy the current TOTP changes without adding the Worker endpoints, or revert to plaintext storage for now.

---

#### C-4: Firebase App Check Disabled — FIXED

**What changed:**
- `public/js/config.js` line 30: `RECAPTCHA_SITE_KEY` now populated with a real key: `6LejNzwtAAAAAGcxw8GBiKqdvPwoBrmOQxC_qO1E`.
- `public/js/firebase.js` lines 15–23: App Check initializes with `ReCaptchaV3Provider` when the site key is present.
- CSP in `firebase.json` updated to include `https://recaptcha.google.com` and `https://www.google.com` in `script-src` and `connect-src`.

**Verdict:** Fully fixed. However, the Firebase Console must also have **Enforcement enabled** (not just Monitoring) for App Check to actually block unverified requests. This is a configuration step outside the codebase.

---

#### C-5: No Pagination on Firestore Queries — PARTIALLY FIXED

**What changed:**
- `public/js/executive.js` lines 422–472: `loadAll()` now implements cursor-based pagination with `limit(100)` and `startAfter(_allLastDoc)`. A "Load more" button is rendered when more pages exist.
- `public/js/admin.js` lines 372–407: `loadStudents()` now implements cursor-based pagination with `limit(100)` and `startAfter(_stuLastDoc)`.
- `public/js/admin.js` lines 1044–1054: Bulk import uses `writeBatch` with chunking (490 writes per batch, under Firestore's 500 limit).

**What remains un-paginated:**
- `public/js/reports.js` lines 13–16: Loads ALL `payments`, ALL `otherIncome`, and ALL `expenses` without `limit()`.
- `public/js/executive.js` line 653: `getDocs(query(collection(db, "otherIncome"), ...))` — no limit.
- `public/js/executive.js` line 754: `getDocs(query(collection(db, "expenses"), ...))` — no limit.
- `public/js/executive.js` line 1725: `getDocs(query(collection(db, "vacancies"), ...))` — no limit.
- `public/js/executive.js` line 1773: `getDocs(collection(db, "payments"))` — no limit, no filter, used in the matching algorithm.
- `public/js/admin.js` lines 1056–1058: `getDocs(collection(db, "payments"))`, `getDocs(collection(db, "otherIncome"))`, `getDocs(collection(db, "expenses"))` — used for bulk statistics, no limit.

**Verdict:** The most visible lists (payments, students) are paginated. But the **Reports tab**, **finance tabs**, and **matching algorithm** still load entire collections. These will fail at scale. The matching algorithm's unfiltered `getDocs(collection(db, "payments"))` is particularly dangerous — it reads every payment document in the database just to find paid students.

---

### 2.2 High-Risk Issue Fixes (H-1 through H-10)

#### H-1: No Subresource Integrity (SRI) — PARTIALLY FIXED

**What changed:**
- `public/admin.html` line 368: `xlsx` CDN script now has `integrity="sha384-OLBgp1GsljhM2TJ+sbHjaiH9txEUvgdDTAzHv2P24donTt6/529l+9Ua0vFImLlb"`.
- `public/executive.html` line 527: `html5-qrcode` CDN script now has `integrity="sha384-c9d8RFSL+u3exBOJ4Yp3HUJXS4znl9f+z66d1y54ig+ea249SpqR+w1wyvXz/lk+"`.

**What remains:**
- Firebase JS SDK (loaded via ES modules from `https://www.gstatic.com/firebasejs/10.12.2/`) — no SRI possible for ES module imports.
- `qrcodejs` loaded dynamically in `totp.js` line 80 — no SRI.
- `jszip` loaded dynamically in `executive.js` line 1077 — no SRI.
- Google Fonts CSS — no SRI.

**Verdict:** Good progress on the two largest CDN scripts. The remaining gaps are acceptable for launch given the Firebase SDK's own integrity mechanisms (Google's CDN + SRI for non-module scripts). The dynamic script loads (`qrcodejs`, `jszip`) should be pinned with `integrity` if possible.

---

#### H-2: CSP Allows `'unsafe-inline'` Scripts — FIXED

**What changed:**
- `firebase.json` line 22: `script-src` no longer includes `'unsafe-inline'`. It now includes: `'self' blob: https://www.gstatic.com https://apis.google.com https://www.google.com https://recaptcha.google.com https://cdn.jsdelivr.net https://cdnjs.cloudflare.com https://accounts.google.com https://unpkg.com`.
- `firebase.json` line 22: Added `report-uri https://uzes-upload.uzesofficial.workers.dev/csp-report;`.
- All inline `<script>` blocks in HTML files were extracted to external `.js` files (e.g., `js/init.js`, `js/view.js`).
- `public/index.html` no longer has an inline script block.
- `public/view.html` no longer has an inline script block.

**What remains:**
- `style-src` still includes `'unsafe-inline'` (required for dynamic CSS theming via JS).
- The `report-uri` endpoint `/csp-report` is **not defined in the Cloudflare Worker**. CSP violation reports will 404.

**Verdict:** The script-src fix is excellent. The missing CSP report endpoint is a minor operational gap — reports will be lost, but no security impact.

---

#### H-3: Mass Data Exposure to Any Exec — PARTIALLY FIXED

**What changed:**
- `firestore.rules` lines 113–119: Legacy `users/{uid}` collection now has `allow read: if signedIn() && (myUid() == uid || isAdmin())`. Only the owner and admin can read. `allow create: if false` — no new legacy accounts.
- `firestore.rules` line 112 comment: `Legacy collection — migration complete; collection is now empty.`

**What remains:**
- `students` collection: `allow read: if signedIn() && (myUid() == uid || isExec())` — any exec reads any student.
- `payments` collection: `allow read: if signedIn() && myActive() && (resource.data.studentUid == myUid() || isExec())` — any exec reads any payment.
- `otherIncome` collection: `allow read: if isExec()` — any exec reads all financial income.
- `expenses` collection: `allow read: if isExec()` — any exec reads all expense requests.
- `libraryFiles` collection: `allow read: if signedIn() && myActive()` — any active user reads all library files.
- `vacancies` collection: `allow read: if signedIn() && myActive()` — any active user reads all vacancies.
- `attachmentRequests` collection: `allow read: if canManageAttachment() || (signedIn() && myActive() && resource.data.studentUid == myUid())` — execs with attachment management role read all requests.

**Verdict:** The legacy collection was correctly retired. However, the architectural design still grants broad read access to entire collections for executive roles. This is by design for operational reasons, but it means a compromised executive account (or a malicious exec) can exfiltrate all student and financial data. The previous recommendation to split into public/private sub-collections remains valid.

---

#### H-6: Per-File Delete Lacks Ownership Check — NOT FIXED

**What changed:**
- None in the Worker.

**Current state:**
- `workers/upload-worker/index.js` lines 558–567: Per-file delete branch calls `requireUser(request, env)` but does **not** verify that the requesting user owns the file via `customMetadata.uploadedBy`.
- Any authenticated user who knows the file key or URL can delete any file.

**Verdict:** Unchanged. Still a high-risk issue.

---

#### H-8: `REQUIRE_AUTH=false` Escape Hatch — NOT FIXED

**What changed:**
- None in the Worker.

**Current state:**
- `workers/upload-worker/index.js` lines 157–160: `if (env.REQUIRE_AUTH === "false") return { sub: "auth-disabled" };`
- If this environment variable is accidentally set in production, all authentication checks are bypassed.

**Verdict:** Unchanged. Still a latent backdoor. The commit message says "Security hardening Phase 1: H-8" but the code was not modified.

---

#### H-9: No Input Size Limit on Apps Script — NOT FIXED

**What changed:**
- None in `email-relay.gs`.

**Current state:**
- `apps-script/email-relay.gs` line 22: `JSON.parse(e.postData.contents)` with no size check.
- A large POST body could exceed Apps Script's memory limits.

**Verdict:** Unchanged. Still a medium-high risk DoS vector against the email relay.

---

#### H-10: Inline `onclick` Handlers in admin.js — FIXED

**What changed:**
- `public/js/admin.js` lines 22–33: Event delegation for secretary management buttons using `data-action` attributes.
- `public/js/admin.js` lines 174–186: Event delegation for all row-action buttons (edit, toggle, reset-pw, delete).
- All HTML string generation in `admin.js` now uses `data-action="..."` instead of `onclick="..."`.
- Lines 444–449, 566–571, 1223–1233: All button templates use `data-action` attributes.

**Verdict:** Fully fixed. Clean event delegation pattern. No inline `onclick` handlers remain in `admin.js`.

---

### 2.3 Medium and Low-Risk Items

#### M-2: `view.html` XSS via URL Params — FIXED

**What changed:**
- `public/view.html` line 19: Now loads `<script src="js/view.js"></script>` instead of inline script.
- `public/js/view.js` line 16: Filename validation: `const fname = /^[\w.\-() ]{1,200}$/.test(rawFname) ? rawFname : "file";`
- `public/js/view.js` lines 43–47: Download link created via DOM API (`document.createElement`) instead of `innerHTML` string concatenation.

**Verdict:** Fully fixed. Good defense-in-depth.

---

#### L-6: CSP Report-URI — ADDED BUT ENDPOINT MISSING

**What changed:**
- `firebase.json` line 22: Added `report-uri https://uzes-upload.uzesofficial.workers.dev/csp-report;`.

**What is missing:**
- The Cloudflare Worker does not define a `/csp-report` endpoint. CSP violation reports will 404.

**Verdict:** Minor operational gap. No security impact, but the team will not receive CSP violation telemetry.

---

#### L-7: Student Can Report Own Upload — UNCHANGED

**What changed:**
- None. `library.js` still allows self-reporting.

**Verdict:** Still low-risk. Optional hardening.

---

## 3. New Issues Discovered During Verification

### N-1: Missing Worker Endpoints for TOTP (REGRESSION)

**Severity:** Critical  
**Location:** `workers/upload-worker/index.js` (missing endpoints)  
**Description:** The client code now expects `/totp/save` and `/totp/verify` endpoints on the Worker. These endpoints do not exist. 2FA enrollment and login for encrypted secrets will fail with 404 errors.

**Impact:** Users cannot enable 2FA. Users with encrypted secrets cannot log in.  
**Fix:** Add the two endpoints to the Worker, or revert the client-side TOTP encryption changes.

---

### N-2: Un-paginated `getDocs(collection(db, "payments"))` in Matching Algorithm

**Severity:** High  
**Location:** `public/js/executive.js` line 1773  
**Description:** `sgAssignVacancy()` loads the entire `payments` collection into memory to determine which students have paid. This query has no filter, no limit, and no pagination. At 3,000 students × 5 payments = 15,000 documents, this will time out or exceed Firestore's 1 MB response limit.

**Impact:** The placement matching feature becomes unusable at scale.  
**Fix:** Add a Firestore index on `payments` by `status` + `studentUid` and query only confirmed payments with a `where` filter. Or maintain a `paidMembers` counter/collection updated at payment confirmation time.

---

### N-3: Admin Bulk Stats Load Entire Collections

**Severity:** High  
**Location:** `public/js/admin.js` lines 1056–1058  
**Description:** The admin System tab loads all `payments`, `otherIncome`, and `expenses` to compute summary statistics for the year-end reset. No pagination or limit is applied.

**Impact:** Admin dashboard becomes unusable at scale.  
**Fix:** Use the `counters` collection (already defined in Firestore rules) to maintain running totals, or add `limit(100)` and paginate the stats computation.

---

### N-4: `reports.js` Loads Entire Collections for Financial Reports

**Severity:** High  
**Location:** `public/js/reports.js` lines 13–16  
**Description:** The executive Reports tab loads all payments, all otherIncome, and all expenses without pagination. This is the primary financial dashboard for the Treasurer and Chairperson.

**Impact:** Primary financial reporting tool fails at scale.  
**Fix:** Add `limit(100)` and pagination, or pre-compute monthly aggregates in a `monthlyStats` collection.

---

### N-5: `vacancies` Collection Un-paginated in SG Dashboard

**Severity:** Medium  
**Location:** `public/js/executive.js` line 1725  
**Description:** `sgLoadVacancies()` loads all vacancy documents without limit. While vacancy counts are typically low (<100), there is no safeguard.

**Impact:** Moderate — vacancy counts are unlikely to exceed 100, but the query should still be bounded.  
**Fix:** Add `limit(50)`.

---

### N-6: `init.js` Not Included on All Pages

**Severity:** Low  
**Location:** `public/login.html`, `public/register.html`, `public/verify.html`  
**Description:** The `init.js` file (which handles footer year, nav toggle, and dialog close) is included in most public pages but missing from `login.html`, `register.html`, and `verify.html`. This is an inconsistency, not a security issue, but it means the footer year won't update and the nav toggle won't work on these pages.

**Impact:** Minor UI inconsistency.  
**Fix:** Add `<script src="js/init.js"></script>` to the three missing pages.

---

## 4. Risk Matrix (Remaining + New)

### Critical (Must Fix Before Launch)

| ID | Issue | Why It Matters |
|----|-------|---------------|
| C-2 | Same `ADMIN_DELETE_SECRET` for delete + reset | One leak = total account takeover |
| N-1 | Missing `/totp/save` and `/totp/verify` Worker endpoints | 2FA is broken for new enrollments; users locked out |

### High (Fix Within 1 Week)

| ID | Issue | Why It Matters |
|----|-------|---------------|
| C-1 | Email relay token still in Firestore, readable by execs | Email spoofing by compromised exec account |
| C-5 | `reports.js` and admin bulk stats still un-paginated | Financial dashboard crashes at scale |
| N-2 | Matching algorithm loads entire `payments` collection | Placement feature fails at 3,000 students |
| N-3 | Admin bulk stats load entire collections | Year-end reset crashes |
| H-6 | Per-file delete still lacks ownership check | Any auth user can delete any file |
| H-8 | `REQUIRE_AUTH=false` escape hatch still present | Accidental auth bypass |
| H-9 | No input size limit on Apps Script | DoS against email relay |

### Medium (Fix Within 1 Month)

| ID | Issue | Why It Matters |
|----|-------|---------------|
| H-3 | Exec-wide reads still allow mass data exfiltration | Large-scale PII leak if exec account compromised |
| H-1 | Firebase SDK and dynamic scripts lack SRI | Supply-chain risk (low probability) |
| N-5 | `vacancies` un-paginated | Future scalability issue |
| L-6 | CSP `report-uri` endpoint missing | No telemetry on CSP violations |

### Low (Hardening)

| ID | Issue | Why It Matters |
|----|-------|---------------|
| N-6 | `init.js` missing on 3 pages | Minor UI inconsistency |
| L-7 | Self-reporting in library | Moderation noise |

---

## 5. Strategic Recommendations (No Code)

### 5.1 Immediate (Do Not Deploy Without Fixing)

1. **Fix N-1 (TOTP Worker Endpoints):** Add `/totp/save` and `/totp/verify` to the Cloudflare Worker. The `/totp/save` endpoint should:
   - Accept a raw base32 secret in the request body.
   - Encrypt it using a symmetric key stored in the Worker environment (`TOTP_ENCRYPTION_KEY`).
   - Return the encrypted string (format: e.g., `v1:<ciphertext>` or similar).
   - The `/totp/verify` endpoint should accept `encryptedSecret` and `code`, decrypt the secret, and verify the TOTP code using the same RFC 6238 logic currently in `totp.js`.
   - Rate-limit both endpoints (e.g., 5 attempts per minute per user).
   - **Alternative:** If Worker endpoint development is delayed, revert the client-side TOTP encryption changes in `subhero.js` and `login.js` to restore plaintext storage. The security benefit of encryption is not worth breaking 2FA entirely.

2. **Fix C-2 (Separate Admin Secrets):** In the Cloudflare Worker dashboard:
   - Create a new environment variable `ADMIN_RESET_SECRET` with a different, cryptographically random value.
   - Update `handleResetPassword` to use `env.ADMIN_RESET_SECRET` instead of `env.ADMIN_DELETE_SECRET`.
   - Update `handleTestSecret` to accept a `type` parameter ("delete" or "reset") and test the corresponding secret.
   - Update `admin.js` to send the correct token for each operation.

### 5.2 High-Priority (Week 1)

3. **Fix C-1 (Email Relay Architecture):** Create a `/email` endpoint on the Cloudflare Worker. The endpoint should:
   - Accept the email payload type (receipt, rejection, letter, etc.) and destination.
   - Verify the requesting user's Firebase ID token and role (must be exec).
   - Append the `RELAY_TOKEN` from the Worker environment (not from Firestore).
   - Forward the request to the Google Apps Script URL.
   - Update `industrial-secretary.js` and `executive.js` to call the Worker `/email` endpoint instead of `settings/emailRelay`.
   - Remove the email relay URL and token from `settings/emailRelay` in Firestore, or set it to an empty object. Keep only the `isTrial` flag if needed.

4. **Fix N-2, N-3, N-4 (Pagination Gaps):**
   - For `reports.js`: Add `limit(100)` to all three collection queries. Add a "Load more" button or monthly date-range selector.
   - For `admin.js` bulk stats: Instead of loading all documents, query the `counters` collection (which already exists in Firestore rules) for pre-aggregated totals. If counters don't exist yet, create them and update them incrementally in `runTransaction` during payment confirmation.
   - For the matching algorithm (`executive.js` line 1773): Instead of loading all payments, query only `status == "confirmed"` and project only the `studentUid` field. Better yet, maintain a `paidMembers` array or sub-collection that is updated at payment confirmation time.

5. **Fix H-6 (File Ownership on Delete):** In the Worker `handleDelete` per-file branch:
   - After extracting the R2 key, call `env.UZES_BUCKET.head(key)` to retrieve the object's metadata.
   - Check `customMetadata.uploadedBy` against `user.sub`.
   - If they don't match, reject with 403 unless the user is an admin (verified via a Firestore role check or a token claim).
   - Note: Verifying admin status requires an additional Firestore lookup or a custom claim in the Firebase ID token. If custom claims are not set, add a `getDoc` to `executives/{uid}` or `students/{uid}` to check `role == "admin"`.

6. **Fix H-8 (Remove REQUIRE_AUTH):** Delete the `if (env.REQUIRE_AUTH === "false")` branch from `requireUser()` in the Worker. If local testing needs auth bypass, use a separate development Worker instance with different env vars.

7. **Fix H-9 (Apps Script Size Limit):** In `email-relay.gs`, before `JSON.parse(e.postData.contents)`, add:
   - A check for `e.postData.length` (e.g., reject if > 5 MB).
   - A check for `e.postData.type` (must be `application/json`).

### 5.3 Medium-Priority (Month 1)

8. **Fix H-3 (Reduce Exec Read Blast Radius):** Consider creating a `studentPublicProfiles` collection with only non-sensitive fields (name, department, year). Executive dashboards that only need names should query this collection. The full `students` collection should be readable only by the student, admin, and specific roles (Treasurer for payments, Secretary for placements). This is a data model change requiring migration.

9. **Fix H-1 (SRI for Dynamic Scripts):** In `totp.js` and `executive.js`, when dynamically loading `qrcodejs` and `jszip`, compute the SRI hash of the exact file version and add it to the `script` element before appending to the DOM.

10. **Fix N-5 (Vacancy Pagination):** Add `limit(50)` to `sgLoadVacancies()`.

11. **Fix N-6 (init.js Consistency):** Add `init.js` to `login.html`, `register.html`, and `verify.html` for UI consistency.

12. **Fix L-6 (CSP Report Endpoint):** Add a `/csp-report` endpoint to the Worker that accepts POST requests and logs them to the `auditLog` collection or a dedicated `cspReports` collection. Or remove the `report-uri` from the CSP until the endpoint is ready.

---

## 6. Summary

The team has made **genuine and substantial security improvements** since the first audit. The most impactful fixes are:

- **App Check is now live** (C-4).
- **CSP no longer allows inline scripts** (H-2).
- **Admin.js event delegation is clean** (H-10).
- **Legacy `users` collection is retired** (H-3 partial).
- **Payment and student lists are paginated** (C-5 partial).
- **view.html is hardened** (M-2).

However, **three critical issues block launch**:

1. **The missing TOTP Worker endpoints (N-1)** will break 2FA for all users who enable it after deployment. This is a **regression** introduced by the fix attempt.
2. **The shared admin secret (C-2)** remains unchanged in the Worker.
3. **The email relay token (C-1)** is still accessible to all execs and sent directly from the client.

Additionally, **four un-paginated collection queries** (`reports.js`, matching algorithm, admin bulk stats, income/expenses) will cause timeouts and financial cost spikes at 3,000 concurrent users.

**Recommendation: Fix N-1 and C-2 before any deployment. Fix C-1 and the pagination gaps before public launch. The current state is a significant improvement but not yet launch-ready.**

---

*End of Verification Audit Report.*
