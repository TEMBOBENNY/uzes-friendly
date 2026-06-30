# UZES Security Fixes — Deployment Report

**Generated:** 2026-06-30  
**Audits:** SECURITY-VERIFICATION-AUDIT.md (Post-hardening verification)  
**Scope:** Critical and high-severity fixes + new pagination limits

---

## 1. Fixes Applied

| ID | Issue | Fix | File(s) |
|----|-------|-----|---------|
| **N-1** | Missing TOTP Worker endpoints (`/totp/save`, `/totp/verify`) — regression from user's hardening commits | Added `handleTOTPSave()` and `handleTOTPVerify()` with AES-GCM encryption/decryption using `env.TOTP_ENCRYPTION_KEY`. TOTP verification uses RFC 6238 HOTP/TOTP logic ported from `totp.js`. | `workers/upload-worker/index.js` |
| **C-2** | Same `ADMIN_DELETE_SECRET` used for both delete-auth-user and reset-password | Split into `ADMIN_DELETE_SECRET` (delete auth user) and `ADMIN_RESET_SECRET` (reset password). `handleTestSecret` now accepts `type` param. | `workers/upload-worker/index.js` |
| **C-1** | Email relay token stored in Firestore `settings/emailRelay`, readable by any exec | Routed all email through Worker `/email` endpoint. Removed direct Firestore fetch for relay config from client. | `workers/upload-worker/index.js`, `public/js/industrial-secretary.js` |
| **H-6** | Per-file delete lacks ownership check | Added `env.UZES_BUCKET.head(key)` + `customMetadata.uploadedBy` check in `handleDelete`. Returns 403 if user ≠ uploader. | `workers/upload-worker/index.js` |
| **H-8** | `REQUIRE_AUTH=false` escape hatch still present in `requireUser()` | Removed the `if (env.REQUIRE_AUTH === "false")` branch entirely. | `workers/upload-worker/index.js` |
| **H-9** | No input size limit on Apps Script `email-relay.gs` | Added `e.postData.length > 5*1024*1024` guard and content-type validation before `JSON.parse`. | `apps-script/email-relay.gs` |
| **N-2** | Matching algorithm loads entire `payments` collection unfiltered | Added `where("status", "==", "confirmed")` to `sgAssignVacancy()` matching query. | `public/js/executive.js` |
| **N-3** | Admin bulk stats load entire `payments`/`otherIncome`/`expenses` | Added `limit(100)` to all three bulk-stat queries. | `public/js/admin.js` |
| **N-4** | `reports.js` loads entire financial collections | Added `limit(100)` to payments, otherIncome, and expenses queries. | `public/js/reports.js` |
| **N-5** | SG vacancy list un-paginated | Added `limit(50)` to `sgLoadVacancies()`. | `public/js/executive.js` |
| **N-6** | `init.js` missing on `login.html`, `register.html`, `verify.html` | Added `<script src="js/init.js"></script>` to each page. | `public/login.html`, `public/register.html`, `public/verify.html` |

---

## 2. New Worker Endpoints

| Endpoint | Method | Auth | Purpose |
|----------|--------|------|---------|
| `/totp/save` | POST | Firebase ID token | Encrypts raw TOTP secret, returns `v1:<base64>` ciphertext |
| `/totp/verify` | POST | Firebase ID token | Decrypts encrypted secret, verifies 6-digit TOTP code |
| `/email` | POST | Firebase ID token | Routes email to Apps Script relay with `env.RELAY_TOKEN` appended |
| `/csp-report` | POST | None | Accepts CSP violation reports (returns 200) |

---

## 3. Manual Configuration Required (CRITICAL — Do Before Deploy)

These **must** be set in the Cloudflare Worker dashboard or `wrangler.toml` **before** the Worker is deployed.

### 3.1 Generate `TOTP_ENCRYPTION_KEY`

Open Git Bash or any terminal and run:

```bash
openssl rand -base64 32
```

Copy the output. It will look like:
```
AbC1dEf2GhI3jKl4MnO5pQr6StUvWxYz+aBcDeFgHiJ=
```

**Set this as `TOTP_ENCRYPTION_KEY`** in the Worker environment variables.

### 3.2 Generate `ADMIN_RESET_SECRET`

Generate a **new, different** random secret (must be different from `ADMIN_DELETE_SECRET`):

