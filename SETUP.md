# UZES Payments — Setup (Phase 1: Foundation)

A simple web app for UZES membership/payment receipts. Students submit payments,
executives verify them, and a receipt is emailed automatically from the UZES Gmail.
The Patron (Assistant Dean, Undergraduate) is the admin.

**Stack:** Firebase (Auth + Firestore + Storage + Hosting), free Spark plan.
Receipt emails are sent later by a Google Apps Script relay (Phase 5) — no billing card needed.

---

## What you do (one-time, in your Google account)

### 1. Create the Firebase project
1. Go to https://console.firebase.google.com → **Add project** → name it e.g. `uzes-payments`.
2. (Google Analytics optional — you can skip it.)

### 2. Add a Web app
1. In the project, click the **`</>`** (Web) icon → register an app (nickname `uzes-web`).
2. Copy the **firebaseConfig** values shown.
3. Paste them into [`public/js/config.js`](public/js/config.js), replacing every `PASTE_…`.

### 3. Enable Authentication
1. Build → **Authentication** → Get started.
2. **Sign-in method** → enable **Email/Password**.

### 4. Create Firestore
1. Build → **Firestore Database** → Create database → **Production mode** → pick a region (e.g. `eur3` or closest).

### 5. Enable Storage
1. Build → **Storage** → Get started (production mode).

### 6. Create the first Admin (Patron) — bootstrap
Because only an admin can create accounts, seed the very first one by hand:
1. **Authentication → Users → Add user** → enter the patron's email + a password.
2. Copy that user's **User UID**.
3. **Firestore → Start collection** `users` → **Document ID = that UID** → fields:
   - `role` (string) = `admin`
   - `name` (string) = e.g. `Dr. ... (Assistant Dean UG)`
   - `email` (string) = the same email
   - `active` (boolean) = `true`
4. From now on, the admin creates everyone else inside the app (Phase 2).

### 7. (Later) Install the Firebase CLI to deploy
```
npm install -g firebase-tools
firebase login
firebase use --add        # pick your project
firebase deploy           # hosting + rules
```
Run these from the `uzes/` folder. Until then you can test locally with the preview.

---

## Project layout
```
uzes/
  firebase.json          hosting + rules wiring
  firestore.rules        role-based DB security
  storage.rules          upload security
  public/                the website (deployed)
    index.html           single login page (all roles)
    admin.html           patron dashboard      (Phase 2)
    executive.html       verification queue    (Phase 4)
    student.html         submit + track        (Phase 3)
    css/styles.css
    js/
      config.js          ← paste Firebase config here
      firebase.js        SDK init
      guard.js           login routing + page protection
      login.js           sign-in logic
```

## Roles
- **admin** — Patron (Assistant Dean UG). Manages students & executives, full oversight.
- **executive** — Chairperson, Vice, Secretary, Vice Sec, Treasurer, Info & Publicity,
  Social & Cultural, 3 Committee Members. Verify payments → trigger receipt email.
- **student** — submit payments, upload proof, track status, download receipts.

## Build progress
- [x] **Phase 1 — Foundation:** login, role routing, dashboards, security rules
- [ ] Phase 2 — Admin: manage student & executive accounts
- [ ] Phase 3 — Student: submit payment + proof upload + status
- [ ] Phase 4 — Executive: verification queue (confirm / reject)
- [ ] Phase 5 — Receipt generation + Apps Script email relay
- [ ] Phase 6 — Reports, Treasurer export, audit log
