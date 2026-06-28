// FCM push notifications.
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

// Show a friendly bottom-sheet before the native OS dialog fires.
// Returns true if the user tapped "Allow", false for "Not Now".
function showNotifPrompt() {
  return new Promise(resolve => {
    const overlay = document.createElement("div");
    overlay.style.cssText =
      "position:fixed;inset:0;background:rgba(0,0,0,.55);z-index:9999;" +
      "display:flex;align-items:flex-end;justify-content:center;padding:16px;box-sizing:border-box";
    overlay.innerHTML = `
      <div style="background:var(--card,#fff);border-radius:16px;padding:24px 20px 20px;
                  max-width:400px;width:100%;text-align:center;
                  box-shadow:0 8px 40px rgba(0,0,0,.25)">
        <div style="font-size:36px;margin-bottom:12px">🔔</div>
        <div style="font-size:16px;font-weight:700;margin-bottom:8px;color:var(--text,#1a1a1a)">
          Stay up to date
        </div>
        <div style="font-size:14px;color:var(--muted,#666);line-height:1.6;margin-bottom:20px">
          Allow UZES to notify you when your payment is confirmed, your letter is approved,
          or your placement is finalised.
        </div>
        <button id="_notifAllow"
          style="width:100%;padding:13px;background:var(--primary,#2563eb);color:#fff;
                 border:none;border-radius:10px;font-size:15px;font-weight:600;
                 cursor:pointer;margin-bottom:10px">
          Allow Notifications
        </button>
        <button id="_notifSkip"
          style="width:100%;padding:10px;background:none;border:none;
                 color:var(--muted,#888);font-size:14px;cursor:pointer">
          Not Now
        </button>
      </div>`;
    document.body.appendChild(overlay);
    overlay.querySelector("#_notifAllow").addEventListener("click", () => {
      overlay.remove(); resolve(true);
    });
    overlay.querySelector("#_notifSkip").addEventListener("click", () => {
      overlay.remove(); resolve(false);
    });
  });
}

async function _doRegister(uid, collection) {
  try {
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
    console.warn("FCM token:", err.message);
  }
}

export async function registerFCMToken(uid, collection) {
  if (!FCM_VAPID_KEY || _registered || !("Notification" in window)) return;

  const perm = Notification.permission;

  // Already granted on a previous visit — silently re-register the token.
  if (perm === "granted") {
    return _doRegister(uid, collection);
  }

  // OS-level deny — cannot ask again without the user visiting Settings.
  if (perm === "denied") return;

  // Check if we've already shown our custom prompt on this device.
  const alreadyAsked = localStorage.getItem("uzes_notif_asked");
  if (alreadyAsked === "dismissed") return;

  // Wait 1.5 s so the page is settled before the prompt appears.
  await new Promise(r => setTimeout(r, 1500));

  const allowed = await showNotifPrompt();
  if (!allowed) {
    localStorage.setItem("uzes_notif_asked", "dismissed");
    return;
  }

  // User tapped "Allow" → trigger native OS permission dialog.
  try {
    const granted = await Notification.requestPermission();
    if (granted !== "granted") return;
    await _doRegister(uid, collection);
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
