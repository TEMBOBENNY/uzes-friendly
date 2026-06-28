// Firebase Cloud Messaging service worker — handles background push notifications.
// Must live at /firebase-messaging-sw.js (root of the site).
// Uses the compat SDK (importScripts) since service workers cannot use ES modules.

importScripts("https://www.gstatic.com/firebasejs/10.12.2/firebase-app-compat.js");
importScripts("https://www.gstatic.com/firebasejs/10.12.2/firebase-messaging-compat.js");

firebase.initializeApp({
  apiKey: "AIzaSyCTGvpTeLxYgXJM-pK4DKb1Vx89nYKzQg4",
  authDomain: "uzes-friendly-web.firebaseapp.com",
  projectId: "uzes-friendly-web",
  storageBucket: "uzes-friendly-web.firebasestorage.app",
  messagingSenderId: "816235655370",
  appId: "1:816235655370:web:7fe9e9226732a16456c433"
});

const messaging = firebase.messaging();

messaging.onBackgroundMessage((payload) => {
  const title = payload.notification?.title || "UZES";
  const body  = payload.notification?.body  || "";
  self.registration.showNotification(title, {
    body,
    icon: "/icons/icon-192.png",
    tag: "uzes-notification",
    renotify: true,
  });
});
