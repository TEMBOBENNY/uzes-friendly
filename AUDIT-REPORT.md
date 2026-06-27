# UZES Full System Audit Report

> **Scope:** Complete read-only audit of the UZES web application (Firebase + Cloudflare Worker + Apps Script).
> **Date:** Generated from current codebase review.
> **Constraint:** No code edits were made. This report is for review and remediation planning only.

---

## 1. Executive Summary

The UZES application is a Firebase-based student membership and payment portal with public pages, student dashboards, executive management, admin controls, and an industrial training/attachment letter system. The codebase is well-structured but contains **critical security flaws** in Firestore security rules, **functional bugs** in event listener management and state handling, and **severe access control gaps** that expose private student, financial, and executive data to any logged-in user.

**Severity Breakdown:**
| Severity | Count | Description |
|----------|-------|-------------|
| Critical | 10 | Data exposure, privilege escalation, auth bypass potential |
| High | 12 | Privacy violations, financial data leaks, weak protections |
| Medium | 16 | Incorrect permissions, UI/UX bugs, missing validations |
| Low | 14 | Minor bugs, code quality issues, hardening opportunities |

---

## 2. Critical Issues (Immediate Action Required)

### C-1: Firestore — Users Can Self-Escalate to Admin/Executive (`firestore.rules`)
**Location:** `firestore.rules` lines 28–30
**Issue:**
```
match /users/{userId} {
  allow read: if request.auth != null && request.auth.uid == userId;
  allow write: if request.auth != null && request.auth.uid == userId;
}
```
Any authenticated user can write their own `/users/{userId}` document, including the `role` field. Setting `role: "admin"` or `role: "executive"` in their own user document will cause `guard.js` to redirect them to `admin.html` or `executive.html` on next login. While the `admins` collection check in `subhero.js` prevents actual admin privileges, the redirect and UI exposure still occur. **This is a privilege escalation vector.**

**Fix:** Change `allow write` to `allow update` with a field validation rule that rejects changes to `role`, `uid`, and other sensitive fields. Only allow updates to user-managed fields like `name`, `phone`, etc.

---

### C-2: Firestore — Any User Can Read All Payments, Students, Executives, Financials (`firestore.rules`)
**Location:** `firestore.rules` lines 40–60 (payments, students, executives, income, expenses, reports, placements, vacancies, attachmentRequests)
**Issue:** Multiple collections use `allow read: if request.auth != null`, meaning **any logged-in user** (student, executive, anyone) can read all documents in these collections. This exposes:
- All student names, emails, computer numbers, departments, genders, years
- All payment records, amounts, categories, statuses, proof URLs
- All executive names, emails, positions
- All income and expense records (financial data)
- All placement data, company vacancies, attachment requests

**Fix:** Implement role-based read rules. Students should only read their own data. Executives should read data within their scope. Admins read everything.

---

### C-3: Firestore — Students Can Update Their Own Payment Status (`firestore.rules`)
**Location:** `firestore.rules` lines 40–44
**Issue:**
```
allow update: if request.auth != null && request.auth.uid == resource.data.studentUid
```
A student can update their own payment record. This means they could change `status` from `"rejected"` to `"confirmed"`, `amount` to any value, or even `category` to anything.

**Fix:** Students should only be allowed to `create` payments. `update` should be restricted to `isExecOrAdmin()`.

---

### C-4: Firestore — Payments Create Rule Uses `resource` on Create (`firestore.rules`)
**Location:** `firestore.rules` line 42
**Issue:**
```
allow create: if request.auth != null && request.auth.uid == resource.data.studentUid
```
On `create`, `resource` does not exist. This rule will fail or behave unexpectedly. It should be `request.resource.data.studentUid == request.auth.uid`.

**Fix:** Replace `resource.data.studentUid` with `request.resource.data.studentUid`.

---

### C-5: Cloudflare Worker — Shared Secret for Admin Delete AND Password Reset (`workers/upload-worker/index.js`)
**Location:** `workers/upload-worker/index.js` lines 336–341, 566–587
**Issue:** Both `handleDeleteAuthUser` and `handleResetPassword` use the same `ADMIN_DELETE_SECRET`. If an attacker learns this secret (e.g., via Firestore `settings` document, social engineering, or leak), they can:
1. Delete any Firebase Auth account
2. Reset the password of any user (including admins)

