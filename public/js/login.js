import { auth, db } from "./firebase.js";
import { sendPasswordResetEmail, signInWithEmailAndPassword, onAuthStateChanged, signOut }
  from "https://www.gstatic.com/firebasejs/10.12.2/firebase-auth.js";
import { doc, getDoc }
  from "https://www.gstatic.com/firebasejs/10.12.2/firebase-firestore.js";
import { routeByRole, findProfileCollection } from "./guard.js";
import { verifyTOTP } from "./totp.js";
import { audit } from "./audit.js";
import { UPLOAD_WORKER_URL } from "./config.js";
import { authHeaders } from "./upload.js";

// Load a signed-in user's profile from whichever collection holds it.
async function loadProfile(uid) {
  const col = await findProfileCollection(uid);
  if (!col) return null;
  const snap = await getDoc(doc(db, col, uid));
  return snap.exists() ? snap.data() : null;
}

const form   = document.getElementById("loginForm");
const errBox = document.getElementById("error");
const btn    = document.getElementById("submitBtn");

function sanitizeCompNo(v) {
  return v.trim().toUpperCase().replace(/\//g, "_");
}

// Single gate used by both the form submit and the persisted-session listener:
// load profile → check active → enforce TOTP (once per browser session) → route.
let _proceeding = false;
async function proceed(user) {
  if (_proceeding) return;
  _proceeding = true;
  try {
    const profile = await loadProfile(user.uid);
    if (!profile) { errBox.textContent = "No profile found for this account. Contact the administrator."; await signOut(auth); return; }
    if (profile.active === false) { errBox.textContent = "This account has been disabled."; await signOut(auth); return; }

    if (profile.totpEnabled && profile.totpSecret && !sessionStorage.getItem("totpVerified")) {
      const ok = await promptTotp(profile.totpSecret);
      if (!ok) {
        audit("mfa_failed", { role: profile.role });
        await signOut(auth);
        return;
      }
      sessionStorage.setItem("totpVerified", "1");
    }
    audit("login", { role: profile.role });
    routeByRole(profile.role);
  } finally {
    _proceeding = false;
  }
}

// Persisted session → straight through the same gate.
onAuthStateChanged(auth, (user) => { if (user) proceed(user); });

// bfcache restore: mobile browsers may serve a cached login page without
// re-running JS. If the user is still signed in, redirect them immediately.
window.addEventListener("pageshow", (e) => {
  if (e.persisted && auth.currentUser) proceed(auth.currentUser);
});

form.addEventListener("submit", async (e) => {
  e.preventDefault();
  errBox.textContent = "";
  btn.disabled = true; btn.textContent = "Signing in…";

  const identifier = form.email.value.trim();
  const password   = form.password.value;

  try {
    let email = identifier;
    if (!identifier.includes("@")) {
      const key  = sanitizeCompNo(identifier);
      const snap = await getDoc(doc(db, "compIndex", key));
      if (!snap.exists()) {
        errBox.textContent = "Computer number not found. Use your email or contact the administrator.";
        return;
      }
      email = snap.data().email;
    }
    // Sign-in success triggers onAuthStateChanged → proceed() (routing + TOTP).
    await signInWithEmailAndPassword(auth, email, password);
  } catch (err) {
    const map = {
      "auth/invalid-credential":  "Incorrect credentials.",
      "auth/invalid-email":       "Invalid email address.",
      "auth/user-disabled":       "This account has been disabled.",
      "auth/too-many-requests":   "Too many attempts. Try again later."
    };
    errBox.textContent = map[err.code] || "Sign-in failed. Please try again.";
  } finally {
    btn.disabled = false; btn.textContent = "Sign in";
  }
});

// ── TOTP prompt modal (built in JS so login.html needs no markup) ──────────────
function promptTotp(secret) {
  return new Promise((resolve) => {
    const overlay = document.createElement("div");
    overlay.style.cssText =
      "position:fixed;inset:0;z-index:1000;background:rgba(0,0,0,.5);display:flex;" +
      "align-items:center;justify-content:center;padding:16px";
    overlay.innerHTML = `
      <div style="background:#fff;border-radius:12px;padding:26px 26px 22px;max-width:360px;width:100%;box-shadow:0 8px 32px rgba(0,0,0,.25)">
        <p style="font-size:16px;font-weight:700;margin:0 0 5px">Two-factor authentication</p>
        <p style="color:#667;font-size:13px;margin:0 0 16px">Enter the 6-digit code from your authenticator app.</p>
        <input id="totpIn" inputmode="numeric" maxlength="6" placeholder="123456"
          style="width:100%;letter-spacing:6px;font-size:22px;text-align:center;padding:10px;
                 border:1px solid #cdd5e0;border-radius:8px;margin-bottom:6px">
        <p id="totpErr" style="color:#c0392b;font-size:12px;min-height:16px;margin:0 0 10px"></p>
        <div style="display:flex;gap:10px">
          <button id="totpOk" style="background:#0055a5;color:#fff;border:none;padding:10px 22px;border-radius:8px;font-weight:700;cursor:pointer">Verify</button>
          <button id="totpCancel" style="background:none;border:1px solid #cdd5e0;padding:10px 18px;border-radius:8px;cursor:pointer">Cancel</button>
        </div>
      </div>`;
    document.body.appendChild(overlay);
    const input = overlay.querySelector("#totpIn");
    const err   = overlay.querySelector("#totpErr");
    input.focus();

    function close(result) { overlay.remove(); resolve(result); }

    overlay.querySelector("#totpCancel").addEventListener("click", () => close(false));
    overlay.querySelector("#totpOk").addEventListener("click", verify);
    input.addEventListener("keydown", (e) => { if (e.key === "Enter") verify(); });

    async function verify() {
      err.textContent = "";
      const code = input.value.trim();
      let ok;
      if (secret.includes(":")) {
        // Encrypted secret: verify server-side
        try {
          const res = await fetch(UPLOAD_WORKER_URL + "/totp/verify", {
            method: "POST",
            headers: { "Content-Type": "application/json", ...(await authHeaders()) },
            body: JSON.stringify({ encryptedSecret: secret, code }),
          });
          if (res.status === 429) { err.textContent = "Too many attempts. Please wait 15 minutes."; return; }
          const data = await res.json();
          ok = data.valid === true;
        } catch (_) { err.textContent = "Verification error — check your connection."; return; }
      } else {
        // Legacy plaintext secret (backward compat)
        ok = await verifyTOTP(secret, code);
      }
      if (ok) { close(true); }
      else { err.textContent = "Incorrect code. Try the latest code from your app."; input.select(); }
    }
  });
}


// ── Forgot password ────────────────────────────────────────────────────────────
const forgotModal = document.getElementById("forgotPwModal");
const forgotEmail = document.getElementById("forgotPwEmail");
const forgotErr   = document.getElementById("forgotPwErr");
const forgotSubmit = document.getElementById("forgotPwSubmit");
const forgotCancel = document.getElementById("forgotPwCancel");

if (document.getElementById("forgotPwLink")) {
  document.getElementById("forgotPwLink").addEventListener("click", (e) => {
    e.preventDefault();
    forgotModal.style.display = "flex";
    forgotErr.textContent = "";
    forgotEmail.value = "";
    forgotEmail.focus();
  });
}

if (forgotCancel) {
  forgotCancel.addEventListener("click", () => {
    forgotModal.style.display = "none";
  });
}

if (forgotSubmit) {
  forgotSubmit.addEventListener("click", async () => {
    forgotErr.textContent = "";
    const raw = forgotEmail.value.trim();
    if (!raw) { forgotErr.textContent = "Enter your email address."; return; }

    let email = raw;
    if (!raw.includes("@")) {
      const key = sanitizeCompNo(raw);
      try {
        const snap = await getDoc(doc(db, "compIndex", key));
        if (!snap.exists()) { forgotErr.textContent = "Computer number not found."; return; }
        email = snap.data().email;
      } catch (err) {
        forgotErr.textContent = "Could not look up computer number. Try your email.";
        return;
      }
    }

    forgotSubmit.disabled = true; forgotSubmit.textContent = "Sending…";
    try {
      await sendPasswordResetEmail(auth, email);
      forgotErr.style.color = "var(--ok)";
      forgotErr.textContent = "Reset link sent. Check your email.";
      setTimeout(() => { forgotModal.style.display = "none"; forgotErr.style.color = ""; }, 3000);
    } catch (err) {
      const map = {
        "auth/invalid-email":      "Invalid email address.",
        "auth/user-not-found":     "No account found with this email.",
        "auth/too-many-requests":  "Too many attempts. Try again later."
      };
      forgotErr.textContent = map[err.code] || "Failed to send reset link. Try again.";
    } finally {
      forgotSubmit.disabled = false; forgotSubmit.textContent = "Send reset link";
    }
  });
}

// Close modal on Escape key
if (forgotModal) {
  document.addEventListener("keydown", (e) => {
    if (e.key === "Escape" && forgotModal.style.display === "flex") {
      forgotModal.style.display = "none";
    }
  });
  // Close on backdrop click
  forgotModal.addEventListener("click", (e) => {
    if (e.target === forgotModal) forgotModal.style.display = "none";
  });
}
