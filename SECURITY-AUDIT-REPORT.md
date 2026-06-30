# UZES Platform — Pre-Production Security Audit Report

**Classification:** Confidential — Pre-Production Go/No-Go Assessment  
**Scope:** UZES Web Application (Firebase + Cloudflare Worker + Apps Script) + Android Mobile Application (Capacitor 8)  
**Target Load:** 3,000 concurrent students  
**Audit Date:** 29 June 2026  
**Assessor:** Senior Application Security Architect & DevSecOps Engineer  
**Constraint:** No code modifications, rewrites, or refactors were performed. This document is strictly analytical and strategic.

---

## 1. Executive Summary

### 1.1 Overall Posture

The UZES platform is a **Firebase-native, serverless student membership and financial management system** with a Capacitor-wrapped Android application. The architecture is well-structured for a small-to-medium organization, with clear separation between public pages, student dashboards, executive workflows, and administrative controls. The code shows evidence of security-conscious design (role-based Firestore rules, magic-byte file verification, TOTP 2FA, audit logging, and CSP headers).

However, **the system contains several critical architectural vulnerabilities that must be resolved before public launch**. The most severe issues are not in the client-side code, but in the **secrets management strategy, the trust boundaries between the Worker and Firestore, and the misalignment between client-side UI gating and server-side rule enforcement**.

### 1.2 The "3,000 Students" Scalability Verdict

From a pure infrastructure perspective, **Firebase Firestore and Firebase Auth can handle 3,000 concurrent users** without manual scaling. Firestore is a serverless NoSQL database that auto-scales horizontally. Firebase Auth tokens are stateless JWTs. The platform does not use server-side sessions, database connection pools, or local memory caches for auth state — all of which are correct architectural choices for this scale.

The **real scalability risk is financial, not technical**: 3,000 students performing un-paginated collection queries (e.g., loading all payments, all library files, or all student profiles) will generate **massive Firestore read charges** and could trigger Firebase project quota limits. The current application loads entire collections into memory in several dashboard views. This is sustainable for 50 users but will become prohibitively expensive and slow at 3,000 users.

### 1.3 Go / No-Go Recommendation

**RECOMMENDATION: NO-GO for public launch until Critical issues C-1 through C-5 are resolved.**

The system is functional and well-built for internal use, but the following show-stoppers expose it to privilege escalation, mass data exfiltration, and unauthorized email injection on day one:

1. **Any active student can read the email relay secret** and send emails impersonating UZES officials.
2. **The same admin secret is used for both account deletion and password reset** — a single leak grants total control.
3. **TOTP 2FA secrets are stored in plaintext in Firestore** — if an admin account is compromised, all 2FA protections are bypassed.
4. **Firebase App Check is disabled** — the public API key can be abused for quota exhaustion and enumeration attacks.
5. **No application-level rate limiting on Firestore reads** — a single authenticated user can scrape the entire database.

Once these five issues are addressed architecturally, the platform can proceed to a **conditional GO** with a 30-day remediation window for High-priority items.

---

## 2. Full System Architecture (As-Is)

### 2.1 High-Level Data Flow

```
┌─────────────────────────────────────────────────────────────────────────────┐
│                              CLIENT LAYER                                    │
├─────────────────────────────────────────────────────────────────────────────┤
│  Web Browser        │  Android App (Capacitor 8)                             │
│  ─────────────      │  ─────────────────────────                             │
│  • Static HTML/JS   │  • WebView (Chromium)                                   │
│  • Firebase JS SDK  │  • Same HTML/JS bundled as assets                     │
│  • Service Worker   │  • @capacitor/push-notifications (native FCM)         │
│    (FCM push)       │  • No SSL pinning                                       │
└────────────────┬────────────────────────────────────────────┘
                 │ HTTPS (TLS 1.2+)
                 │ Firebase ID Token (JWT) in Authorization header
                 ▼
┌─────────────────────────────────────────────────────────────────────────────┐
│                         FIREBASE PLATFORM (Google Cloud)                    │
├─────────────────────────────────────────────────────────────────────────────┤
│  Firebase Auth      │  Stateless JWT auth. Tokens valid ~1 hour.               │
│  Firestore        │  Document-level security rules. NoSQL. Serverless.     │
│  Firebase Storage │  File storage (proofs, photos, signatures).            │
│  Firebase Hosting │  Static asset CDN + security headers (CSP, HSTS).      │
│  FCM              │  Push notifications (web + native).                      │
└────────────────┬────────────────────────────────────────────┘
                 │
                 │ REST API calls (HTTPS)
                 ▼
┌─────────────────────────────────────────────────────────────────────────────┐
│                         CLOUDFLARE WORKER (Edge)                             │
├─────────────────────────────────────────────────────────────────────────────┤
│  • File upload / download (R2 object storage)                                │
│  • Magic-byte file type verification                                         │
│  • Rate limiting (in-memory, per-isolate)                                  │
│  • Firebase ID token verification (locally, via Google JWKS)                 │
│  • Admin endpoints: delete-auth-user, reset-password (shared secret)        │
│  • FCM push notification relay                                               │
│  • AI content screening (Google Gemini) — optional                            │
└────────────────┬────────────────────────────────────────────┘
                 │
                 │ HTTPS
                 ▼
┌─────────────────────────────────────────────────────────────────────────────┐
│                         GOOGLE APPS SCRIPT (Email Relay)                     │
├─────────────────────────────────────────────────────────────────────────────┤
│  • Static RELAY_TOKEN in Script Properties                                   │
│  • Receives POST requests from Worker (or any caller with token)            │
│  • Generates PDF receipts / attachment letters via Google Drive / Docs      │
│  • Sends emails via Gmail (MailApp)                                          │
│  • Time-driven trigger: placement expiry checker (every 30 min)              │
└─────────────────────────────────────────────────────────────────────────────┘
```