**Fix:** Use separate secrets for deletion and password reset. Also, password reset should require an additional admin authentication check (e.g., verify the admin's Firebase ID token has executive privileges).

---

### C-6: Cloudflare Worker — Any Auth User Can Delete Any File (`workers/upload-worker/index.js`)
**Location:** `workers/upload-worker/index.js` lines 488–527
**Issue:** The `handleDelete` function for per-file deletes only checks `requireUser(request, env)` (valid Firebase ID token) but does **not** verify that the user owns the file. Any authenticated user can delete any file if they know the key or URL.

**Fix:** Check `customMetadata.uploadedBy` against the requesting user's UID, or verify admin status.

---

### C-7: Cloudflare Worker — Per-Isolate Rate Limiting (`workers/upload-worker/index.js`)
**Location:** `workers/upload-worker/index.js` lines 135–168
**Issue:** Rate limits are stored in in-memory `Map` objects. Cloudflare Workers run in multiple isolates across the edge network. An attacker can distribute requests across different edge nodes to bypass rate limits entirely.

**Fix:** Use Durable Objects for strict global rate limiting, or implement a Cloudflare Rate Limiting rule at the edge.

---

### C-8: Attachment Letter — Duplicate Event Listeners (`public/js/attachment.js`)
**Location:** `public/js/attachment.js` lines 103–149
**Issue:** `buildForm()` adds a `submit` event listener to `attForm` every time `initAttachment()` is called. If a student switches tabs away from and back to the Attachment tab, multiple listeners accumulate. Each submission will fire multiple times, creating duplicate attachment requests in Firestore.

**Fix:** Remove the old listener before adding a new one, or use `addEventListener` with `{ once: true }`, or restructure to avoid re-initializing the form.

---

### C-9: Industrial Secretary — Race Condition in `approveAll()` / `resetApproved()` (`public/js/industrial-secretary.js`)
**Location:** `public/js/industrial-secretary.js` lines 150–190 (approveAll), 210–220 (resetApproved)
**Issue:** `approveAll()` iterates over all pending requests and fires async `updateDoc` calls. If `resetApproved()` is clicked during this operation, or if the user navigates away, some requests may be left in an inconsistent state (e.g., updated but not emailed). Also, `resetApproved` deletes all approved request documents without archiving them — data loss.

**Fix:** Add a busy flag during `approveAll`. Archive approved requests before deletion.

---

### C-10: Student Can Register with Duplicate Computer Number (`public/js/register.js`)
**Location:** `public/js/register.js` lines 60–95
**Issue:** The registration function creates a Firebase Auth user and then writes to the `students` collection, but it does **not** check if the computer number already exists. Two students could register with the same computer number.

**Fix:** Query the `students` collection for `compNumber` before creating the account. Use a Firestore transaction to ensure uniqueness.

---

## 3. Functional Bugs

### F-1: Student Registration Missing Email Domain Validation (`public/js/register.js`)
**Location:** `public/js/register.js` lines 60–95
**Issue:** Any email can be used. No check for `@unza.zm` or any institutional domain. This allows non-students to register.

**Recommendation:** Add client-side validation and Firestore rules to restrict email domains if desired.

---

### F-2: Login Page — No Rate Limiting / Brute Force Protection (`public/js/login.js`)
**Location:** `public/js/login.js` lines 24–60
**Issue:** There is no client-side or server-side rate limiting on login attempts. Firebase Auth has built-in rate limiting, but the app doesn't show a captcha or implement account lockout. Brute force is possible.

**Recommendation:** Implement progressive delay or reCAPTCHA after failed attempts.

---

### F-3: `guard.js` — Redirect Race Condition (`public/js/guard.js`)
**Location:** `public/js/guard.js` lines 47–57
**Issue:** If the user navigates away during the auth check, the `window._authAbort` flag is set but the DOM replacement has already occurred. On slower devices, the page flickers between the protected content and the error state.

**Recommendation:** Check `window._authAbort` before mutating DOM, not after.

---

### F-4: `subhero.js` — Double Profile Fetch (`public/js/subhero.js`)
**Location:** `public/js/subhero.js` lines 32–60
**Issue:** `subhero.js` fetches the user profile from Firestore, but `guard.js` has already fetched it and passed it to `initSubHero`. This causes a redundant network request on every protected page load.

**Recommendation:** Pass the already-fetched profile from `guard.js` into `initSubHero` instead of re-fetching.

---

### F-5: `reports.js` — Division by Zero in Percentage Change (`public/js/reports.js`)
**Location:** `public/js/reports.js` lines 170–175
**Issue:**
```javascript
function calcPercentChange(prev, curr) {
  if (prev === 0) return curr === 0 ? 0 : 100;
  return (((curr - prev) / prev) * 100).toFixed(1);
}
```
When `prev === 0` and `curr > 0`, it returns `100` (which implies 100% increase). Mathematically, this is undefined/infinite. This can mislead financial analysis.

**Recommendation:** Return `"N/A"` or `"∞"` when `prev === 0` and `curr > 0`.

---

### F-6: `about.js` — `safeUrl` Does Not Block All Dangerous Protocols (`public/js/about.js`)
**Location:** `public/js/about.js` lines 80–86
**Issue:** `safeUrl` only checks for `https:`, `http:`, `mailto:`, and `tel:`. It does not block `javascript:`, `data:`, `vbscript:`, or other dangerous protocols. While the `esc()` function prevents breaking out of the attribute, `javascript:` URLs can still execute if injected into an `href`.

**Recommendation:** Change the regex to an explicit allowlist or block `javascript:` and `data:` explicitly.

---

### F-7: `activities.js` — Unvalidated Poster URL (`public/js/activities.js`)
**Location:** `public/js/activities.js` lines 84–87
**Issue:** `a.posterUrl` is rendered directly into `<img src="${a.posterUrl}">` without any URL validation. A malicious poster URL could be used for XSS or phishing.

**Recommendation:** Validate `posterUrl` with `safeUrl()` before rendering.

---

### F-8: `faq.js` — Inline Event Handler XSS Risk (`public/js/faq.js`)
**Location:** `public/js/faq.js` lines 37–43
**Issue:** FAQ items are rendered with `onclick="toggleFaq('${item.id}')"`. If an attacker gains write access to the `faq` collection and injects a malicious `id` (e.g., `'); alert(1); //`), it could execute JavaScript.

**Recommendation:** Use `addEventListener` instead of inline `onclick`. While `item.id` is a Firestore document ID (safe), defense in depth is better.

---

### F-9: `student.js` — Library Upload FAB Shown to Non-Members (`public/js/student.js`)
**Location:** `public/js/student.js` lines 940–990
**Issue:** The `initLibrary()` function initializes the upload modal and FAB even when the membership gate is shown. The FAB is hidden via CSS, but the modal event listeners are still attached. A non-member could theoretically trigger the upload modal.

**Recommendation:** Only initialize the upload modal after confirming paid membership.

---

### F-10: `placement.js` — Missing `placementStatus` Field Check (`public/js/placement.js`)
**Location:** `public/js/placement.js` lines 120–170
**Issue:** `renderPlacementStudent()` checks `placement.placementStatus === "pending"` but if the document doesn't exist or `placementStatus` is missing, it shows the "pending" UI. This could confuse students who haven't applied yet.

**Recommendation:** Explicitly check if the placement document exists before showing the status UI.

---

### F-11: `student.js` — Placement Acceptance Submit Without Duplicate Check (`public/js/student.js`)
**Location:** `public/js/student.js` lines 1100–1150
**Issue:** `submitPlacementAcceptance()` writes to the `placementAcceptances` subcollection without checking if the student has already submitted an acceptance. Multiple submissions are possible.

**Recommendation:** Query existing acceptances before creating a new one.

---

### F-12: `executive.js` — `runMatchingAlgorithm` Doesn't Check Vacancy State (`public/js/executive.js`)
**Location:** `public/js/executive.js` lines 1150–1170
**Issue:** When an executive clicks "Assign Now", the matching algorithm runs without checking if the vacancy is already fully matched or closed. This could lead to over-matching.

**Recommendation:** Check `Object.values(v.slotsRemaining).every(s => s <= 0)` before running the match.

---

### F-13: `industrial-secretary.js` — `initTabListeners` Calls `initPlacement()` Without Context (`public/js/industrial-secretary.js`)
**Location:** `public/js/industrial-secretary.js` lines 80–120
**Issue:** `initTabListeners()` imports `initPlacement` from `placement.js`. `placement.js` has a standalone bootstrap check `if (location.pathname.includes("placement.html"))` that calls `protect(["student"])`. If `initPlacement` is called from the secretary context, this bootstrap check might interfere or fail because `protect` is designed for student pages.

**Recommendation:** Ensure `placement.js` exports a clean `initPlacement` function that doesn't trigger the standalone bootstrap when imported as a module.

---

### F-14: `admin.js` — System Settings Modal Doesn't Handle 2FA (`public/js/admin.js`)
**Location:** `public/js/admin.js` lines 700–730
**Issue:** `verifyPassword()` uses `signInWithEmailAndPassword()` to verify the admin password. If the admin has 2FA enabled, this will trigger an MFA requirement that the modal doesn't handle. The verification will fail silently or with an unhelpful error.

**Recommendation:** Check for `multiFactor` requirement before attempting password verification, or use a different verification mechanism (e.g., re-authenticate with a custom token).

---

### F-15: `admin.js` — `seedLibrary()` Doesn't Handle Partial Failures (`public/js/admin.js`)
**Location:** `public/js/admin.js` lines 600–650
**Issue:** The seed library function writes hundreds of documents using `batch.commit()`. If a batch fails, the error is logged but the already-written documents remain. Re-running creates duplicates because there's no deduplication check.

**Recommendation:** Check for existing documents before writing, or use a transaction.

---

### F-16: `library.js` — `submitReport` Doesn't Prevent Self-Reporting (`public/js/library.js`)
**Location:** `public/js/library.js` lines 800–850
**Issue:** A user can report their own upload. While this is harmless, the moderation logic doesn't distinguish between self-reports and third-party reports.

**Recommendation:** Optional: prevent users from reporting their own uploads.

---

### F-17: `verify.js` — Receipt Verification Is Public (`public/js/verify.js`)
**Location:** `public/js/verify.js`
**Issue:** The receipt verification page is public (no auth required). This is by design, but it exposes all receipt data to anyone with the URL. The QR code on the receipt is meant to be scannable by anyone, but the data includes student name, amount, and category.

**Note:** This is a design choice, not necessarily a bug, but should be documented as intentional.

---

### F-18: `email-relay.gs` — No Input Size Limit (`apps-script/email-relay.gs`)
**Location:** `apps-script/email-relay.gs` lines 20–68
**Issue:** `JSON.parse(e.postData.contents)` is called without checking `e.postData.length` or `e.postData.type`. A very large POST body could exceed Apps Script memory limits.

**Recommendation:** Add a size check before parsing.

---

### F-19: `totp.js` — `generateSecret` Doesn't Guarantee Uniformity (`public/js/totp.js`)
**Location:** `public/js/totp.js` lines 8–10
**Issue:** `crypto.getRandomValues(rnd)` generates 20 random bytes. The base32 encoding is correct, but the function doesn't check if the generated secret is valid for common authenticator apps. Some apps may reject certain character combinations.

**Note:** This is very low risk. The implementation follows RFC 6238 correctly.

---

### F-20: `chrome.js` — Footer ResizeObserver May Memory Leak (`public/js/chrome.js`)
**Location:** `public/js/chrome.js` lines 12–16
**Issue:** The `ResizeObserver` is created but never disconnected. On SPA-style navigation (if ever implemented), this could leak memory.

**Recommendation:** Optional — store the observer reference and disconnect on page unload.

---

## 4. Security Vulnerabilities (Penetrable Areas)

### S-1: Firestore — Mass Data Exposure (Privacy Violation)
**Severity:** Critical  
**Affected Collections:** `students`, `payments`, `executives`, `income`, `expenses`, `reports`, `placements`, `vacancies`, `attachmentRequests`  
**Description:** Any authenticated user can read all documents. A student logging in can see every other student's personal information, payment history, and financial records. This violates student privacy and data protection principles.

**Remediation:**
```
// Example: students should only read their own profile
match /students/{studentId} {
  allow read: if request.auth != null && request.auth.uid == studentId;
  allow create: if request.auth != null && request.auth.uid == studentId;
  allow update: if request.auth != null && request.auth.uid == studentId;
}
```

---

### S-2: Firestore — Executive Can Modify Any Executive Profile
**Severity:** Medium  
**Location:** `firestore.rules` lines 70–72 (`execProfiles`)  
**Description:** Any executive can create, update, or delete any `execProfiles` document. This means a malicious executive could overwrite another executive's profile, change their photo, or delete their entry.

**Remediation:** Add an ownership check: `allow update, delete: if request.auth != null && isExecOrAdmin() && resource.data.uid == request.auth.uid;` or allow admin to modify any, but executives only their own.

---

### S-3: Firestore — Any User Can Read Placement Letter Templates
**Severity:** Low  
**Location:** `firestore.rules` lines 110–112 (`placementLetterTemplates`)  
**Description:** The template URLs are readable by any authenticated user. While not sensitive, this exposes internal Google Doc URLs.

**Remediation:** Restrict read to `isExecOrAdmin()` or the Industrial Training Secretary role.

---

### S-4: Firestore — Library Reports Can Be Created by Anyone, But Not Deleted
**Severity:** Medium  
**Location:** `firestore.rules` lines 100–105 (`libraryReports`)  
**Description:** Any user can create a report on a library file, but cannot delete their own report. This could lead to spam reports that only admins can clean up.

**Remediation:** Allow users to delete reports they created (`request.auth.uid == resource.data.reportedBy`).

---

### S-5: Cloudflare Worker — `REQUIRE_AUTH` Escape Hatch
**Severity:** High  
**Location:** `workers/upload-worker/index.js` lines 125–129  
**Description:** If `env.REQUIRE_AUTH === "false"` is set in the Worker environment, all authentication checks are bypassed. This is intended for local testing but could be accidentally left on in production.

**Remediation:** Remove this escape hatch entirely, or log a critical warning every time it's used.

---

### S-6: Cloudflare Worker — Admin Delete Secret Stored in Firestore
**Severity:** High  
**Location:** `public/js/admin.js` lines 670–690, `workers/upload-worker/index.js` lines 336–341  
**Description:** The `adminDeleteToken` is stored in the Firestore `settings` document. While `settings` is protected by `isAdmin()`, if an admin account is compromised, the attacker can read the secret and then delete any user account or reset any password.

**Remediation:** Do not store the secret in Firestore. Store it only in the Worker environment variables. The admin panel should not display or store the secret.

---

### S-7: Apps Script — Token-Based Authentication Without Expiration
**Severity:** Medium  
**Location:** `apps-script/email-relay.gs` lines 24–28  
**Description:** The email relay uses a static `RELAY_TOKEN` stored in Script Properties. There is no expiration, rotation, or IP whitelisting. If the token is leaked, anyone can send emails through the relay.

**Remediation:** Add IP-based validation (check the requester's IP against the Firebase hosting IP ranges), or implement token rotation.

---

### S-8: Client-Side — `config.js` Exposes Firebase API Key
**Severity:** Low (by design)  
**Location:** `public/js/config.js`  
**Description:** The Firebase `apiKey` is exposed in client-side JavaScript. This is standard for Firebase web apps, but it means the key can be extracted and used for API calls.

**Remediation:** Enable Firebase App Check to restrict API usage to your domain. This is the standard Firebase security practice.

---

### S-9: Client-Side — `innerHTML` Used Extensively
**Severity:** Medium  
**Locations:** Multiple files (`student.js`, `executive.js`, `admin.js`, `industrial-secretary.js`, `library.js`, `content.js`, `contact.js`, `about.js`, `activities.js`)
**Description:** `innerHTML` is used throughout the app to render dynamic content. While most data comes from trusted sources (Firestore), any injection vulnerability in Firestore write rules or a compromised exec account could lead to stored XSS.

**Remediation:** Where possible, use `textContent` instead of `innerHTML` for text content. For structured HTML, use a DOM builder or a templating engine with automatic escaping. The `esc()` function is used in some places but not consistently.

---

### S-10: Client-Side — No Content Security Policy (CSP)
**Severity:** Medium  
**Location:** All HTML files  
**Description:** None of the HTML files include a `Content-Security-Policy` meta tag or header. This means inline scripts, `eval()`, and external scripts can execute freely.

**Remediation:** Add a CSP header via Firebase Hosting configuration or a `<meta>` tag. Start with a restrictive policy and relax as needed.

---

### S-11: Client-Side — No Subresource Integrity (SRI)
**Severity:** Low  
**Location:** All HTML files loading CDN scripts (`html5-qrcode`, `xlsx`, `qrcodejs`)
**Description:** CDN scripts are loaded without `integrity` attributes. If a CDN is compromised, malicious code can be injected into the app.

**Remediation:** Add SRI hashes to all CDN script tags.

---

### S-12: Storage Rules — Any Authenticated User Can Read All Files
**Severity:** Medium  
**Location:** `storage.rules` lines 8–12  
**Description:** `allow read: if request.auth != null;` means any logged-in user can read any file in the bucket. This includes payment proofs, signatures, and other sensitive documents.

**Remediation:** Implement path-based rules. For example, `match /users/{uid}/{allPaths=**} { allow read: if request.auth.uid == uid; }`.

---

## 5. Access Control Issues (Among Logged-In Members)

### AC-1: Horizontal Privilege Escalation — Student Reads Other Students' Data
**Severity:** Critical  
**Description:** As noted in S-1, the Firestore rules allow any authenticated user to read all student profiles, payments, and financial data. This is a horizontal privilege escalation — a student can access another student's data at the same privilege level.

**Remediation:** Implement user-scoped read rules.

---

### AC-2: Horizontal Privilege Escalation — Student Reads Executive Data
**Severity:** High  
**Description:** The `executives` collection allows `read: if request.auth != null`. Students can read all executive emails, names, and positions. This could be used for social engineering attacks.

**Remediation:** Restrict executive read to executives and admins only, or expose only public fields.

---

### AC-3: Vertical Privilege Escalation — Self-Assigned Role (`users` document)
**Severity:** Critical  
**Description:** As noted in C-1, students can write their own `role` field. While the `admins` collection gate prevents actual admin access, the `guard.js` redirect logic trusts the `users` document role. This creates a partial vertical escalation (UI redirect to admin/executive pages).

**Remediation:** Lock down the `users` collection write rules.

---

### AC-4: Role Confusion — Admin vs Executive vs Student
**Severity:** Medium  
**Description:** The `subhero.js` determines the role by checking `admins` collection first, then `executives`, then `users`. A user who is both an admin and an executive will be treated as an admin. This is usually fine, but if the admin role is removed, the user should fall back to executive. The current logic does this correctly, but it's worth noting.

**Recommendation:** Document the role hierarchy clearly.

---

### AC-5: Industrial Training Secretary — No Dedicated Role Check in Rules
**Severity:** Medium  
**Description:** The Industrial Training Secretary is treated as a special case in the application logic (`industrial-secretary.html`), but the Firestore rules don't have a dedicated `isSecretary()` function. The secretary's permissions are handled by `isAdmin()` or by checking the `admins` collection. This means the secretary's access is controlled by admin logic, not by their own role.

**Remediation:** Add a `secretaries` collection or a `role == "secretary"` field in the `users` document, and create a corresponding `isSecretary()` rule function.

---

### AC-6: Treasurer Can Read All Expenses But Not Approve Them
**Severity:** Low  
**Description:** The `expenses` collection allows `read: if request.auth != null`. The treasurer can read all expenses (fine), but the approval logic in `executive.js` is client-side. The Firestore rules correctly restrict `update` to admin/approvers, but the client-side UI shows the approval buttons based on role checks. This is correct but could be bypassed if the client-side code is manipulated.

**Recommendation:** Ensure the server-side rules are the authoritative gate, not just client-side UI.

---

### AC-7: Library Moderation — Any Admin Can Delete Any File
**Severity:** Medium  
**Description:** The `library` collection allows `delete: if request.auth != null && isAdmin()`. This is correct for admin cleanup. However, a regular user who uploaded a file cannot delete their own file if it was rejected or if they change their mind. They must ask an admin.

**Remediation:** Allow users to delete their own uploads: `allow delete: if request.auth != null && (request.auth.uid == resource.data.uploadedBy || isAdmin());`.

---

### AC-8: Placement Vacancy — Any Auth User Can Read All Vacancies
**Severity:** Medium  
**Description:** The `vacancies` collection allows `read: if request.auth != null`. While not sensitive, this exposes company names, slot numbers, and gender preferences to all students.

**Remediation:** This may be intentional for transparency. Document if this is by design.

---

### AC-9: Attachment Request — Any Auth User Can Read All Requests
**Severity:** Medium  
**Description:** The `attachmentRequests` collection allows `read: if request.auth != null`. Students can see other students' names, computer numbers, departments, phone numbers, and custom fields submitted to the Industrial Training Secretary.

**Remediation:** Restrict read to the student who created the request and the secretary/admin.

---

### AC-10: Executive Cannot See Their Own Profile Data in `execProfiles`
**Severity:** Low  
**Description:** The `execProfiles` collection is public read (`allow read: if true`), but the executive's own data in the `executives` collection is restricted. There is no direct link between the `executives` collection (auth data) and `execProfiles` (public profile data). An executive could have their public profile edited by another executive without their knowledge.

**Remediation:** Add ownership tracking to `execProfiles` (e.g., `uid` field) and allow the owner to edit their own profile.

---

## 6. Additional Observations & Recommendations

### 6.1 Missing Indexes
The `firestore.indexes.json` only defines 3 indexes for the `payments` collection. As the app grows, queries on other collections (e.g., `library`, `placements`, `activities`) will benefit from composite indexes. Monitor the Firebase console for missing index warnings.

### 6.2 No Audit Log
There is no dedicated `auditLogs` collection. Actions like "admin deleted student", "executive confirmed payment", "password reset" are not logged. For a financial system, an audit trail is essential.

**Recommendation:** Create an `auditLogs` collection (write-only for admin, read-only for admin) and log all critical actions.

### 6.3 No Data Backup Strategy
Firestore has no automated backup mentioned. The "Reset academic year" feature in `admin.js` archives data to an Excel file in Cloudflare R2, but this is a manual/admin-triggered process.

**Recommendation:** Enable Firebase automated backups or implement a Cloud Function that periodically exports critical collections.

### 6.4 Test Coverage
There are no unit tests, integration tests, or end-to-end tests. The `package.json` in `workers/upload-worker` has a placeholder test script.

**Recommendation:** Add Jest tests for the Cloudflare Worker and consider Cypress or Playwright for end-to-end testing of critical user flows.

### 6.5 Apps Script — `FIREBASE_PROJECT_ID` Not Validated in Expiry Check
The `checkPlacementExpirations()` function in `email-relay.gs` reads `FIREBASE_PROJECT_ID` from Script Properties. If this is missing or incorrect, the function silently logs and returns. There is no alert or notification to the admin that the expiry check is not running.

**Recommendation:** Add an email alert or a daily health check that verifies the trigger is configured correctly.

### 6.6 Client-Side Validation Gaps
- **Password strength:** No enforcement beyond minimum 6 characters.
- **Phone number:** No format validation (e.g., Zambian mobile number format).
- **Computer number:** No format validation.
- **Year of study:** Free-text input in some places (e.g., attachment form), which could lead to inconsistent data.

### 6.7 CSS — `var(--green)` is Actually Blue
**Location:** `public/css/styles.css` line 2
```css
--green: #0055a5;       /* UZES blue */
```
This is a naming inconsistency that could confuse future developers. The variable is named `--green` but holds a blue color.

---

## 7. Summary of Fix Priority

### Immediate (Do Not Deploy Without Fixing)
1. **C-1** — Lock down `users` collection write rules (self-escalation)
2. **C-2** — Restrict read access to student, payment, and financial collections
3. **C-3** — Prevent students from updating their own payment status
4. **C-4** — Fix payments `create` rule using `resource` on create
5. **C-5** — Separate admin secrets for deletion and password reset
6. **C-6** — Verify file ownership before delete in Worker
7. **C-8** — Fix duplicate event listeners in attachment form
8. **C-10** — Enforce unique computer numbers on registration

### High Priority (Fix Within 1 Week)
9. **S-1** — Implement role-based data access (horizontal escalation fix)
10. **C-7** — Replace in-memory rate limits with Durable Objects or edge rules
11. **C-9** — Add race condition protection and archiving to `approveAll`/`resetApproved`
12. **S-6** — Remove admin secret from Firestore storage
13. **F-2** — Implement brute force protection on login
14. **S-10** — Add Content Security Policy

### Medium Priority (Fix Within 1 Month)
15. **S-2** — Add ownership checks to `execProfiles`
16. **S-4** — Allow users to delete their own library reports
17. **S-9** — Replace `innerHTML` with safer DOM construction where possible
18. **F-5** — Fix percent change calculation
19. **F-6** — Harden `safeUrl` function
20. **F-7** — Validate poster URLs
21. **F-9** — Hide upload FAB from non-members
22. **AC-5** — Add dedicated secretary role to Firestore rules

### Low Priority (Hardening & Polish)
23. **S-8** — Enable Firebase App Check
24. **S-11** — Add Subresource Integrity to CDN scripts
25. **S-12** — Implement path-based storage rules
26. **F-3** — Fix guard.js redirect race condition
27. **F-4** — Eliminate double profile fetch
28. **F-14** — Handle 2FA in admin password verification modal
29. **F-15** — Add deduplication to library seeding
30. **6.2** — Implement audit logging
31. **6.7** — Rename CSS variable `--green` to `--primary` or `--brand-blue`

---

*End of Audit Report.*
