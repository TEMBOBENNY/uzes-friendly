# UZES Session Report — Android APK, App Check & Build Fixes

**Date:** 2026-06-30 (Part 2 — continuation after context overflow)  
**Covers:** This session picked up immediately after the previous session (`SESSION-REPORT-2026-06-30.md`) ran out of context.  
**Status at end of session:** APK build in progress (`bee8013`); App Check web fix pending user action.

---

## What Was Carried Over From Previous Session

| Item | Status at start of this session |
|------|----------------------------------|
| Exec dashboards frozen on skeleton (missing `esc()`) | Already fixed — `esc()` at line 110 of `executive.js` |
| TS dashboard showing "As an executive you can also" | Already fixed — "Account" card at line 75 of `industrial-secretary.js` |
| GitHub Actions build broken by Play Store code (`9d5f76f`) | Already reverted to simple debug APK workflow (`5c79bc6`) |
| User said APK was "outdated" | Confirmed all fixes were committed; user needed to download new artifact |

---

## Chapter 1 — Repo Verification & Git Remote Fix

**Problem:** git push was failing with "Could not connect to server", and when checking the remote URL it showed:
```
origin  https://<YOUR_GITHUB_TOKEN>@github.com/TEMBOBENNY/uzes-friendly.git
```
The placeholder was never replaced with a real token. Git's Schannel SSL backend was also causing intermittent connection failures.

**Fixes applied:**
- Removed the token placeholder from the remote URL:  
  `git remote set-url origin https://github.com/TEMBOBENNY/uzes-friendly.git`
- Switched git SSL backend globally from Schannel → OpenSSL:  
  `git config --global http.sslBackend openssl`
- All subsequent pushes use: `git -c http.sslBackend=openssl push origin main`

---

## Chapter 2 — Kimi's Incomplete App Check Work

The user had used another AI (Kimi) to begin Firebase App Check setup for Android. Kimi was cut off mid-session. The changes Kimi made were in the working tree but uncommitted:

