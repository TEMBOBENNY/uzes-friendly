// Phase 7 — FCM push notifications.
// registerFCMToken: call once after student login to request permission + store token.
// sendPush: fire-and-forget from exec/TS pages when approving payments/letters/placements.

import { app, auth, db } from "./firebase.js";
import { getMessaging, getToken, onMessage }
  from "https://www.gstatic.com/firebasejs/10.12.2/firebase-messaging.js";
import { doc, updateDoc }
  from "https://www.gstatic.com/firebasejs/10.12.2/firebase-firestore.js";
import { FCM_VAPID_KEY, UPLOAD_WORKER_URL } from "./config.js";

let _messaging = null;
let _registered = false;

function getMsg() {
  if (!_messaging) _messaging = getMessaging(app);
  return _messaging;
}

export async function registerFCMToken(uid, collection) {
  if (!FCM_VAPID_KEY || _registered || !("Notification" in window)) return;
  try {
    const perm = await Notification.requestPermission();
    if (perm !== "granted") return;

    const messaging = getMsg();
    const token = await getToken(messaging, { vapidKey: FCM_VAPID_KEY });
    if (!token) return;
    _registered = true;

    await updateDoc(doc(db, collection, uid), { fcmToken: token }).catch(() => {});

    onMessage(messaging, (payload) => {
      const title = payload.notification?.title || "UZES";
      const body  = payload.notification?.body  || "";
      if (typeof window.showToast === "function") {
        window.showToast({ type: "info", title, message: body });
      }
    });
  } catch (err) {
    console.warn("FCM setup:", err.message);
  }
}

export async function sendPush(fcmToken, title, body) {
  if (!fcmToken) return;
  try {
    const u = auth.currentUser;
    if (!u) return;
    const idToken = await u.getIdToken();
    fetch(UPLOAD_WORKER_URL + "/push", {
      method: "POST",
      headers: { "Content-Type": "application/json", Authorization: "Bearer " + idToken },
      body: JSON.stringify({ to: fcmToken, title, body: body || "" })
    });
  } catch (err) {
    console.warn("Push notification:", err.message);
  }
}