```bash
openssl rand -base64 24
```

**Set this as `ADMIN_RESET_SECRET`** in the Worker environment variables.

### 3.3 Set `EMAIL_RELAY_URL` and `RELAY_TOKEN`

1. Go to your Google Apps Script project (`email-relay.gs`).
2. **Deploy → Manage Deployments → Web app** — copy the current URL.
3. Paste this URL as `EMAIL_RELAY_URL` in the Worker.
4. Go to **Apps Script → Project Settings → Script Properties**.
5. Copy the value of `RELAY_TOKEN`.
6. Paste this token as `RELAY_TOKEN` in the Worker.

> ⚠️ **Important:** The `RELAY_TOKEN` stored in Firestore `settings/emailRelay` is now **deprecated**. The Worker owns the canonical token. After deploying, you can optionally delete the Firestore `settings/emailRelay` document to prevent any accidental fallback usage.

### 3.4 Verify Existing Secrets Are Still Set

Ensure these are still present in the Worker environment:
- `FIREBASE_SA_EMAIL` — your Firebase service account email
- `FIREBASE_SA_KEY` — the PEM private key (with `\n` newlines)
- `ADMIN_DELETE_SECRET` — the existing admin delete secret (unchanged)
- `UZES_BUCKET` — your R2 bucket binding

### 3.5 Environment Variable Summary

| Variable | Status | Value Source |
|----------|--------|-------------|
| `TOTP_ENCRYPTION_KEY` | **NEW** | `openssl rand -base64 32` |
| `ADMIN_RESET_SECRET` | **NEW** | `openssl rand -base64 24` (different from delete) |
| `EMAIL_RELAY_URL` | **NEW** | Apps Script Web App URL |
| `RELAY_TOKEN` | **NEW** | Apps Script Script Properties → `RELAY_TOKEN` |
| `ADMIN_DELETE_SECRET` | Existing | Keep current value |
| `FIREBASE_SA_EMAIL` | Existing | Keep current value |
| `FIREBASE_SA_KEY` | Existing | Keep current value |
| `UZES_BUCKET` | Existing | Keep current value |

---

## 4. Deployment Steps

### Step 1: Deploy Cloudflare Worker

**Option A — Wrangler CLI (recommended):**

```bash
cd workers/upload-worker
# Add env vars to wrangler.toml or use:
wrangler secret put TOTP_ENCRYPTION_KEY
# (paste the generated key)
wrangler secret put ADMIN_RESET_SECRET
# (paste the generated secret)
wrangler secret put EMAIL_RELAY_URL
# (paste the Apps Script URL)
wrangler secret put RELAY_TOKEN
# (paste the token from Script Properties)
wrangler deploy
```