### 2.2 Typical Login Flow

1. Student enters email (or computer number) + password on `login.html`.
2. Client looks up computer number → email in the public `compIndex` collection.
3. `signInWithEmailAndPassword()` calls Firebase Auth.
4. `onAuthStateChanged` fires; `guard.js` probes `executives/`, `students/`, and `users/` collections in parallel to find the profile document.
5. Profile collection name is cached in `localStorage` (keyed by UID) to avoid re-probing on subsequent page loads.
6. `guard.js` attaches a real-time `onSnapshot` listener to the profile document.
7. If `profile.active === false`, the user is immediately logged out (server-side disable is enforced client-side within seconds).
8. If `profile.totpEnabled === true`, a TOTP prompt is shown. On success, a flag is set in `sessionStorage`.
9. `routeByRole()` redirects to `student.html`, `executive.html`, or `admin.html`.

**Architectural Note:** Step 6 is elegant for real-time disable but creates a persistent WebSocket connection per active user. At 3,000 concurrent users, this is 3,000 active Firestore listeners. Firestore handles this, but it is a cost factor to monitor.

### 2.3 Typical Data-Fetching Flow (Executive Dashboard)

1. Executive loads `executive.html`.
2. `guard.js` authenticates and attaches the profile listener.
3. `executive.js` fetches ALL documents from `payments` (ordered by `submittedAt`), ALL documents from `otherIncome`, and ALL documents from `expenses`.
4. For each payment, the client may perform a secondary `getDoc` to `students/{studentUid}` to resolve the student's name and computer number.
5. Data is rendered into DOM tables using `innerHTML` with string templates.

**Scalability Warning:** Step 3 loads entire collections. At 3,000 students × 5 payments/year = 15,000 payment documents, this is already a heavy query. Without pagination, this will become a timeout and cost issue.

---

## 3. Critical Vulnerabilities (Must Fix Before Launch)

### C-1: Email Relay Secret Exposed to All Active Users

**Severity:** Critical  
**Location:** `firestore.rules` (`settings/emailRelay` read rule) + `public/js/industrial-secretary.js` + `public/js/executive.js`  
**Description:** The Firestore rules allow `signedIn() && myActive()` to read the `settings/emailRelay` document. This document contains the **Google Apps Script webhook URL and the RELAY_TOKEN**. Any student who logs in can read this token and invoke the email relay directly, sending arbitrary emails with UZES branding and official signatures.  
**Impact:** Complete email spoofing capability. A malicious student could send fake payment rejection letters, fake attachment approval letters, or phishing emails to any address.  
**Strategic Fix:** The email relay token must be moved out of Firestore entirely. The Cloudflare Worker should store the relay URL and token as environment variables and act as the sole email gateway. The Worker should validate the sender's Firebase ID token and role before forwarding any email request to Apps Script.

### C-2: Single Admin Secret Used for Both Account Deletion AND Password Reset

**Severity:** Critical  
**Location:** Cloudflare Worker (`ADMIN_DELETE_SECRET` environment variable)  
**Description:** The same `ADMIN_DELETE_SECRET` is used to gate both `/admin/delete-auth-user` and `/admin/reset-password`. These are the two most destructive operations in the system. If this secret is leaked (via the admin panel, social engineering, or a compromised admin account), an attacker can both delete any user and reset any user's password — including the admin's own password.  
**Impact:** Total account takeover and data destruction.  
**Strategic Fix:** Use **two separate, cryptographically independent secrets** stored in the Worker environment. The password-reset secret should be further restricted: require the requesting admin's Firebase ID token to be verified as an active executive/admin, and log every password reset to an immutable audit trail.

### C-3: TOTP 2FA Secrets Stored in Plaintext in Firestore

**Severity:** Critical  
**Location:** `students/{uid}` and `executives/{uid}` documents (`totpSecret` field)  
**Description:** When a user enables 2FA, the raw TOTP secret (the base32 key) is stored in the user's Firestore document. Firestore documents are readable by admins and by the document owner. A compromised admin account, a Firestore backup leak, or a rules misconfiguration gives an attacker the ability to generate the exact same 6-digit codes as the legitimate user.  
**Impact:** 2FA becomes a decorative feature rather than a security control. An attacker with the secret can bypass 2FA indefinitely.  
**Strategic Fix:** The TOTP secret should be **encrypted at the application layer** before storage. Use a symmetric key (stored in the Cloudflare Worker environment, not in Firestore) to encrypt the secret. The client should never see the raw secret after enrollment — only the QR code during setup. Alternatively, migrate to a cloud-based MFA provider (Firebase now supports phone MFA) or use a dedicated identity provider.

### C-4: Firebase App Check Disabled — Public API Key Abuse

