// Push notifications — dual-mode.
//   On the web: uses Firebase JS SDK web push (Notification API + service worker).
//   On the Capacitor Android app: uses @capacitor/push-notifications (native FCM).
//
// Public API:
//   registerFCMToken(uid, collection) — call once after login. Asks permission
//                                       (with custom in-app prompt first) and
//                                       stores the device token in Firestore.
//   sendPush(fcmToken, title, body)   — fire-and-forget for execs sending pushes.

import { app, auth, db } from "./firebase.js";
import { getMessaging, getToken, onMessage }
  from "https://www.gstatic.com/firebasejs/10.12.2/firebase-messaging.js";
import { doc, updateDoc }
  from "https://www.gstatic.com/firebasejs/10.12.2/firebase-firestore.js";
import { FCM_VAPID_KEY, UPLOAD_WORKER_URL } from "./config.js";

let _messaging = null;
let _registered = false;

function isNative() {
  return !!(window.Capacitor && window.Capacitor.isNativePlatform && window.Capacitor.isNativePlatform());
}

function getMsg() {
  if (!_messaging) _messaging = getMessaging(app);
  return _messaging;
}

// Friendly bottom-sheet shown before the OS-level permission dialog.
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
          style="width:100%;padding:13px;background:var(--green,#0055a5);color:#fff;
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

// ── Native (Capacitor Android) push registration ─────────────────────────────
async function registerNative(uid, collection) {
  const PushNotifications = window.Capacitor?.Plugins?.PushNotifications;
  if (!PushNotifications) {
    console.warn("PushNotifications plugin not installed. Run: npm install @capacitor/push-notifications && npx cap sync android");
    return;
  }
  try {
    const perm = await PushNotifications.checkPermissions();
    let granted = perm.receive === "granted";

    if (!granted) {
      if (perm.receive === "denied") return;       // OS-level deny
      if (localStorage.getItem("uzes_notif_asked") === "dismissed") return;

      await new Promise(r => setTimeout(r, 1500));
      const allowed = await showNotifPrompt();
      if (!allowed) {
        localStorage.setItem("uzes_notif_asked", "dismissed");
        return;
      }
      const req = await PushNotifications.requestPermissions();
      granted = req.receive === "granted";
      if (!granted) return;
    }

    // Listen BEFORE calling register() — registration fires the listener.
    PushNotifications.addListener("registration", async (tokenObj) => {
      const token = tokenObj.value || tokenObj.token;
      if (!token) return;
      _registered = true;
      try {
        await updateDoc(doc(db, collection, uid), { fcmToken: token });
      } catch (e) { console.warn("Token save:", e.message); }
    });

    PushNotifications.addListener("registrationError", (err) => {
      console.warn("Native push registration error:", err?.error || err);
    });

    PushNotifications.addListener("pushNotificationReceived", (notification) => {
      // App in foreground — show an in-app toast since the system notification is suppressed.
      const title = notification.title || "UZES";
      const body  = notification.body  || "";
      if (typeof window.showToast === "function") {
        window.showToast({ type: "info", title, message: body });
      }
    });

    await PushNotifications.register();
  } catch (err) {
    console.warn("Native push setup:", err.message);
  }
}

// ── Web (browser) push registration ──────────────────────────────────────────
async function registerWeb(uid, collection) {
  if (!("Notification" in window)) return;
  const perm = Notification.permission;

  // Already granted — silently re-register
  if (perm === "granted") {
    await _doWebRegister(uid, collection);
    return;
  }
  if (perm === "denied") return;
  if (localStorage.getItem("uzes_notif_asked") === "dismissed") return;

  await new Promise(r => setTimeout(r, 1500));
  const allowed = await showNotifPrompt();
  if (!allowed) {
    localStorage.setItem("uzes_notif_asked", "dismissed");
    return;
  }
  try {
    const granted = await Notification.requestPermission();
    if (granted !== "granted") return;
    await _doWebRegister(uid, collection);
  } catch (err) {
    console.warn("Web push permission:", err.message);
  }
}

async function _doWebRegister(uid, collection) {
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
    console.warn("Web push token:", err.message);
  }
}

// ── Public entry point ──────────────────────────────────────────────────────
export async function registerFCMToken(uid, collection) {
  if (_registered) return;
  if (isNative()) return registerNative(uid, collection);
  if (!FCM_VAPID_KEY) return;
  return registerWeb(uid, collection);
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
