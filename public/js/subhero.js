// subhero.js — universal blue tab bar shown below the white topbar on every
// logged-in page. It is the SINGLE navigation layer: each role passes its own
// flat list of tabs and clicking one reveals that tab's full panel inline.
// No dropdowns, no membership badge.
//
// Usage:
//   initSubHero(user, profile, {
//     page: "student",
//     active: "tab-dash",                 // which tab is highlighted on load
//     tabs: [
//       { id: "tab-dash", label: "Dashboard",        icon: "dash" },   // in-page panel
//       { id: "tab-fin",  label: "My Finance",       icon: "fin"  },
//       { id: "lib",      label: "Library",          icon: "lib",   href: "library.html" }, // cross-page
//     ],
//   });
//
// In-page tabs:  tab.id MUST equal the DOM id of a `.tab-panel` element.
// Cross-page tabs: provide tab.href; `active` highlights the current page's tab.
//
// Lazy loading: pages may define `window.shOnTab = (id) => {...}` to load a
// panel's data the first time it is shown.
//
// Account helpers: if the page contains `#accPwBox` and/or `#acc2faBox`,
// initSubHero fills and wires them (change-password form / 2FA toggle).

import { db } from "./firebase.js";
import { logout } from "./guard.js";
import {
  doc, updateDoc
} from "https://www.gstatic.com/firebasejs/10.12.2/firebase-firestore.js";
import {
  reauthenticateWithCredential, EmailAuthProvider, updatePassword
} from "https://www.gstatic.com/firebasejs/10.12.2/firebase-auth.js";
import { generateSecret, verifyTOTP, otpauthURI, loadQR } from "./totp.js";

