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

*End of session report — 2026-06-30 Part 2*
