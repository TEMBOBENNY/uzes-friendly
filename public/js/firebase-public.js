// Lightweight Firebase init for PUBLIC pages (home/about/faq/activities).
// Includes App Check (reCAPTCHA v3) so public Firestore reads pass enforcement.
import { initializeApp } from "https://www.gstatic.com/firebasejs/10.12.2/firebase-app.js";
import { initializeAppCheck, ReCaptchaV3Provider } from "https://www.gstatic.com/firebasejs/10.12.2/firebase-app-check.js";
import {
  initializeFirestore, persistentLocalCache
} from "https://www.gstatic.com/firebasejs/10.12.2/firebase-firestore.js";
import { firebaseConfig, RECAPTCHA_SITE_KEY } from "./config.js";

export const app = initializeApp(firebaseConfig);

if (RECAPTCHA_SITE_KEY) {
  try {
    initializeAppCheck(app, {
      provider: new ReCaptchaV3Provider(RECAPTCHA_SITE_KEY),
      isTokenAutoRefreshEnabled: true,
    });
  } catch (e) {
    console.error("[App Check] init failed:", e.message);
  }
}

export const db  = initializeFirestore(app, {
  localCache: persistentLocalCache()
});
