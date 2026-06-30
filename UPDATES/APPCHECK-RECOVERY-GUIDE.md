# App Check Recovery — Complete Fix Guide

**Date:** 2026-06-30  
**Status:** Web code deployed. Android setup requires manual steps.  
**Goal:** Get both web and Android apps working with App Check Enforcement.

---

## What Happened

You switched Firebase App Check from **Monitoring** to **Enforcement**. This means Firebase now rejects every request that doesn't include a valid App Check token. Both your web app and Android APK stopped working because:

1. **Web app** — Your code already sends App Check tokens, but your **reCAPTCHA key doesn't allow your Firebase hosting domain**. Firebase sees a valid token from an unauthorized domain → rejects it.
2. **Android APK** — Your app is **not registered at all** in Firebase App Check. It sends no token → Firebase rejects every request.

**The fix has two parts:** fix the web domain whitelist (manual config), and register the Android app (manual config + code changes).

---

## PART 1: Fix Web App (Immediate)

Your web App Check code is already correct and deployed. I added better console logging so you can see exactly what's happening. Open your site now, press **F12 → Console**, and look for messages starting with `[App Check]`.

### Step 1: Temporarily Switch Back to Monitoring (so you can keep working)

1. Go to [Firebase Console](https://console.firebase.google.com) → your project → **App Check** → **APIs** tab
2. For each API (Firestore, Authentication, Storage, etc.):
   - Click the **three dots** → **Edit**
   - Change **Enforcement** back to **Monitoring**
   - Save

This restores access immediately. **Don't switch back to Enforcement until you've completed all steps below.**

### Step 2: Verify Your reCAPTCHA Key Domain Whitelist

Your `config.js` has this site key:
```javascript
export const RECAPTCHA_SITE_KEY = "6LejNzwtAAAAAGcxw8GBiKqdvPwoBrmOQxC_qO1E";
```

This key must allow these domains:
- `localhost` (for local development)
- `uzes-friendly-web.web.app`
- `uzes-friendly-web.firebaseapp.com`

**How to check:**
1. Go to [Google reCAPTCHA Admin Console](https://www.google.com/recaptcha/admin) (log in with the Google account that created the key)
2. Find your key (it should show `uzes-friendly-web` or similar)
3. Click the **gear icon** (settings) → **Domains**
4. Verify these three domains are listed:
   ```
   localhost
   uzes-friendly-web.web.app
   uzes-friendly-web.firebaseapp.com
   ```
5. If any are missing, add them and click **Save**

> ⚠️ **Important:** Changes to reCAPTCHA domain settings can take **up to 30 minutes** to propagate across Google's CDN. Don't panic if it doesn't work immediately.

### Step 3: Verify Firebase Console Registration

1. In [Firebase Console](https://console.firebase.google.com) → **App Check** → **Apps** tab
2. Click on **uzes-friendly** (the Web app)
3. Verify it says **Registered** with **reCAPTCHA**
4. If you see **reCAPTCHA Enterprise** instead of just **reCAPTCHA**, you need to change the provider in code:
   - Open `public/js/firebase.js`
   - Change `ReCaptchaV3Provider` → `ReCaptchaEnterpriseProvider`
   - Redeploy (`firebase deploy --only hosting`)

### Step 4: Test with Monitoring Mode

1. Open your live site: `https://uzes-friendly-web.web.app`
2. Press **F12 → Console**
3. Look for this message:
   ```
   [App Check] initialized successfully
   ```
4. If you see `[App Check] init failed:` with an error, the domain whitelist or key is wrong. Go back to Step 2.
5. Try logging in. It should work in Monitoring mode.

### Step 5: Switch to Enforcement (Only After Confirmed Working)

Once you see the success message and login works in Monitoring mode:
1. Go back to Firebase Console → **App Check** → **APIs**
2. For each API, switch from **Monitoring** → **Enforcement**
3. Test login again. If it works, you're done for the web app.

---

## PART 2: Fix Android App (Capacitor APK)

Your Android app (`com.uzes.app`) is not registered in Firebase App Check at all. It needs three things:

1. **SHA-256 certificate fingerprint** registered in Firebase
2. **Play Integrity** configured as the attestation provider
3. **Code changes** in your Android project to initialize Play Integrity

### Step 1: Get Your SHA-256 Certificate Fingerprint(s)

You need **both** your debug and release fingerprints.

**Debug fingerprint** (same on every developer machine):
```bash
keytool -list -v -keystore ~/.android/debug.keystore -alias androiddebugkey -storepass android -keypass android
```

Look for the line starting with `SHA256:` and copy the full string (e.g., `A1:B2:C3:...`).

**Release fingerprint** (your production keystore):
```bash
keytool -list -v -keystore your-release-key.keystore -alias your-alias-name
```

> If you don't have a release keystore yet, create one:
> ```bash
> keytool -genkey -v -keystore uzes-release.keystore -alias uzes -keyalg RSA -keysize 2048 -validity 10000
> ```

### Step 2: Register Your Android App in Firebase Console

1. Go to [Firebase Console](https://console.firebase.google.com) → your project → **App Check** → **Apps**
2. Click the **"Register"** button next to `com.uzes.app` (the Android app)
3. Choose **Play Integrity** as the attestation provider
4. Paste your **debug SHA-256** fingerprint
5. Click **Add fingerprint** and paste your **release SHA-256** fingerprint too
6. Click **Save**

> **Note:** If Play Integrity isn't available in your region or for your app, you can use **SafetyNet** instead. But Play Integrity is preferred — SafetyNet is being deprecated by Google.

### Step 3: Add Play Integrity Dependency to Your Android Project

In your Capacitor project, open:
```
android/app/build.gradle
```

Add this to the `dependencies` block (inside `android {}`):
```gradle
dependencies {
    // ... existing dependencies ...
    implementation 'com.google.firebase:firebase-app-check-playintegrity:18.0.0'
}
```

Then sync Gradle:
- In Android Studio: **File → Sync Project with Gradle Files**
- Or in terminal: `cd android && ./gradlew sync` (or `gradlew.bat sync` on Windows)

### Step 4: Initialize App Check in Your Android Code

In your Capacitor project, open:
```
android/app/src/main/java/com/uzes/app/MainActivity.java
```

Add this import at the top:
```java
import com.google.firebase.appcheck.FirebaseAppCheck;
import com.google.firebase.appcheck.playintegrity.PlayIntegrityAppCheckProviderFactory;
```

Inside your `MainActivity` class, add this to `onCreate()` (after `super.onCreate(savedInstanceState)`):
```java
@Override
protected void onCreate(Bundle savedInstanceState) {
    super.onCreate(savedInstanceState);
    
    // Initialize Firebase App Check with Play Integrity
    FirebaseAppCheck.getInstance().installAppCheckProviderFactory(
        PlayIntegrityAppCheckProviderFactory.getInstance()
    );
}
```

If you don't have a `MainActivity.java` file, or if you use a custom Application class, add it there instead:

```java
// In android/app/src/main/java/com/uzes/app/YourApplication.java
import android.app.Application;
import com.google.firebase.FirebaseApp;
import com.google.firebase.appcheck.FirebaseAppCheck;
import com.google.firebase.appcheck.playintegrity.PlayIntegrityAppCheckProviderFactory;

public class YourApplication extends Application {
    @Override
    public void onCreate() {
        super.onCreate();
        FirebaseApp.initializeApp(this);
        FirebaseAppCheck.getInstance().installAppCheckProviderFactory(
            PlayIntegrityAppCheckProviderFactory.getInstance()
        );
    }
}
```

Make sure to register the Application class in `AndroidManifest.xml`:
```xml
<application
    android:name=".YourApplication"
    ... >
</application>
```

### Step 5: Build and Test Your APK

1. Build your APK:
   ```bash
   cd android
   ./gradlew assembleDebug   # for debug APK
   # or
   ./gradlew assembleRelease # for release APK
   ```

2. Install the APK on a physical Android device (Play Integrity doesn't work on emulators)
3. Open the app and try to log in
4. Check the Firebase Console → **App Check** → **Metrics** to see if requests from `com.uzes.app` are showing up with valid tokens

### Step 6: Switch Android App Check to Enforcement

Only after you've confirmed the APK is sending valid App Check tokens:
1. Go to Firebase Console → **App Check** → **APIs**
2. For each API, switch from **Monitoring** → **Enforcement**
3. Test the APK again to confirm it still works

---

## Summary Checklist

### Web App
- [ ] Switch App Check to Monitoring mode (to restore access)
- [ ] Add `localhost`, `uzes-friendly-web.web.app`, `uzes-friendly-web.firebaseapp.com` to reCAPTCHA domain whitelist
- [ ] Verify Firebase Console shows Web app as "Registered" with reCAPTCHA
- [ ] Open site → F12 Console → confirm `[App Check] initialized successfully`
- [ ] Test login in Monitoring mode
- [ ] Switch to Enforcement mode
- [ ] Test login in Enforcement mode

### Android APK
- [ ] Get debug SHA-256 fingerprint (`keytool` command)
- [ ] Get release SHA-256 fingerprint (or create release keystore)
- [ ] Register `com.uzes.app` in Firebase Console with Play Integrity + both fingerprints
- [ ] Add `firebase-app-check-playintegrity` dependency to `android/app/build.gradle`
- [ ] Add `PlayIntegrityAppCheckProviderFactory` initialization to `MainActivity.java` or `Application` class
- [ ] Build APK and test on physical device
- [ ] Verify App Check metrics show valid tokens from `com.uzes.app`
- [ ] Switch Android App Check to Enforcement
- [ ] Test APK in Enforcement mode

---

## Code Changes Made (What I Did)

| File | Change |
|------|--------|
| `public/js/firebase.js` | Added clearer `[App Check]` console logging so you can see initialization status and errors |
| `public/js/config.js` | Added comment explaining exactly which domains must be whitelisted in the reCAPTCHA console, and how to verify whether you registered with v3 or Enterprise |

These are already deployed to Firebase Hosting and committed to Git.

---

## If You Get Stuck

### Web app: `[App Check] init failed` in console

- **"Invalid site key or domain"** → Your domain isn't in the reCAPTCHA whitelist. Go to Google reCAPTCHA Admin Console → Domains → add it. Wait 30 minutes.
- **"reCAPTCHA script failed to load"** → The reCAPTCHA script is blocked by a CSP or network issue. Check your browser's network tab for blocked requests to `google.com/recaptcha`.
- **No error, but login still fails in Enforcement** → Check Firebase Console → **App Check** → **Metrics** to see if tokens are being received. If metrics show 0 tokens, the initialization is silently failing.

### Android: APK still can't login after all steps

- **Play Integrity only works on physical devices**, not emulators. Test on a real phone.
- **Make sure you're using the debug build** when testing with the debug SHA-256 fingerprint. The release fingerprint is only used for signed release builds.
- **Check logcat** for App Check errors: `adb logcat | grep -i appcheck`
- **Verify the package name matches exactly**: `com.uzes.app` — if you changed it in `capacitor.config.ts`, the Firebase registration must match.

### Quick Escape: Disable App Check Entirely

If everything breaks and you need to restore service immediately:
1. Firebase Console → **App Check** → **APIs**
2. For every API, change **Enforcement** → **Monitoring** (or Off)
3. Your app will work immediately without any code changes

---

**End of report.**
