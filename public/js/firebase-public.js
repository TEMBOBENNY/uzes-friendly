// Lightweight Firebase init for PUBLIC pages (home/about/faq/activities).
// Loads only app + firestore — no auth, storage or App Check — so the public
// site downloads far less JS. Public pages only read published content.
import { initializeApp } from "https://www.gstatic.com/firebasejs/10.12.2/firebase-app.js";
import {
  initializeFirestore, persistentLocalCache
} from "https://www.gstatic.com/firebasejs/10.12.2/firebase-firestore.js";
import { firebaseConfig } from "./config.js";

export const app = initializeApp(firebaseConfig);
export const db  = initializeFirestore(app, {
  localCache: persistentLocalCache()
});
