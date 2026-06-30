// Shared Firebase initialisation — imported by every page.
import { initializeApp } from "https://www.gstatic.com/firebasejs/10.12.2/firebase-app.js";
import { initializeAppCheck, ReCaptchaV3Provider } from "https://www.gstatic.com/firebasejs/10.12.2/firebase-app-check.js";
import { getAuth } from "https://www.gstatic.com/firebasejs/10.12.2/firebase-auth.js";
import {
  initializeFirestore, persistentLocalCache, persistentMultipleTabManager
} from "https://www.gstatic.com/firebasejs/10.12.2/firebase-firestore.js";
import { getStorage } from "https://www.gstatic.com/firebasejs/10.12.2/firebase-storage.js";
import { firebaseConfig, RECAPTCHA_SITE_KEY } from "./config.js";

export const app = initializeApp(firebaseConfig);

// ── App Check (reCAPTCHA v3) ─────────────────────────────────────────────────
// If you see "App Check init failed" in console, check:
// 1. RECAPTCHA_SITE_KEY in config.js matches Firebase Console → App Check
// 2. Your domain is whitelisted in the reCAPTCHA console
// 3. Firebase Console → App Check was registered with reCAPTCHA v3 (not Enterprise)
// 4. If registered with Enterprise, swap ReCaptchaV3Provider → ReCaptchaEnterpriseProvider
if (RECAPTCHA_SITE_KEY) {
  try {
    const appCheck = initializeAppCheck(app, {
      provider: new ReCaptchaV3Provider(RECAPTCHA_SITE_KEY),
      isTokenAutoRefreshEnabled: true,
    });
    console.log("[App Check] initialized successfully");
  } catch (e) {
    console.error("[App Check] init failed:", e.message);
    console.warn("[App Check] Requests will be REJECTED if enforcement is ON.");
  }
} else {
  console.warn("[App Check] RECAPTCHA_SITE_KEY is empty — App Check disabled.");
  console.warn("[App Check] Set it in config.js if you switch App Check to Enforcement.");
}

export const auth    = getAuth(app);
export const db      = initializeFirestore(app, {
  localCache: persistentLocalCache({ tabManager: persistentMultipleTabManager() })
});
export const storage = getStorage(app);
