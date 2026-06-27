// ─────────────────────────────────────────────────────────────
//  UZES Payments — Firebase configuration
//  Fill these in from: Firebase Console → Project settings →
//  "Your apps" → Web app → SDK setup and configuration → Config
// ─────────────────────────────────────────────────────────────
export const firebaseConfig = {
  apiKey: "AIzaSyCTGvpTeLxYgXJM-pK4DKb1Vx89nYKzQg4",
  authDomain: "uzes-friendly-web.firebaseapp.com",
  projectId: "uzes-friendly-web",
  storageBucket: "uzes-friendly-web.firebasestorage.app",
  messagingSenderId: "816235655370",
  appId: "1:816235655370:web:7fe9e9226732a16456c433"
};

// Cloudflare Worker upload endpoint (Worker: uzes-upload, R2 bucket: uzes-media).
export const UPLOAD_WORKER_URL = "https://uzes-upload.uzesofficial.workers.dev";

// Email relay URL and token are stored in Firestore settings/emailRelay
// (readable only by executives) — NOT in this file.
// Set them via Admin panel → System tab after deploying.

// App Check (reCAPTCHA v3) site key — PUBLIC by design, safe to ship.
// Get it from: Firebase Console → App Check → Apps → register your web app
// with reCAPTCHA v3. Paste the SITE key here. Leave "" to keep App Check off.
export const RECAPTCHA_SITE_KEY = "";

// Organisation details printed on receipts / emails.
export const ORG = {
  name: "The University of Zambia Engineering Society (UZES)",
  school: "School of Engineering",
  address: "P.O. Box 32379, Lusaka",
  email: "uzesofficial@gmail.com"
};