**Severity:** Critical  
**Location:** `public/js/config.js` (`RECAPTCHA_SITE_KEY = ""`)  
**Description:** The Firebase project ID and API key are public by design (they must be shipped to the client). However, without Firebase App Check (reCAPTCHA v3), **anyone on the internet can use the API key** to make calls against the Firebase project. While Firestore rules enforce authentication, an attacker can still: enumerate registered users, abuse the Firebase Auth quota, perform dictionary attacks against the login endpoint, and exhaust the project's free tier.  
**Impact:** Quota exhaustion, denial of service, user enumeration, and financial drain.  
**Strategic Fix:** Register the web app and the Android app in Firebase App Check with reCAPTCHA v3 (web) and Play Integrity / SafetyNet (Android). Populate the `RECAPTCHA_SITE_KEY` in `config.js` and enable enforcement in the Firebase Console. This is the single most important hardening step for any Firebase app.

### C-5: No Application-Level Rate Limiting on Firestore Reads

**Severity:** Critical  
**Location:** All Firestore collection queries from the client  
**Description:** The Cloudflare Worker has rate limiting for upload/delete endpoints, but there is **no rate limiting on Firestore queries**. An authenticated attacker can write a simple script to iterate through every `students` document, every `payments` document, every `executives` document, and every `libraryFiles` document. Firestore rules enforce read access, but the volume itself is unrestricted.  
**Impact:** Mass data exfiltration by a single compromised student account. At 3,000 users, a single attacker can scrape the entire database in minutes.  
**Strategic Fix:** Implement query result limits and pagination at the architectural level. For executive dashboards, introduce server-side aggregation (Cloud Functions or Worker-based endpoints) that return pre-computed statistics rather than raw document streams. Monitor Firebase Console for anomalous read patterns and set up alerts.

---

## 4. Risk Matrix

### 4.1 Critical Risk (Immediate — Do Not Launch)

| ID | Issue | Attack Vector | Business Impact |
|----|-------|-------------|-----------------|
| C-1 | Email relay secret readable by any active user | Firestore rules leak | Email spoofing, phishing, reputational damage |
| C-2 | Single shared secret for delete + password reset | Worker secret leak | Total account takeover, mass deletion |
| C-3 | TOTP secrets stored in plaintext in Firestore | Admin compromise, backup leak | 2FA bypass for all users |
| C-4 | Firebase App Check disabled | API key abuse, quota exhaustion | DoS, financial drain, enumeration |
| C-5 | No rate limiting on Firestore reads | Automated scraping by one account | Mass data breach, privacy violation |

### 4.2 High Risk (Fix Within 1 Week of Launch)

| ID | Issue | Attack Vector | Business Impact |
|----|-------|-------------|-----------------|
| H-1 | No Subresource Integrity (SRI) on CDN scripts | CDN compromise | Supply-chain XSS injection |
| H-2 | CSP allows `'unsafe-inline'` for scripts and styles | Stored XSS via compromised exec account | Session hijacking, defacement |
| H-3 | Mass data exposure to any executive role | Compromised executive account | Large-scale student PII leak |
| H-4 | `compIndex` collection is public read | Enumeration of all computer numbers | User enumeration, targeted phishing |
| H-5 | Android APK contains Firebase API key in `google-services.json` | APK decompilation | Same as C-4, but for mobile key |
| H-6 | Per-file delete does not verify file ownership | Leaked file URL key | Unauthorized file deletion |
| H-7 | No server-side session invalidation on disable | Token remains valid for ~1 hour after disable | Disabled user retains access temporarily |
| H-8 | `REQUIRE_AUTH=false` escape hatch in Worker | Accidental deployment | Complete auth bypass |
| H-9 | No input size limit on Apps Script POST body | Large payload to email relay | Apps Script memory exhaustion |
| H-10 | Inline `onclick` handlers generated with string interpolation in admin panel | Malicious user name/ID in admin view | Stored XSS in admin dashboard |

### 4.3 Medium Risk (Fix Within 1 Month)

| ID | Issue | Attack Vector | Business Impact |
|----|-------|-------------|-----------------|
| M-1 | No progressive delay / CAPTCHA before login | Credential stuffing against Firebase Auth | Account lockouts, brute force |
| M-2 | `view.html` renders user-controlled URL parameters | Malicious `?k=` or `?n=` values | Potential XSS via file viewer |
| M-3 | File uploadWorker rate limiter is per-isolate, not global | Distributed attack across Cloudflare edge | Rate limit bypass |
| M-4 | No integrity verification on dynamically loaded CDN scripts (jszip, qrcodejs) | CDN compromise | Supply-chain injection |
| M-5 | No automated Firestore backup strategy | Accidental deletion, ransomware | Irreversible data loss |
| M-6 | `innerHTML` used extensively across all JS modules | Compromised Firestore write → stored XSS | Defacement, session theft |
| M-7 | No phone number format validation | Invalid data, SMS abuse if SMS is added | Data quality issues |
| M-8 | `totpVerified` flag stored in `sessionStorage` — survives tab close but not browser restart | Session replay | Brief 2FA bypass window |
| M-9 | No Subresource Integrity on the Firebase compat SDK loaded in service worker | gstatic.com compromise | Service worker hijacking |
| M-10 | Receipt verification page exposes student name, amount, category via public URL | URL sharing | Unintended data disclosure |

### 4.4 Low Risk (Hardening & Polish)