function esc(s) {
  return String(s ?? "")
    .replace(/&/g, "&amp;").replace(/</g, "&lt;")
    .replace(/>/g, "&gt;").replace(/"/g, "&quot;");
}

const _ico = (d, w = 15, h = 15) =>
  `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 24 24" fill="none" ` +
  `stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" ` +
  `width="${w}" height="${h}" style="flex-shrink:0">${d}</svg>`;

const ICO = {
  dash:    _ico('<rect x="3" y="3" width="7" height="7"/><rect x="14" y="3" width="7" height="7"/><rect x="3" y="14" width="7" height="7"/><rect x="14" y="14" width="7" height="7"/>'),
  fin:     _ico('<rect x="1" y="4" width="22" height="16" rx="2"/><line x1="1" y1="10" x2="23" y2="10"/>'),
  acc:     _ico('<path d="M20 21v-2a4 4 0 0 0-4-4H8a4 4 0 0 0-4 4v2"/><circle cx="12" cy="7" r="4"/>'),
  lib:     _ico('<path d="M2 3h6a4 4 0 0 1 4 4v14a3 3 0 0 0-3-3H2z"/><path d="M22 3h-6a4 4 0 0 0-4 4v14a3 3 0 0 1 3-3h7z"/>'),
  attach:  _ico('<path d="M21.44 11.05l-9.19 9.19a6 6 0 0 1-8.49-8.49l9.19-9.19a4 4 0 0 1 5.66 5.66l-9.2 9.19a2 2 0 0 1-2.83-2.83l8.49-8.48"/>'),
  users:   _ico('<path d="M17 21v-2a4 4 0 0 0-4-4H5a4 4 0 0 0-4 4v2"/><circle cx="9" cy="7" r="4"/><path d="M23 21v-2a4 4 0 0 0-3-3.87"/><path d="M16 3.13a4 4 0 0 1 0 7.75"/>'),
  exec:    _ico('<rect x="2" y="7" width="20" height="14" rx="2"/><path d="M16 21V5a2 2 0 0 0-2-2h-4a2 2 0 0 0-2 2v16"/>'),
  system:  _ico('<circle cx="12" cy="12" r="3"/><path d="M19.4 15a1.65 1.65 0 0 0 .33 1.82l.06.06a2 2 0 1 1-2.83 2.83l-.06-.06a1.65 1.65 0 0 0-1.82-.33 1.65 1.65 0 0 0-1 1.51V21a2 2 0 0 1-4 0v-.09A1.65 1.65 0 0 0 9 19.4a1.65 1.65 0 0 0-1.82.33l-.06.06a2 2 0 1 1-2.83-2.83l.06-.06a1.65 1.65 0 0 0 .33-1.82 1.65 1.65 0 0 0-1.51-1H3a2 2 0 0 1 0-4h.09A1.65 1.65 0 0 0 4.6 9a1.65 1.65 0 0 0-.33-1.82l-.06-.06a2 2 0 1 1 2.83-2.83l.06.06a1.65 1.65 0 0 0 1.82.33H9a1.65 1.65 0 0 0 1-1.51V3a2 2 0 0 1 4 0v.09a1.65 1.65 0 0 0 1 1.51 1.65 1.65 0 0 0 1.82-.33l.06-.06a2 2 0 1 1 2.83 2.83l-.06.06a1.65 1.65 0 0 0-.33 1.82V9a1.65 1.65 0 0 0 1.51 1H21a2 2 0 0 1 0 4h-.09a1.65 1.65 0 0 0-1.51 1z"/>'),
  inbox:   _ico('<polyline points="22 12 16 12 14 15 10 15 8 12 2 12"/><path d="M5.45 5.11L2 12v6a2 2 0 0 0 2 2h16a2 2 0 0 0 2-2v-6l-3.45-6.89A2 2 0 0 0 16.76 4H7.24a2 2 0 0 0-1.79 1.11z"/>'),
  check:   _ico('<path d="M22 11.08V12a10 10 0 1 1-5.93-9.14"/><polyline points="22 4 12 14.01 9 11.01"/>'),
  file:    _ico('<path d="M14 2H6a2 2 0 0 0-2 2v16a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V8z"/><polyline points="14 2 14 8 20 8"/>'),
  tag:     _ico('<path d="M20.59 13.41l-7.17 7.17a2 2 0 0 1-2.83 0L2 12V2h10l8.59 8.59a2 2 0 0 1 0 2.82z"/><line x1="7" y1="7" x2="7.01" y2="7"/>'),
  chart:   _ico('<line x1="18" y1="20" x2="18" y2="10"/><line x1="12" y1="20" x2="12" y2="4"/><line x1="6" y1="20" x2="6" y2="14"/>'),
  bank:    _ico('<line x1="3" y1="22" x2="21" y2="22"/><line x1="6" y1="18" x2="6" y2="11"/><line x1="10" y1="18" x2="10" y2="11"/><line x1="14" y1="18" x2="14" y2="11"/><line x1="18" y1="18" x2="18" y2="11"/><polygon points="12 2 20 7 4 7"/>'),
  toggle:  _ico('<rect x="1" y="5" width="22" height="14" rx="7"/><circle cx="16" cy="12" r="3"/>'),
  layers:  _ico('<polygon points="12 2 2 7 12 12 22 7 12 2"/><polyline points="2 17 12 22 22 17"/><polyline points="2 12 12 17 22 12"/>'),
  key:     _ico('<path d="M21 2l-2 2m-7.61 7.61a5.5 5.5 0 1 1-7.778 7.778 5.5 5.5 0 0 1 7.777-7.777zm0 0L15.5 7.5m0 0l3 3L22 7l-3-3m-3.5 3.5L19 4"/>'),
  shield:  _ico('<path d="M12 22s8-4 8-10V5l-8-3-8 3v7c0 6 8 10 8 10z"/>'),
};

export function initSubHero(user, profile, opts = {}) {
  const tabs = opts.tabs || [];
  const active = opts.active || (tabs.find(t => !t.href) || {}).id || (tabs[0] || {}).id;

  const tabsHtml = tabs.map(t => {
    const cls = "sh-tab" + (t.id === active ? " sh-tab-active" : "");
    const ic  = ICO[t.icon] || "";
    if (t.href) {
      return `<a href="${t.href}" class="${cls}">${ic}<span>${esc(t.label)}</span></a>`;
    }
    return `<button type="button" class="${cls}" data-sub="${t.id}">${ic}<span>${esc(t.label)}</span></button>`;
  }).join("");

  const titleText = profile.position ||
    (profile.role === "admin"    ? "Patron" :
     profile.role === "student"  ? (profile.yearOfStudy ? profile.yearOfStudy + " Year" : "Student") : "");

  const innerHtml = `
    <div class="sh-bar">
      <a href="index.html" class="sh-brand">
        <img src="img/uzes-logo.png" class="sh-logo" alt="UZES">
      </a>
      <nav class="sh-tabs">${tabsHtml}</nav>
      <button type="button" class="theme-toggle-btn theme-toggle-subhero" title="Toggle dark mode" aria-label="Toggle dark mode">🌙</button>
      <div class="sh-user-pill">
        <div class="sh-user-info">
          <span id="who" class="sh-uname">${esc(profile.name || user.email)}</span>
          ${titleText ? `<span class="sh-utitle">${esc(titleText)}</span>` : ""}
        </div>
        <button id="logout" class="sh-signout">Sign out</button>
      </div>
    </div>`;

  let subheroEl = document.getElementById("subHero");
  if (!subheroEl) {
    subheroEl = document.createElement("div");
    subheroEl.id = "subHero";
    subheroEl.className = "sub-hero";
    document.body.prepend(subheroEl);
  }
  subheroEl.innerHTML = innerHtml;
  document.getElementById("logout").addEventListener("click", logout);

  // ── In-page tab switching ──
  const btns = Array.from(document.querySelectorAll(".sh-tab[data-sub]"));
  async function show(id) {
    // Optional gate (e.g. admin System tab re-auth). Return false to cancel.
    if (typeof window.shGuardTab === "function") {
      const ok = await window.shGuardTab(id);
      if (ok === false) return;
    }
    document.querySelectorAll(".tab-panel").forEach(p => p.classList.add("hidden"));
    const panel = document.getElementById(id);
    if (panel) panel.classList.remove("hidden");
    btns.forEach(b => b.classList.toggle("sh-tab-active", b.dataset.sub === id));
    if (typeof window.shOnTab === "function") window.shOnTab(id);
    history.replaceState(null, "", "#" + id);
    // keep the active tab in view on small screens
    const activeBtn = btns.find(b => b.dataset.sub === id);
    if (activeBtn) activeBtn.scrollIntoView({ inline: "center", block: "nearest" });
  }
  btns.forEach(b => b.addEventListener("click", () => show(b.dataset.sub)));
  window.shShowTab = show; // allow pages to switch tabs programmatically

  // Activate the initial in-page tab — check URL hash first for persistence on refresh
  const hash = location.hash.replace("#", "");
  const initialId = hash && tabs.find(t => t.id === hash && !t.href) ? hash : active;
  const activeTab = tabs.find(t => t.id === initialId);
  if (activeTab && !activeTab.href) show(initialId);

  // ── Back-button lock ──────────────────────────────────────────────────────
  // Once signed in the browser back button should never navigate to the login
  // page or the public site. We push a sentinel entry onto the history stack
  // and repush it every time the user presses back, so they always land on the
  // page's default tab instead of leaving.
  const _defaultTabId = (tabs.find(t => !t.href) || tabs[0] || {}).id;
  if (_defaultTabId && !window._uzesNavLocked) {
    window._uzesNavLocked = true;
    history.pushState({ uzesLocked: true }, "");
    window.addEventListener("popstate", function() {
      history.pushState({ uzesLocked: true }, "");
      show(_defaultTabId);
    });
    // bfcache restore: repush the sentinel so the lock stays active after
    // a browser restores this page from its back/forward cache.
    window.addEventListener("pageshow", function(pse) {
      if (pse.persisted) history.pushState({ uzesLocked: true }, "");
    });
  }

  // ── Account helpers (optional, mounted only if the boxes exist) ──
  mountPasswordBox(user);
  mount2FABox(user, profile);
}

// Fills #accPwBox with a change-password card and wires it.
function mountPasswordBox(user) {
  const box = document.getElementById("accPwBox");
  if (!box || box.dataset.mounted) return;
  box.dataset.mounted = "1";
  box.innerHTML = `
    <div class="card" style="max-width:480px">
      <p class="section-head">Change password</p>
      <form id="accPwForm" autocomplete="off">
        <label for="accCurPw">Current password</label>
        <input id="accCurPw" type="password" required placeholder="Your current password" style="margin-bottom:12px">
        <label for="accNewPw">New password</label>
        <input id="accNewPw" type="password" required placeholder="At least 6 characters" style="margin-bottom:12px">
        <label for="accConPw">Confirm new password</label>
        <input id="accConPw" type="password" required placeholder="Repeat new password" style="margin-bottom:14px">
        <p id="accPwErr" class="error"></p>
        <p id="accPwOk" class="ok-msg"></p>
        <button type="submit" id="accPwBtn" class="btn-primary" style="width:auto;padding:10px 26px">Change password</button>
      </form>
    </div>`;

  document.getElementById("accPwForm").addEventListener("submit", async e => {
    e.preventDefault();
    const errEl = document.getElementById("accPwErr");
    const okEl  = document.getElementById("accPwOk");
    const btn   = document.getElementById("accPwBtn");
    errEl.textContent = ""; okEl.textContent = "";
    const cur = document.getElementById("accCurPw").value;
    const nw  = document.getElementById("accNewPw").value;
    const cn  = document.getElementById("accConPw").value;
    if (nw.length < 6) { errEl.textContent = "New password must be at least 6 characters."; return; }
    if (nw !== cn)     { errEl.textContent = "Passwords do not match."; return; }
    btn.disabled = true; btn.textContent = "Saving…";
    try {
      const cred = EmailAuthProvider.credential(user.email, cur);
      await reauthenticateWithCredential(user, cred);
      await updatePassword(user, nw);
      e.target.reset();
      okEl.textContent = "Password changed successfully.";
    } catch (err) {
      const msgs = {
        "auth/wrong-password":     "Current password is incorrect.",
        "auth/invalid-credential": "Current password is incorrect.",
        "auth/too-many-requests":  "Too many attempts. Please try again later."
      };
      errEl.textContent = msgs[err.code] || err.message;
    } finally {
      btn.disabled = false; btn.textContent = "Change password";
    }
  });
}

// Fills #acc2faBox with an authenticator-app (TOTP) 2FA card and wires it.
function mount2FABox(user, profile) {
  const box = document.getElementById("acc2faBox");
  if (!box || box.dataset.mounted) return;
  box.dataset.mounted = "1";
  const col = () => profile.__collection || (profile.role === "student" ? "students" : "executives");

  function renderEnabled() {
    box.innerHTML = `
      <div class="card" style="max-width:480px">
        <p class="section-head">Two-factor authentication</p>
        <p class="muted" style="font-size:13px;margin-bottom:12px">
          2FA is <strong style="color:var(--ok)">enabled</strong> with an authenticator app.
          You'll enter a 6-digit code from your app each time you sign in.
        </p>
        <button id="acc2faOff" class="btn-primary" style="width:auto;padding:9px 22px;background:var(--danger)">Disable 2FA</button>
        <p id="acc2faMsg" class="ok-msg"></p>
      </div>`;
    document.getElementById("acc2faOff").addEventListener("click", async () => {
      if (!confirm("Disable two-factor authentication?")) return;
      const msg = document.getElementById("acc2faMsg");
      msg.style.color = "var(--muted)"; msg.textContent = "Saving…";
      try {
        await updateDoc(doc(db, col(), user.uid), { totpEnabled: false, totpSecret: "" });
        profile.totpEnabled = false; profile.totpSecret = "";
        renderDisabled();
      } catch (err) { msg.style.color = "var(--danger)"; msg.textContent = err.message; }
    });
  }

  function renderDisabled() {
    box.innerHTML = `
      <div class="card" style="max-width:480px">
        <p class="section-head">Two-factor authentication</p>
        <p class="muted" style="font-size:13px;margin-bottom:12px">
          Add a second layer of security using an authenticator app
          (Google Authenticator, Authy, Microsoft Authenticator…).
        </p>
        <button id="acc2faOn" class="btn-primary" style="width:auto;padding:9px 22px">Enable 2FA</button>
        <p id="acc2faMsg" class="ok-msg"></p>
      </div>`;
    document.getElementById("acc2faOn").addEventListener("click", () => startEnroll());
  }

  async function startEnroll() {
    const secret = generateSecret();
    const uri    = otpauthURI(secret, user.email, "UZES");
    box.innerHTML = `
      <div class="card" style="max-width:480px">
        <p class="section-head">Set up authenticator app</p>
        <ol class="muted" style="font-size:13px;margin:0 0 12px 18px;line-height:1.7">
          <li>Open your authenticator app and add an account.</li>
          <li>Scan the QR code below (or enter the key manually).</li>
          <li>Type the 6-digit code it shows to confirm.</li>
        </ol>
        <div id="acc2faQR" style="display:flex;justify-content:center;margin:0 0 12px"></div>
        <p class="muted small" style="margin-bottom:4px">Manual key:</p>
        <p style="font-family:monospace;font-size:14px;letter-spacing:1px;word-break:break-all;background:#f5f7fa;border:1px solid var(--line);border-radius:6px;padding:8px 10px;margin-bottom:14px">${secret}</p>
        <label for="acc2faCode">6-digit code</label>
        <input id="acc2faCode" inputmode="numeric" maxlength="6" placeholder="123456"
          style="max-width:160px;letter-spacing:4px;font-size:18px;text-align:center;margin-bottom:12px">
        <div style="display:flex;gap:10px;align-items:center">
          <button id="acc2faConfirm" class="btn-primary" style="width:auto;padding:9px 22px;margin-top:0">Confirm &amp; enable</button>
          <button id="acc2faCancel" class="btn-ghost" style="margin-top:0">Cancel</button>
        </div>
        <p id="acc2faMsg" class="error" style="margin-top:8px"></p>
      </div>`;

    // Render QR locally (secret never leaves the browser)
    const QR = await loadQR();
    const qrEl = document.getElementById("acc2faQR");
    if (QR && qrEl) {
      new QR(qrEl, { text: uri, width: 184, height: 184, correctLevel: QR.CorrectLevel.M });
    } else if (qrEl) {
      qrEl.innerHTML = `<p class="muted small" style="text-align:center">QR unavailable — use the manual key above.</p>`;
    }

    document.getElementById("acc2faCancel").addEventListener("click", () => renderDisabled());
    document.getElementById("acc2faConfirm").addEventListener("click", async () => {
      const msg  = document.getElementById("acc2faMsg");
      const code = document.getElementById("acc2faCode").value;
      msg.style.color = "var(--danger)";
      if (!(await verifyTOTP(secret, code))) { msg.textContent = "That code isn't valid yet — check the app and try again."; return; }
      msg.style.color = "var(--muted)"; msg.textContent = "Saving…";
      try {
        await updateDoc(doc(db, col(), user.uid), { totpEnabled: true, totpSecret: secret });
        profile.totpEnabled = true; profile.totpSecret = secret;
        renderEnabled();
      } catch (err) { msg.style.color = "var(--danger)"; msg.textContent = err.message; }
    });
  }

  if (profile.totpEnabled && profile.totpSecret) renderEnabled();
  else renderDisabled();
}