**`android/app/src/main/java/com/uzes/app/MainActivity.java`** — changed from:
```java
package com.uzes.app;
import com.getcapacitor.BridgeActivity;
public class MainActivity extends BridgeActivity {}
```
To (Kimi's version):
```java
package com.uzes.app;
import android.os.Bundle;
import com.google.firebase.appcheck.FirebaseAppCheck;
import com.google.firebase.appcheck.playintegrity.PlayIntegrityAppCheckProviderFactory;
import com.getcapacitor.BridgeActivity;

public class MainActivity extends BridgeActivity {
    @Override
    protected void onCreate(Bundle savedInstanceState) {
        super.onCreate(savedInstanceState);
        FirebaseAppCheck.getInstance().installAppCheckProviderFactory(
            PlayIntegrityAppCheckProviderFactory.getInstance()
        );
    }
}
```

**`android/app/build.gradle`** — Kimi added:
```groovy
implementation 'com.google.firebase:firebase-app-check-playintegrity:18.0.0'
```

---

## Chapter 3 — Debug Keystore & Stable SHA-256

**Problem:** GitHub Actions generates a fresh `debug.keystore` on every build, so the APK's SHA-256 signing fingerprint changes with each build. This makes it impossible to register a stable fingerprint in Firebase App Check.

**Fix:** Generated a stable debug keystore locally and stored it as a GitHub Secret so CI restores it before every build.

**Steps taken:**
1. Generated keystore at `C:\Users\MECTECH\.android\debug.keystore`:
   ```
   keytool -genkey -v -keystore C:\Users\MECTECH\.android\debug.keystore
     -storepass android -alias androiddebugkey -keypass android
     -keyalg RSA -keysize 2048 -validity 10000
     -dname "CN=Android Debug,O=Android,C=US"
   ```
2. SHA-256 fingerprint extracted:
   ```
   A2:BB:01:2A:BA:C2:14:26:9C:14:FA:09:C1:60:1E:50:3A:F8:88:BF:65:A9:53:4F:18:99:E7:FA:86:34:B9:ED
   ```
3. Base64-encoded keystore stored as GitHub Secret `DEBUG_KEYSTORE_BASE64`
4. Workflow updated to restore it before Gradle runs:
   ```yaml
   - name: Restore debug keystore
     run: |
       mkdir -p $HOME/.android
       echo "${{ secrets.DEBUG_KEYSTORE_BASE64 }}" | base64 --decode > $HOME/.android/debug.keystore
   ```

**User actions completed:**
- Added `DEBUG_KEYSTORE_BASE64` secret to GitHub → Settings → Secrets
- Registered `com.uzes.app` in Firebase App Check with Play Integrity provider + SHA-256 fingerprint
- Confirmed reCAPTCHA domains (all three already listed): `uzes-friendly-web.web.app`, `uzes-friendly-web.firebaseapp.com`, `localhost`

**Commit:** `ed12b11` — "Android App Check: Play Integrity provider + stable debug keystore in CI"

---

## Chapter 4 — Build Failure #1: Version 18.0.0 Doesn't Exist

**Error:**
```
Could not find com.google.firebase:firebase-app-check-playintegrity:18.0.0.
Searched in:
  - https://dl.google.com/dl/android/maven2/.../18.0.0/...pom  ← 404
  - https://repo.maven.apache.org/maven2/.../18.0.0/...pom     ← 404
```

**Root cause:** Kimi invented version `18.0.0`. It has never been released on Google Maven.

**Fix attempt:** Changed to `17.0.0`:
```groovy
implementation 'com.google.firebase:firebase-app-check-playintegrity:17.0.0'
```

**Commit:** `14ccce2`

---

## Chapter 5 — Build Failure #2: Version 17.0.0 Also Doesn't Exist

Same error as above but with `17.0.0`. Neither 17 nor 18 exist as standalone versions for `firebase-app-check-playintegrity`.

**Root cause analysis:** The `firebase-app-check-playintegrity` library requires the Firebase Android BoM (Bill of Materials) to resolve correctly. Without a BoM declaration in the project, standalone version strings for this library are unreliable. Additionally, Play Integrity attestation does NOT work for sideloaded debug APKs — it only works for apps distributed through the Google Play Store. Adding this library now provides no benefit.

**Final fix:** Removed the library entirely and reverted `MainActivity.java` to the simple version:

```java
// MainActivity.java — reverted
package com.uzes.app;
import com.getcapacitor.BridgeActivity;
public class MainActivity extends BridgeActivity {}
```

```groovy
// build.gradle — Play Integrity line removed
```

**When to add back:** When the app is published to Google Play Store. At that point, use the Firebase BoM to manage versions:
```groovy
// Future (Play Store release)
implementation platform('com.google.firebase:firebase-bom:XX.X.X')  // use latest BoM
implementation 'com.google.firebase:firebase-app-check-playintegrity'
```

**Commit:** `bee8013` — "Remove firebase-app-check-playintegrity - no valid version exists for sideloaded APK, add back when on Play Store"

---

## Chapter 6 — App Check 400 Error Investigation

**Symptom:** Console shows `[App Check] initialized successfully` but immediately after:
```
POST https://content-firebaseappcheck.googleapis.com/v1/projects/.../exchangeRecaptchaV3Token  →  400 (Bad Request)
AppCheck: Requests throttled due to 400 error
```

**Firebase App Check metrics:**
- Firestore: 0% verified / 79% invalid (1.3k/1.6k requests)
- Authentication: 0% verified / 84% invalid (119/141 requests)
- Both in Monitoring mode (users NOT blocked)

**Key finding — wrong key type in Firebase App Check:**

The reCAPTCHA admin console shows two keys:
| Key | Value | Where it goes |
|-----|-------|---------------|
| Site key | `6LejNzwtAAAAAGcxw8GBiKqdvPwoBrmOQxC_qO1E` | Client code (`config.js`) — CORRECT ✓ |
| Secret key | `6LejNzwtAAAAAlKZJgVQsX9UP12iOFty3P8Q1U6Z` | Firebase App Check registration — NEEDS TO BE SET |

Firebase App Check uses the **secret key** server-side to verify reCAPTCHA tokens. If the site key was entered in Firebase App Check's "reCAPTCHA secret key" field instead of the secret key, every `exchangeRecaptchaV3Token` request returns 400.

**User action required:**
1. Firebase Console → **App Check** → **Apps** → Web app → three-dot menu → Edit
2. In the "reCAPTCHA secret key" field, paste: `6LejNzwtAAAAAlKZJgVQsX9UP12iOFty3P8Q1U6Z`
3. Save

**Important:** Do NOT change `config.js` — the site key in the client code is correct.

---

## Chapter 7 — TOTP 2FA Error

**Symptom:** Old APK showed "Verification error — check your connection" on 2FA entry.

**Root cause:** The Cloudflare Worker TOTP endpoints (`/totp/save`, `/totp/verify`) were added to the code in the previous session but had not been deployed to Cloudflare Dashboard.

**Status:** User confirmed they deployed the Worker "early morning" — this should be resolved. If the error reappears on the new APK:
1. Verify the Worker is live: `https://uzes-upload.uzesofficial.workers.dev`
2. Test: `POST /totp/verify` with a valid Firebase ID token

---

## Commit History This Session

| Commit | Description | Build result |
|--------|-------------|--------------|
| `ed12b11` | Android App Check: Play Integrity + stable keystore CI | FAILED (18.0.0 not found) |
| `14ccce2` | Fix Play Integrity version 18.0.0 → 17.0.0 | FAILED (17.0.0 not found) |
| `bee8013` | Remove Play Integrity library + revert MainActivity | In progress at session end |

---

## Files Changed This Session

| File | Change |
|------|--------|
| `.github/workflows/build-android.yml` | Added keystore restore step from `DEBUG_KEYSTORE_BASE64` secret |
| `android/app/build.gradle` | Added then removed `firebase-app-check-playintegrity` dependency |
| `android/app/src/main/java/com/uzes/app/MainActivity.java` | Added then removed Play Integrity App Check initialization |
| `UPDATES/APPCHECK-RECOVERY-GUIDE.md` | Created (by Kimi) — full guide for App Check web + Android setup |

---

## Pending Actions (for next session or user to complete)

| Priority | Action | Who |
|----------|--------|-----|
| HIGH | Firebase App Check → Web app → Edit → enter secret key `6LejNzwtAAAAAlKZJgVQsX9UP12iOFty3P8Q1U6Z` | User |
| HIGH | Download new APK from GitHub Actions (`bee8013` build) and test login + 2FA | User |
| MEDIUM | When App Check metrics show verified > 0%, switch to Enforcement for web | User |
| FUTURE | When app goes to Play Store: re-add `firebase-app-check-playintegrity` using Firebase BoM | Developer |
| FUTURE | Add Play Store release keystore and signing workflow when $25 Play Console fee is paid | Developer |

---

## Important Reference Values

| Item | Value |
|------|-------|
| Debug keystore location | `C:\Users\MECTECH\.android\debug.keystore` |
| Debug keystore SHA-256 | `A2:BB:01:2A:BA:C2:14:26:9C:14:FA:09:C1:60:1E:50:3A:F8:88:BF:65:A9:53:4F:18:99:E7:FA:86:34:B9:ED` |
| reCAPTCHA site key (client code) | `6LejNzwtAAAAAGcxw8GBiKqdvPwoBrmOQxC_qO1E` |
| reCAPTCHA secret key (Firebase App Check) | `6LejNzwtAAAAAlKZJgVQsX9UP12iOFty3P8Q1U6Z` |
| GitHub repo | `https://github.com/TEMBOBENNY/uzes-friendly` |
| Firebase project | `uzes-friendly-web` |
| Cloudflare Worker | `https://uzes-upload.uzesofficial.workers.dev` |

---

## Session Rules Established

- **Read `UPDATES/` at the start of every session** — check `SESSION-REPORT-*.md` files for context
- **git push requires `git -c http.sslBackend=openssl push`** (SSL backend globally fixed but use flag as safety net)
- **Never run `npm install` in `G:\My Drive\web\uzes`** — Google Drive EPERM; copy to `C:\Users\MECTECH\Downloads\Mobile Devices\uzes` first
- **Every deploy must also commit + push to GitHub** — triggers APK build on GitHub Actions

---

## Continuation — App Check Enforcement Fallout & Full Email Audit

After App Check enforcement was switched on (web: Firestore + Authentication), the user reported two regressions and asked for them to be fixed in a follow-up working block. This section documents that work, picking up from the "Pending Actions" table above.

### Round 1 — Three Bugs Found by Reading the Code

**Bug A — Public pages 403 ("Missing or insufficient permissions")**
`public/js/firebase-public.js` (used by `about.js`, `activities.js`, `contact.js`, `faq.js`, `support.js`) initialized Firestore but never called `initializeAppCheck()`. Under Firestore enforcement, every read from these five pages had no App Check token attached and was rejected.
**Fix:** Added the same `initializeAppCheck(app, { provider: new ReCaptchaV3Provider(RECAPTCHA_SITE_KEY) })` block used in `firebase.js`.

**Bug B — Receipt, rejection, and placement-letter emails (executive role)**
`public/js/executive.js` called `UPLOAD_WORKER_URL + "/send-email"` in three places (`confirmPayment`, `confirmReject`, `sgApprovePlacement`). The Worker's actual route is `/email` — there is no `/send-email` route, so every call 404'd silently (wrapped in `try {} catch(_) {}` with no UI feedback).
**Fix:** Changed all three to `/email`.

**Bug C — Placement-letter emails (Industrial Training Secretary role)**
`industrial-secretary.js → approvePlacement` still used the pre-Worker architecture: read `settings/emailRelay` from Firestore for a `url`/`token` pair, then `fetch(url, { mode: "no-cors", ... })` directly to Apps Script. That Firestore document no longer has a `url` field (only `isTrial`), so this threw "Email relay not configured." before even attempting to send.
**Fix:** Removed the Firestore relay read; replaced the direct fetch with the existing `sendEmail()` helper (same Worker `/email` path every other function uses).

**Commit:** `6acd8c3` — "Fix emails broken after App Check enforcement + fix public page 403"
**Deployed:** Firebase Hosting (`firebase deploy --only hosting`)

### Round 1 Worker Hardening

While reviewing the Worker's `handleEmail()`, noticed it only checked `!res.ok` (HTTP status) when forwarding to Apps Script — but Apps Script's `doPost` always returns HTTP 200, using a body field `{ ok: false, error: "..." }` to signal failure. This meant any Apps Script-side error (bad token, rate limit, thrown exception) was reported back to the client as success.
**Fix:** Added `data.ok === false` to the failure check.
**Commit:** `68cd9fc` — "Worker: propagate Apps Script error body to client"
**Deployed:** Cloudflare Worker (version `0d16600a`)

### Round 2 — User Reports Emails STILL Dead. Full Audit Requested.

User reported after Round 1: emails were still not sending, despite Apps Script's own `testEmail()` function (run directly in the Apps Script editor) successfully delivering a receipt. This meant Apps Script itself — quota, PDF generation, `MailApp.sendEmail` — was fine. The break had to be somewhere in the Worker → Apps Script call path. User asked for a full audit instead of guessing further, and to reconfigure Cloudflare/embedded keys if needed.

**Investigation method:** Listed the actual secret names configured on the Cloudflare Worker:
```
npx wrangler secret list
→ ADMIN_DELETE_SECRET, ADMIN_RESET_SECRET, EMAIL_RELAY_TOKEN, EMAIL_RELAY_URL, GEMINI_API_KEY, TOTP_ENCRYPTION_KEY
```

**Root cause found:** The Worker code in `handleEmail()` referenced `env.RELAY_TOKEN` (three places: header comment + two code lines), but the actual secret configured on Cloudflare is named **`EMAIL_RELAY_TOKEN`**. `env.RELAY_TOKEN` was therefore always `undefined`, which tripped this guard at the very top of `handleEmail()`:
```js
if (!env.EMAIL_RELAY_URL || !env.RELAY_TOKEN) {
  return json({ error: "Email relay not configured on Worker" }, 500, origin);
}
```
Every single email request — receipts, rejections, attachment letters, placement letters — returned this 500 error **before the Worker ever attempted to contact Apps Script.** Because `sendEmail()` on the client (`industrial-secretary.js`) and the inline fetch calls in `executive.js` only `console.error()` on failure with no UI surface, this was completely invisible to the user — explaining why Apps Script's direct `testEmail()` worked (it bypasses the Worker entirely) while every real in-app email silently died.

This also explains why the Round 1 Worker hardening (`data.ok === false` check) had no visible effect — the code path that check lives in was never reached; the function returned at the config-guard before ever calling `fetch(env.EMAIL_RELAY_URL, ...)`.

**Fix:** Renamed all three references from `env.RELAY_TOKEN` → `env.EMAIL_RELAY_TOKEN`, matching the real secret name.

**Verification performed:**
```
curl -X POST https://uzes-upload.uzesofficial.workers.dev/email -d '{"to":"test@example.com","type":"reject"}'
→ HTTP 401 {"error":"Unauthorized — missing Authorization token"}
```
This confirms the deploy is live and `requireUser()` (Firebase ID-token check) still runs first, as expected — full validation requires a real signed-in session, which only the live app can provide.

**Commit:** `ba6f68d` — "Fix critical Worker bug: env var name mismatch broke ALL emails"
**Deployed:** Cloudflare Worker (version `e63c9026`)

### What To Test Next (User)

Log into the live app and trigger any of: confirm a payment (receipt email), reject a payment, approve/reject an attachment letter request, or approve a placement. Two outcomes are now possible where before there was total silence:

| Console shows | Meaning |
|---|---|
| No error, email arrives | Fixed — fully working |
| `Email send failed: Unauthorized` | The **value** of `EMAIL_RELAY_TOKEN` (Cloudflare) does not match the **value** of `RELAY_TOKEN` (Apps Script → Project Settings → Script Properties). Re-paste matching values on both sides. |
| `Email send failed: Email relay not configured on Worker` | `EMAIL_RELAY_URL` secret is empty/unset on Cloudflare — re-paste the Apps Script Web App deployment URL. |
| Any other Apps Script error message | Will now surface verbatim (Round 1 hardening) — read it directly, e.g. rate limit, invalid recipient, etc. |

If "Unauthorized" appears: open Apps Script editor → Project Settings (gear icon) → Script Properties → confirm `RELAY_TOKEN` value, then Cloudflare Dashboard → Workers → uzes-upload → Settings → Variables and Secrets → `EMAIL_RELAY_TOKEN` → re-enter the same value → Deploy.

### Files Changed This Round

| File | Change |
|------|--------|
| `public/js/firebase-public.js` | Added App Check init |
| `public/js/executive.js` | `/send-email` → `/email` (3 call sites) |
| `public/js/industrial-secretary.js` | `approvePlacement` — removed Firestore relay read, now uses `sendEmail()` |
| `workers/upload-worker/index.js` | `data.ok === false` check added; `env.RELAY_TOKEN` → `env.EMAIL_RELAY_TOKEN` (3 references) |

### Commits This Round

| Commit | Description |
|--------|-------------|
| `6acd8c3` | Fix emails broken after App Check enforcement + fix public page 403 |
| `68cd9fc` | Worker: propagate Apps Script error body to client |
| `ba6f68d` | Fix critical Worker bug: env var name mismatch broke ALL emails |

---

*End of session report — 2026-06-30 Part 2 (continued)*