| ID | Issue | Attack Vector | Business Impact |
|----|-------|-------------|-----------------|
| L-1 | CSS variable `--green` holds a blue color (#0055a5) | Developer confusion | Maintenance risk |
| L-2 | No `integrity` attributes on Google Fonts or static CDN assets | CDN compromise | Minor style injection risk |
| L-3 | `ResizeObserver` in `chrome.js` never disconnected | SPA memory leak (if ever implemented) | Minor performance degradation |
| L-4 | No test coverage for Cloudflare Worker or end-to-end flows | Regression risk | Bugs reach production |
| L-5 | `auditLog` entries are write-only for users but deletable by admin | Admin tampering | Audit trail integrity weakness |
| L-6 | No Content Security Policy report-uri for violation monitoring | Missed CSP violations | Silent policy bypasses |
| L-7 | Student can report their own library upload | Self-report spam | Moderation noise |

---

## 5. Detailed Technical Findings

### 5.1 External Attack Surface & Client-Side Visibility

**Finding:** The Firebase API key, project ID, messaging sender ID, and app ID are visible in `public/js/config.js` and `public/firebase-messaging-sw.js`. This is **by design** for Firebase web applications — the API key cannot be hidden from the client. However, the absence of Firebase App Check means this key is exploitable.

**Finding:** The Cloudflare Worker endpoint URL (`https://uzes-upload.uzesofficial.workers.dev`) is public in `config.js`. This is acceptable because the Worker requires a valid Firebase ID token for all mutating operations.

**Finding:** The FCM VAPID key is public in `config.js`. This is also by design for web push notifications.

**Finding:** No internal IP addresses, admin panel URLs, or database connection strings are exposed in the client-side code. Admin pages (`admin.html`, `executive.html`, `industrial-secretary.html`) exist in the static bundle but are protected by `guard.js` role checks.

**Finding:** API error messages are mapped to user-friendly strings in the client code (e.g., `auth/invalid-credential` → "Incorrect credentials"). No stack traces or internal database structures are exposed to end users.

**Strategic Recommendation:** Enable Firebase App Check immediately. Without it, the public API key is a dangling vulnerability.

### 5.2 System Resilience & Denial of Service

**Finding:** The Cloudflare Worker implements a 10 MB file size limit for proof uploads and a 50 MB limit for library uploads. File types are restricted by MIME type and verified against magic bytes (JPEG, PNG, GIF, PDF, WEBP). This is good.

**Finding:** The Worker does not implement a maximum request body size limit for non-upload endpoints (e.g., `/push`, `/delete`). A large JSON payload could theoretically consume Worker CPU/memory.

**Finding:** Several executive and admin dashboard queries load **entire collections** without pagination. For example, `getDocs(query(collection(db, "payments"), orderBy("submittedAt", "desc")))` loads all payment documents into memory. At 3,000 students × 5 payments/year = 15,000 documents, this query will exceed the Firestore 1 MB per-response soft limit and will become slow and expensive.

**Finding:** There is no N+1 query problem in the traditional SQL sense, but there is a **"N+1 document fetch" pattern** in the executive dashboard: after loading all payments, the client iterates and fetches individual `students/{uid}` documents to resolve names. This doubles the read count.

**Strategic Recommendation:** Replace full-collection queries with **paginated queries** (using `limit()` and `startAfter()`). For dashboards that need aggregates (counts, totals), use **Cloud Functions or Worker-based aggregation endpoints** that return summary statistics rather than raw document arrays. This reduces both cost and attack surface.

### 5.3 Rate Limiting (Throttling)

**Finding:** The Cloudflare Worker implements per-IP and per-UID sliding-window rate limits for upload, delete, and push endpoints. Limits are reasonable (e.g., 120 requests/minute per IP globally, 10 uploads/minute per IP, 30 uploads/hour per user).

**Finding:** The rate limiter is **in-memory (Map objects) and per-isolate**. Cloudflare Workers run in thousands of isolates across the edge network. An attacker distributing requests across different edge nodes can multiply their effective rate limit by the number of isolates they hit. This is a known architectural limitation of Cloudflare Workers without Durable Objects.

**Finding:** There is **no application-level rate limiting on Firebase Auth endpoints** (login, password reset). The app relies on Firebase Auth's built-in rate limiting, which is opaque and may not be aggressive enough for a targeted brute-force campaign.

**Finding:** There is **no rate limiting on Firestore queries**. An authenticated user can make unlimited `getDocs` calls.

**Strategic Recommendation:** For the Worker, consider upgrading to **Cloudflare Durable Objects** for strict global rate limiting, or add a Cloudflare Rate Limiting rule at the zone level. For Firestore, implement pagination and query restrictions as described in Section 5.2. For login, consider adding a progressive delay or reCAPTCHA v3 challenge after 3 failed attempts.

### 5.4 Authentication & Session Management

**Finding:** The system uses **Firebase Authentication with email/password**. Password policy is enforced client-side (12 characters, mixed case, number, special character) and server-side via Firebase Auth settings.

**Finding:** **TOTP-based 2FA is implemented** using `totp.js` (RFC 6238). The client generates the secret, verifies the code, and stores `totpEnabled` and `totpSecret` in Firestore. However, as noted in C-3, the secret is stored in plaintext.

**Finding:** The `totpVerified` flag is stored in `sessionStorage`. This means: (a) if the user closes the browser and reopens it, they must re-enter the TOTP code; (b) if the user opens a new tab within the same session, they are not re-prompted. This is acceptable but should be documented.

**Finding:** **Tokens are stored in the browser by the Firebase Auth SDK**, which uses `indexedDB` (or `localStorage` in some fallback cases). There is no explicit cookie-based session. The `capacitor.config.json` has `webContentsDebuggingEnabled: false`, which is correct for production.

**Finding:** **There is no refresh token rotation** implemented by the application. Firebase Auth handles refresh token rotation internally and automatically. The application does not expose or manage refresh tokens directly.

**Finding:** **Logout calls `signOut(auth)`**, which clears the local auth state. However, Firebase Auth tokens are JWTs with a ~1-hour expiration. If a user's account is disabled (`active = false`), the `guard.js` `onSnapshot` listener detects this within seconds and forces a logout. **But the existing ID token remains valid until expiry.** A disabled user with a cached token can still make API calls for up to an hour.

**Strategic Recommendation:** For stronger session invalidation, implement **custom Firebase Authentication tokens** with short expiration (e.g., 15 minutes) and force a token refresh check against the `active` field in Firestore. Alternatively, use Firebase Cloud Functions to revoke refresh tokens immediately when an account is disabled.

### 5.5 Cookie Security

**Finding:** The system does **not use cookies for session management**. Firebase Auth stores tokens in `indexedDB`/`localStorage`. Therefore, traditional cookie security attributes (`Secure`, `HttpOnly`, `SameSite`) are not applicable to the auth mechanism.

**Finding:** Firebase Hosting does set `Strict-Transport-Security` (HSTS), `X-Frame-Options: DENY`, and `Referrer-Policy` headers. This is good.

**Strategic Recommendation:** If cookies are ever introduced (e.g., for a server-side rendered path), ensure they are `Secure`, `HttpOnly`, `SameSite=Strict`, and use the `__Host-` prefix.

### 5.6 Authorization & Broken Access Control (IDOR)

**Finding:** The application does **not use URL parameters** like `?user_id=123` for data access. All data access is through the Firebase SDK with document IDs that are Firebase UIDs. The Firestore rules enforce the authorization boundary.

**Finding:** The **Firestore rules are the primary (and only) authorization gate**. Client-side UI checks (e.g., hiding the "Approve" button from non-Chairpersons) are for UX convenience only. A malicious client could bypass the UI and make direct Firestore calls. However, the rules would still block unauthorized writes.

**Finding:** **Role-Based Access Control (RBAC) is enforced in Firestore rules** for every collection. The rules define granular functions like `isAdmin()`, `isExec()`, `isTreasurer()`, `isChairOrVice()`, `isContentEditor()`, etc. This is architecturally sound.

**Finding:** **Potential IDOR gap in `students` collection:** The read rule allows `myUid() == uid || isExec()`. This means any executive can read any student's full profile. This is by design for executive operations, but it increases the blast radius of a compromised executive account.

**Finding:** **Potential IDOR gap in `payments` collection:** The read rule allows `resource.data.studentUid == myUid() || isExec()`. Any executive can read all payments. Again, this is by design for the Treasurer and Chairperson, but it means the Treasurer role has access to the entire financial history of every student.

**Finding:** **The `libraryFiles` collection allows any signed-in active user to read all files.** This is acceptable for a shared library, but the `libraryReports` collection (spam reports) can be created by any user and only read by admins/librarians. This creates a spam vector.

**Strategic Recommendation:** Consider splitting the `students` collection into **public profile** (name, department, year) and **private profile** (email, phone, compNumber) with different read rules. For payments, consider encrypting sensitive fields at the application layer so that even executives cannot read raw payment details without an additional decryption key.

### 5.7 Scalability (The "3,000 Students" Test)

**Finding:** Firebase Firestore handles 3,000 concurrent connections natively. There are no connection pools to exhaust. The system is horizontally scalable by design.

**Finding:** There is **no reliance on local server memory** for session state. Firebase Auth tokens are stateless. The Cloudflare Worker rate limiter uses in-memory Maps, but this is per-isolate and not authoritative.

**Finding:** The **Firestore indexes are minimal** — only 3 composite indexes for `payments`. As the data grows, more indexes will be needed for queries on `libraryFiles`, `placements`, `vacancies`, and `activities`. Firebase will throw index warnings in the console; these must be monitored and added proactively.

**Finding:** The `firebase-messaging-sw.js` service worker handles background push notifications. At 3,000 users, FCM topic subscriptions (if ever used) should be managed carefully to avoid hitting FCM broadcast limits.

**Estimated Server Specs / Costs:** No server specs are needed for Firebase Hosting + Firestore. However, at 3,000 active users:
- **Firestore reads:** 3,000 users × 10 queries/day × 50 docs/query = 1.5M reads/day. This exceeds the free tier and will cost approximately **$0.60–$1.20 per day** depending on document size. Unoptimized full-collection queries will push this much higher.
- **Firebase Auth:** Free tier handles 50K users/month. 3,000 users is well within limits.
- **Cloudflare Worker:** Free tier includes 100,000 requests/day. 3,000 users × 20 requests/day = 60,000/day. Within free tier, but monitor R2 storage costs.
- **Google Apps Script:** 60 emails/hour limit. At 3,000 students, bulk email operations (e.g., all receipts) will require throttling across multiple hours or multiple Apps Script deployments.

**Strategic Recommendation:** Before launch, run a **load test with 100 simulated concurrent users** performing the most common operations (login, dashboard load, payment submission, file upload). Monitor the Firebase Console metrics for read/write counts and latency. Use Firebase Performance Monitoring to identify slow queries.

### 5.8 Dependency & Supply Chain

**Finding:** The web application loads the following external dependencies without Subresource Integrity (SRI) hashes:
- Firebase JS SDK (10.12.2) from `https://www.gstatic.com/firebasejs/`
- `xlsx@0.18.5` from `https://cdn.jsdelivr.net/npm/`
- `html5-qrcode@2.3.8` from `https://unpkg.com/`
- `jszip@3.10.1` from `https://cdn.jsdelivr.net/npm/`
- `qrcodejs@1.0.0` from `https://cdn.jsdelivr.net/npm/`

**Finding:** The npm dependencies (`package.json`) are minimal: `@capacitor/android`, `@capacitor/cli`, `@capacitor/core`, `@capacitor/push-notifications`. There is no evidence of outdated or vulnerable packages in the Capacitor ecosystem.

**Finding:** The Cloudflare Worker has **no `package.json` or dependency manifest**. It is a pure JavaScript module with no external npm dependencies. This is a supply-chain security advantage.

**Strategic Recommendation:** Add SRI `integrity` attributes to all CDN script tags. For the Firebase SDK, pin to an exact version and verify the hash. For the Capacitor Android project, run `npm audit` periodically and keep Capacitor plugins updated.

### 5.9 Input Sanitization

**Finding:** The application uses **Firestore as a NoSQL document database**. There is no SQL injection risk because there are no SQL queries. All data access is through the Firebase SDK with document references.

**Finding:** **XSS risk exists via `innerHTML` usage.** The codebase uses `innerHTML` extensively to render dynamic content (dashboards, tables, forms). While an `esc()` function is used in most places to HTML-escape text content, there are gaps:
- `admin.js` generates `onclick="editStu('${eid}','${ecol}')"` with string interpolation. If a user ID or collection name contained malicious content, this could lead to XSS.
- `activities-editor.js` uses `onclick="document.getElementById('ae-posterInput').click()"` on a dynamically generated div.
- `faq.js` uses `onclick="toggleFaq('${item.id}')"` where `item.id` is a Firestore document ID.

**Finding:** The `view.html` file viewer uses `decodeURIComponent(n)` from the URL parameter and sets `document.title = fname`. If `n` is crafted to break out of the title context, this could be an injection vector.

**Strategic Recommendation:** Replace all inline `onclick` handlers with `addEventListener` attached to parent elements (event delegation). For `view.html`, validate that `n` is a valid filename before using it in `document.title`. Consider using a lightweight DOM builder library or template engine with automatic escaping instead of raw `innerHTML` string concatenation.

### 5.10 Secrets Management

**Finding:** There are **no `.env` files in the Git repository**. The `.gitignore` correctly excludes `node_modules/`, build artifacts, and IDE files.

**Finding:** The Cloudflare Worker secrets (`FIREBASE_SA_EMAIL`, `FIREBASE_SA_KEY`, `ADMIN_DELETE_SECRET`, `GEMINI_API_KEY`) are stored as **Worker environment variables**, not in the source code. This is correct.

**Finding:** The **Google Apps Script `RELAY_TOKEN` is stored in Script Properties**, not in the source code. This is correct.

**Finding:** The **admin delete token is cached in Firestore `settings/adminApi`** and read by the admin panel. While this document is admin-readable only, it creates a **two-tier secret**: the token lives in both the Worker environment and Firestore. This increases the attack surface.

**Finding:** The **Firebase service account private key (`FIREBASE_SA_KEY`) is stored in the Cloudflare Worker environment**. This key has broad access to the Firebase project (Auth, FCM). If the Worker environment is compromised, the attacker gains full Firebase Auth control.

**Finding:** Git history inspection shows no evidence of committed secrets, passwords, or API keys in past commits.

**Strategic Recommendation:** Remove the admin delete token from Firestore entirely. The admin panel should call the Worker directly; the Worker should validate the admin's Firebase ID token and role, then perform the privileged action. The Firebase service account key should be rotated immediately and stored with the highest access restrictions. Consider using **Cloudflare Secrets** with rotation policies.

### 5.11 Android App Specifics

**Finding:** The Android app is a **Capacitor 8 webview wrapper**. It bundles the exact same HTML/JS/CSS assets as the web version. There is no native Android business logic — the app is the web app running in a Chromium WebView.

**Finding:** `google-services.json` is embedded in the APK. It contains a Firebase API key (`AIzaSyA3upfeVlUhcy2uNpqkoje_YMhy486GHJo`). This key is different from the web API key but serves the same purpose. **There is no SSL pinning implemented.**

**Finding:** `capacitor.config.json` has `allowMixedContent: false`, which prevents HTTP content from loading inside the HTTPS WebView. This is correct.

**Finding:** The `AndroidManifest.xml` requests permissions: `INTERNET`, `CAMERA`, `READ_EXTERNAL_STORAGE`, `READ_MEDIA_IMAGES`, `POST_NOTIFICATIONS`, `RECEIVE_BOOT_COMPLETED`, `VIBRATE`. The camera and storage permissions are justified by the file upload functionality. The `RECEIVE_BOOT_COMPLETED` permission should be reviewed — it is not needed for the current feature set and increases the attack surface.

**Finding:** `minSdkVersion = 24` (Android 7.0). This is acceptable but means the app runs on devices with older security patch levels.

**Finding:** `minifyEnabled false` in the release build. The APK contains unobfuscated JavaScript, HTML, and CSS assets. An attacker can decompile the APK and read the entire client-side codebase, including `config.js` with the Firebase configuration and Worker URL.

**Strategic Recommendation:** Implement **SSL pinning** at the native Android layer (via `NetworkSecurityConfig` or a custom `OkHttp`/`WebViewClient` certificate validator) to prevent Man-in-the-Middle attacks on public Wi-Fi. Enable `minifyEnabled true` and ProGuard/R8 code shrinking for the release build to reduce APK size and obfuscate the bundled web assets. Remove `RECEIVE_BOOT_COMPLETED` if not needed.

### 5.12 Logging & GDPR

**Finding:** An **audit log collection (`auditLog`)** exists. Firestore rules enforce append-only behavior (users can create entries for themselves, no one can update or delete). This is a good pattern.

**Finding:** The `audit()` function in `public/js/audit.js` has a **sanitization layer** that strips keys named `password`, `token`, `secret`, `key`, `idToken`, `accessToken`, and `Authorization` before writing to Firestore. This prevents accidental logging of credentials.

**Finding:** **Failed login attempts are not logged to the audit collection.** Only successful `login` and `mfa_failed` events are logged. Failed password attempts are invisible to the audit trail.

**Finding:** The **Google Apps Script email relay logs to `Logger.log`**. These logs are internal to the Apps Script project and not exposed externally, but they may contain email addresses and names.

**Finding:** The **Cloudflare Worker does not log request bodies or tokens**. Errors are returned to the client but not persisted.

**Finding:** **GDPR / Data Protection consideration:** The `students` collection contains PII (name, email, computer number, gender, department, year of study). The `payments` collection contains financial data. The `compIndex` collection is public. There is no explicit data retention policy or user data export/deletion workflow beyond the admin delete function.

**Strategic Recommendation:** Log all failed login attempts to the `auditLog` collection with a rate-limit (e.g., max 1 failed attempt log per minute per IP to prevent log flooding). Implement a **data retention policy** for the `auditLog` collection (e.g., auto-delete after 2 years). Document the GDPR compliance posture: what data is collected, why, how long it is retained, and how users can request deletion.

### 5.13 CORS (Cross-Origin Resource Sharing)

**Finding:** The Cloudflare Worker has a **strict origin whitelist** for CORS:
- `https://uzes-friendly-web.web.app`
- `https://uzes-friendly-web.firebaseapp.com`
- `https://localhost` (for Capacitor Android)
- `capacitor://localhost` (for Capacitor iOS)
- `http://localhost` / `http://127.0.0.1` (for development)

This is well-configured. The `Vary: Origin` header is present.

**Finding:** Firebase Hosting sets a **Content Security Policy** via HTTP headers. The policy is:
- `default-src 'self'`
- `script-src 'self' 'unsafe-inline' blob: https://www.gstatic.com https://apis.google.com https://cdn.jsdelivr.net https://cdnjs.cloudflare.com https://accounts.google.com https://unpkg.com`
- `style-src 'self' 'unsafe-inline' https://fonts.googleapis.com https://fonts.gstatic.com`
- `img-src 'self' data: blob: https://*.workers.dev https://*.web.app https://*.firebaseapp.com https://*.googleapis.com`
- `connect-src 'self' https://*.googleapis.com https://*.google.com https://*.firebaseio.com wss://*.firebaseio.com https://*.workers.dev`
- `frame-src https://www.youtube.com https://*.firebaseapp.com https://*.google.com https://uzes-upload.uzesofficial.workers.dev`
- `frame-ancestors 'none'`
- `object-src 'none'`
- `base-uri 'self'`

**Finding:** The CSP **allows `'unsafe-inline'` for both scripts and styles**. This significantly weakens XSS protection. An attacker who can inject a `<script>` tag or inline event handler will not be blocked by the CSP.

**Strategic Recommendation:** Remove `'unsafe-inline'` from `script-src` by using nonce-based CSP or moving all inline scripts to external `.js` files. For `style-src`, `'unsafe-inline'` is often required for dynamic theming; consider using a nonce or hash for inline styles. Add `report-uri` or `report-to` to the CSP to monitor violations in production.

---

## 6. Strategic Recommendations (No Code)

### 6.1 Immediate Pre-Launch (Critical)

1. **Email Relay Architecture Redesign:** Move the email relay URL and token into the Cloudflare Worker environment variables. The Worker should be the only entity that communicates with Google Apps Script. Remove the `settings/emailRelay` document from Firestore or make it empty. Update the client so that all email requests go through the Worker (`/email` endpoint), not directly to Apps Script.

2. **Separate Admin Secrets:** In the Cloudflare Worker dashboard, create two distinct environment variables: one for account deletion and one for password reset. Ensure they are cryptographically random and never stored in Firestore. The password-reset endpoint should additionally verify that the requesting user's Firebase ID token belongs to an active admin/executive.

3. **Encrypt TOTP Secrets:** Implement application-layer encryption for the `totpSecret` field. Use a symmetric encryption key stored exclusively in the Cloudflare Worker environment. During 2FA enrollment, the client sends the secret to the Worker; the Worker encrypts it and writes the ciphertext to Firestore. During login, the client sends the 6-digit code to the Worker; the Worker decrypts the secret and verifies the code. The client should never see the raw secret after enrollment.

4. **Enable Firebase App Check:** Register the web app in Firebase App Check with reCAPTCHA v3. Register the Android app with Play Integrity or App Attest. Populate the site key in `config.js` and enable **enforcement** in the Firebase Console (not just monitoring). This is the single most impactful security upgrade.

5. **Implement Firestore Query Limits:** Add pagination to every collection query that currently loads all documents. Use `limit(50)` and `startAfter()` for all list views. For dashboards that need aggregate counts (total payments, total income), create a `counters` collection that is updated incrementally via transactions, rather than counting documents on the client.

### 6.2 High-Priority Post-Launch (Week 1)

6. **Add Subresource Integrity (SRI):** For every CDN script tag in the HTML files, compute the SHA-384 hash of the exact file version and add `integrity="sha384-..." crossorigin="anonymous"`. This prevents supply-chain attacks if the CDN is compromised.

7. **Harden the CSP:** Remove `'unsafe-inline'` from `script-src` by extracting all inline `<script>` blocks into external `.js` files. For the few inline scripts that must remain (e.g., `view.html`), generate a CSP nonce on the server (Firebase Hosting functions) or use a strict hash. Add `report-uri` to monitor violations.

8. **Restrict Executive Data Exposure:** Split the `students` collection into `studentProfiles` (public: name, department, year) and `studentPrivate` (private: email, phone, compNumber). Only the student and specific roles (Treasurer for payments, Secretary for placements) should have read access to the private sub-collection. This reduces the blast radius of a compromised executive account.

9. **Android SSL Pinning:** Add a `network_security_config.xml` to the Android project with pinned certificates for `uzes-friendly-web.firebaseapp.com`, `uzes-upload.uzesofficial.workers.dev`, and `firestore.googleapis.com`. This prevents MITM attacks on public Wi-Fi networks.

10. **Enable ProGuard / R8:** Set `minifyEnabled true` and `shrinkResources true` in the Android release build. This reduces APK size and makes reverse engineering harder.

11. **Fix the Per-File Delete Ownership Check:** Update the Cloudflare Worker `/delete` endpoint (per-file branch) to read the `customMetadata.uploadedBy` from R2 and compare it against the requesting user's UID. If they do not match, reject the request unless the user is an admin.

12. **Add Failed Login Audit Logging:** Extend the `auditLog` collection to include failed login attempts. To prevent log flooding, debounce: log only the first failure per IP per minute, or log a summary batch every 5 minutes.

13. **Remove the `REQUIRE_AUTH` Escape Hatch:** Delete the `if (env.REQUIRE_AUTH === "false")` branch from the Cloudflare Worker. This escape hatch is a latent backdoor.

### 6.3 Medium-Priority (Month 1)

14. **Implement Global Rate Limiting:** Replace the in-memory Worker rate limiter with a Cloudflare Durable Object or a Cloudflare Rate Limiting rule. This prevents distributed bypass.

15. **Add reCAPTCHA v3 to Login:** Before calling `signInWithEmailAndPassword`, obtain a reCAPTCHA v3 token and send it to a Worker endpoint for verification. If the score is low (< 0.5), require an additional challenge or block the request.

16. **Automated Firestore Backups:** Enable Firebase's automated backup feature (via Google Cloud Console) or schedule a daily Cloud Function that exports critical collections to Cloud Storage. Test the restore process quarterly.

17. **File Viewer Hardening:** In `view.html`, validate the `k` and `n` URL parameters before using them. Ensure `k` is a valid base64 string that decodes to a URL within the allowed Worker domain. Sanitize `n` with a strict filename regex before using it in `document.title` or DOM insertion.

18. **Admin Panel XSS Hardening:** Replace all dynamically generated `onclick="..."` attributes in `admin.js` with event delegation. Attach a single `click` listener to the parent container and use `event.target.dataset.action` to determine which action to take.

19. **Add a Data Retention Policy:** Document and implement a retention schedule: delete `auditLog` entries after 2 years, delete `payments` proof images after 7 years, and archive old `placements` documents after the academic year ends.

20. **Security Headers Review:** Add `Permissions-Policy` to the default headers in `firebase.json` (it is already present for `executive.html` but not globally). Add `X-Content-Type-Options: nosniff` globally (already present). Consider adding `Cross-Origin-Embedder-Policy` and `Cross-Origin-Opener-Policy` for additional isolation.

### 6.4 Continuous Monitoring

21. **Firebase Security Rules Alerts:** Enable Firebase Alerts for security rule violations. Monitor the Cloud Monitoring dashboard for spikes in read/write counts.

22. **Bug Bounty / Penetration Test:** After fixing the Critical issues, engage a third-party penetration testing firm or run a bug bounty program for 2 weeks before the public launch.

23. **Incident Response Plan:** Document the incident response workflow: who disables accounts, who rotates secrets, who communicates with users, and how backups are restored. Store this offline (not in the GitHub repo).

---

## 7. Summary

The UZES platform is a thoughtfully built system with clear architectural patterns and good security hygiene in many areas (magic-byte file checks, role-based Firestore rules, audit logging, TOTP 2FA). However, **five critical issues related to secrets management, access control, and abuse prevention must be resolved before the platform can safely handle 3,000 concurrent students**.

The platform will scale technically, but the financial and security risks of un-paginated queries, exposed email relay tokens, and disabled App Check create a launch-day attack surface that is unacceptable for a student-facing financial system.

**Recommendation: Conditional NO-GO. Fix C-1 through C-5, then re-audit.**

---

*End of Security Audit Report.*