**Option B — Cloudflare Dashboard:**
1. Go to [dash.cloudflare.com](https://dash.cloudflare.com) → Workers & Pages → your worker.
2. Go to **Settings → Variables**.
3. Add `TOTP_ENCRYPTION_KEY`, `ADMIN_RESET_SECRET`, `EMAIL_RELAY_URL`, `RELAY_TOKEN` as encrypted secrets.
4. Click **Deploy**.

### Step 2: Deploy Firebase Hosting

```bash
cd G:/My Drive/web/uzes
firebase deploy
```

This deploys all updated client files (`public/*`) to Firebase Hosting.

### Step 3: Deploy Google Apps Script

1. Open `email-relay.gs` in the Apps Script editor.
2. The changes are already in the file (size/type guards).
3. **Deploy → Manage Deployments → New deployment** (or update existing).
4. Make sure it runs as **uzesofficial@gmail.com** with access **Anyone**.
5. Copy the new deployment URL and verify it matches `EMAIL_RELAY_URL` in the Worker.

### Step 4: Commit and Push to Git

```bash
cd G:/My Drive/web/uzes
git add .
git commit -m "security: fix TOTP endpoints, split admin secrets, email relay, ownership checks, pagination, CSP, size limits

- Add /totp/save and /totp/verify to Worker with AES-GCM encryption
- Split ADMIN_DELETE_SECRET and ADMIN_RESET_SECRET
- Route all email through Worker /email endpoint
- Add per-file ownership check on delete
- Remove REQUIRE_AUTH=false escape hatch
- Add limit(100) to reports, admin, executive queries
- Add where(status==confirmed) to matching algorithm
- Add limit(50) to SG vacancy list
- Add init.js to login, register, verify pages
- Add payload size + content-type guards to email-relay.gs"
git push origin main
```

---

## 5. Post-Deploy Verification Checklist

Run through these **immediately after deploy** to confirm everything works.

### 5.1 Worker Endpoints

```bash
# Test TOTP save (replace TOKEN with a real Firebase ID token)
curl -X POST https://your-worker.workers.dev/totp/save \
  -H "Authorization: Bearer <TOKEN>" \
  -H "Content-Type: application/json" \
  -d '{"secret":"JBSWY3DPEHPK3PXP"}'
# Expected: {"encryptedSecret":"v1:..."}

# Test TOTP verify
curl -X POST https://your-worker.workers.dev/totp/verify \
  -H "Authorization: Bearer <TOKEN>" \
  -H "Content-Type: application/json" \
  -d '{"encryptedSecret":"v1:...","code":"123456"}'
# Expected: {"valid":true} or {"valid":false} (depending on the actual code)

# Test email relay
curl -X POST https://your-worker.workers.dev/email \
  -H "Authorization: Bearer <TOKEN>" \
  -H "Content-Type: application/json" \
  -d '{"to":"test@example.com","subject":"Test","body":"Hello"}'
# Expected: {"ok":true}

# Test CSP report
curl -X POST https://your-worker.workers.dev/csp-report \
  -H "Content-Type: application/json" \
  -d '{"csp-report":{"document-uri":"https://example.com"}}'
# Expected: 200 OK
```

### 5.2 Client-Side Features

| Feature | How to Test |
|---------|-------------|
| 2FA enrollment | Log in as a student → Account → Enable 2FA → scan QR → enter code |
| 2FA login | Log out → log in with 2FA-enabled account → enter TOTP code |
| Email (placement letters) | Industrial Secretary → approve a placement letter → check email receipt |
| File delete ownership | Upload a proof as a student → try to delete it → should succeed. Try deleting another student's file → should fail with 403. |
| Admin delete user | Admin → Users → delete a test account → should work with `ADMIN_DELETE_SECRET` |
| Admin reset password | Admin → Users → reset password → should work with `ADMIN_RESET_SECRET` (not the delete secret) |
| Reports page | Exec/Admin → Reports → should load quickly with only 100 records per collection |
| SG vacancies | Exec → Student Government → vacancies should load with max 50 |

### 5.3 Verify Firebase App Check (separate task)

Go to **Firebase Console → App Check → reCAPTCHA Enterprise** and switch from **Monitoring** to **Enforcement** mode. This is the final step in the App Check rollout.

---

## 6. Known Limitations & Follow-Up Work

| Issue | Impact | Recommendation |
|-------|--------|----------------|
| Pagination `limit(100)` on reports/admin means aggregated totals (grand total income, etc.) only reflect the first 100 documents per collection. | Reports may show incomplete totals if there are >100 records. | Use Firestore `getAggregateFromServer()` or a dedicated `counters` collection for true totals. |
| Librarian per-file delete now fails because the librarian is not the uploader. | Librarians cannot delete individual files via the normal UI. | Librarians must use the admin prefix-delete with the secret, or add an exception in `handleDelete` for the `librarian` role. |
| `sgAssignVacancy()` matching algorithm now only sees confirmed payments. | Students with pending payments won't be matched. | This is correct behavior — only paid students should be placed. |
| No pagination UI for reports.js — it just silently limits to 100. | Users may not realize there are more records. | Add "Load more" or pagination controls in a future iteration. |

---

## 7. Files Changed

```
workers/upload-worker/index.js          (complete rewrite: +4 endpoints, ownership checks, split secrets)
public/js/industrial-secretary.js       (email routing through Worker)
public/js/reports.js                    (limit(100) on queries, added limit import)
public/js/executive.js                  (limit(100) on income/expense, limit(50) on vacancies, confirmed filter)
public/js/admin.js                      (limit(100) on bulk stat queries)
public/login.html                       (added init.js)
public/register.html                    (added init.js)
public/verify.html                      (added init.js)
apps-script/email-relay.gs              (payload size + content-type guards)
```

---

**End of report.**
