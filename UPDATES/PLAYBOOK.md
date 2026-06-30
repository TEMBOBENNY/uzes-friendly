# UZES Website — Full Playbook of Changes

> **Session:** This playbook documents every change, fix, audit finding, and improvement made during the current conversation session.  
> **Scope:** All changes are to the **local workspace** `G:\My Drive\web\uzes`. Deploy with `firebase deploy --only hosting --project=uzes-friendly-web`.  
> **Note:** No destructive changes (data deletion, account changes) were made. All work was front-end code and configuration analysis.

---

## Table of Contents

1. [Security Audit (Read-Only)](#1-security-audit-read-only)
2. [Bug Fixes](#2-bug-fixes)
3. [UI/UX Improvements](#3-uiux-improvements)
4. [Feature Additions](#4-feature-additions)
5. [Files Modified](#5-files-modified)
6. [Known Issues Remaining](#6-known-issues-remaining)
7. [Deploy Instructions](#7-deploy-instructions)

---

## 1. Security Audit (Read-Only)

A full read-only security and functional audit was performed across all 52 source files. **No code was edited during the audit.** The findings were compiled into:

📄 **File:** `G:\My Drive\web\uzes\AUDIT-REPORT.md`

### Critical Findings Documented

| # | Issue | File | Severity |
|---|-------|------|----------|
| C-1 | Firestore `users` collection allows any authenticated user to write their own `role` field — privilege escalation vector | `firestore.rules` | Critical |
| C-2 | Any logged-in user can read ALL collections: `students`, `payments`, `executives`, `income`, `expenses`, `reports`, `placements`, `vacancies`, `attachmentRequests` | `firestore.rules` | Critical |
| C-3 | Students can `update` their own payment records — can change `status` from `rejected` to `confirmed` | `firestore.rules` | Critical |
| C-4 | Payments `create` rule uses `resource.data` (which doesn't exist on `create`) — rule silently fails | `firestore.rules` | Critical |
| C-5 | Cloudflare Worker uses same `ADMIN_DELETE_SECRET` for both account deletion AND password reset | `workers/upload-worker/index.js` | Critical |
| C-6 | Any authenticated user can delete any file in R2 if they know the key | `workers/upload-worker/index.js` | Critical |
| C-7 | Rate limiting is in-memory only — bypassable across Cloudflare edge nodes | `workers/upload-worker/index.js` | Critical |
| C-8 | Attachment form adds duplicate `submit` event listeners every time tab is opened | `public/js/attachment.js` | Critical |
| C-9 | `approveAll()` has no race protection; `resetApproved()` deletes data permanently without archiving | `public/js/industrial-secretary.js` | Critical |
| C-10 | Registration doesn't check if computer number already exists | `public/js/register.js` | Critical |
| S-1 | Mass data exposure: any auth user reads all other students' personal data | `firestore.rules` | Critical |
| S-6 | Admin delete secret stored in Firestore `settings` document | `public/js/admin.js` + Worker | High |
| S-10 | No Content Security Policy (CSP) on any page | All HTML | Medium |
| S-12 | Storage rules allow any auth user to read all files | `storage.rules` | Medium |

> **Action:** These findings require manual remediation by the project owner. The audit report contains exact line numbers and fix suggestions for each issue.

---

## 2. Bug Fixes

### 2.1 Placement Update Details — Dashboard Escape Fix
**File:** `public/js/placement.js`  
**Root cause:** When the student tapped "Update Details", the `updateDoc` triggered `onSnapshot` immediately. The `onSnapshot` callback called `renderPlacementPanel()`, which replaced the entire form DOM via `innerHTML`. On some browsers, the `e.preventDefault()` was lost when the form was removed from the DOM mid-submission, causing a default GET submission that reloaded the page back to the dashboard.

**Fix:**
- Added `_isSubmitting` flag that blocks `onSnapshot` from re-rendering while the user is mid-submit
- Added `e.stopPropagation()` for extra safety
- Wrapped submit handler in a `finally` block to ensure the flag is always reset
- After successful save, the panel shows a clear **"Details Saved ✓"** success card with an **Edit Details** button, instead of silently replacing the form with no feedback
- Added `window.showToast` call for success and error states

**Lines changed:** `initPlacement` function (added `_isSubmitting` variable), `attachPendingFormListeners` function (wrapped in `try/finally`, added toast calls, success card HTML)

### 2.2 CSS Corruption — Missing Closing Brace
**File:** `public/css/styles.css`  
**Root cause:** A `@media (max-width: 640px)` block at line 516 opened with `{` but never had a matching `}`. The browser thought all CSS from line 516 to the end of the file was inside this mobile-only media query, so on desktop (width > 640px) everything after line 516 was invisible — including `.sub-hero`, `.sh-logo`, `.sh-tab`, `.sh-user-pill`, and all other logged-in page styles.

**Fix:** Added the missing `}` after `.card { padding: 14px 12px; margin-top: 12px; }` inside the `@media` block.

### 2.3 Theme Toggle Broken on Logged-In Pages
**File:** `public/js/chrome.js`  
**Root cause:** The MutationObserver in `chrome.js` only checked if the top-level added node had class `theme-toggle-btn`. When `subhero.js` injected the sub-hero bar via `innerHTML`, the toggle button was nested inside `.sh-bar`, not the top-level node itself. The observer never saw it, so the button had no click handler and showed a hardcoded `🌙` emoji.

**Fix:** The MutationObserver now checks both the node itself AND its descendants using `n.querySelectorAll(".theme-toggle-btn")`. Also added a `DOMContentLoaded` safety fallback that wires any buttons already in the static HTML.

### 2.4 Refresh Always Jumps to First Tab
**File:** `public/js/subhero.js`  
**Root cause:** When `subhero.js` initialized, it always activated the first in-page tab (the `active` parameter passed to `initSubHero`). It never checked the URL hash, so refreshing a page on "My Finance" would jump back to "Dashboard".

**Fix:** `subhero.js` now checks `location.hash` **first** before falling back to the default `active` tab. If the hash matches a valid tab ID, it activates that tab instead.

```javascript
const hash = location.hash.replace("#", "");
const initialId = hash && tabs.find(t => t.id === hash && !t.href) ? hash : active;
```

---

## 3. UI/UX Improvements

### 3.1 Toast Notification System
**File:** `public/js/chrome.js`  
Added a global `window.showToast()` function available on every page. Non-blocking slide-in notifications from the top-right corner.

```javascript
showToast({ type: "success", title: "Done", message: "Payment submitted" });
// types: success, error, warn, info
```

**Styles added to `styles.css`:** `.toast-container`, `.toast`, `.toast-success`, `.toast-error`, `.toast-warn`, `.toast-info`, with animations `toastIn` and `toastOut`.

### 3.2 Dark Mode Toggle
**File:** `public/js/chrome.js` + `public/css/styles.css` + all HTML pages

- Added full dark mode palette `[data-theme="dark"]` with GitHub-style dark colors (`#0d1117` background, `#161b22` cards, `#58a6ff` accent blue)
- Theme is stored in `localStorage` as `uzes-theme` and persists across page navigations
- Toggle button placed in:
  - **Public nav** (index.html, about.html, activities.html, faq.html, contact.html, support.html)
  - **Sub-hero bar** (student.html, executive.html, admin.html, library.html, attachment.html, industrial-secretary.html)
  - **Login page** (removed after user request — see section 4.3)

### 3.3 WhatsApp Floating Support Button
**File:** `public/js/chrome.js` + `public/css/styles.css`

- Green circular FAB at bottom-right
- **Desktop:** Shows "Support" label on hover
- **Mobile:** Smaller 48px button
- **Configurable:** Change `UZES_WHATSAPP_NUMBER` in `chrome.js` line 11 to your real support number
- **Restricted to students only** — hidden on admin, executive, TS, and public pages

### 3.4 Pull-to-Refresh (Mobile Only)
**File:** `public/js/chrome.js`

On mobile logged-in pages, a pull-down gesture from the top of the page triggers a page reload with a spinner indicator. Only activates on `student.html`, `executive.html`, `admin.html`, `library.html`, `attachment.html`, and `industrial-secretary.html`.

### 3.5 Student Dashboard Improvements
**File:** `public/js/student.js` + `public/css/styles.css`

| Feature | Before | After |
|---------|--------|-------|
| Greeting | Static "Welcome, [name]" | Time-aware: "Good morning, John" / "Good afternoon, John" / "Good evening, John" |
| Membership badge | Plain text badge | SVG progress ring with checkmark or exclamation icon |
| Payment history loading | "Loading…" text | Shimmer skeleton bars (`sk sk-title`, `sk sk-line`) |
| Empty payment state | "No payments submitted yet" | Illustrated empty state with 🧾 icon and CTA |
| Payment history | Plain rows | Searchable/filterable by category, method, status, or reference |
| Payment proof | File picker only | File picker with `capture="environment"` — opens camera on mobile |
| Payment submit success | Inline green text | Toast notification + inline message |

### 3.6 Mobile Payment Card Layout
**File:** `public/css/styles.css`

On mobile (`@media (max-width: 640px)`), payment history rows convert to bordered card-style layouts with larger touch targets and better spacing.

### 3.7 Placement Phone Formatter
**File:** `public/js/placement.js`

The phone number input in the placement form now auto-formats as the user types: `+260 97 123 4567`. Strips non-digits, rebuilds the format with proper spacing. Supports Zambian mobile number format.

### 3.8 Cache Busting
**All HTML files:** Bumped CSS query string from `?v=5` or `?v=6` to `?v=7` to force browsers to fetch the new stylesheet.

---

## 4. Feature Additions

### 4.1 TS Session Control Sub-Tabs
**Files:** `public/industrial-secretary.html` + `public/js/industrial-secretary.js`

The `Session Control` tab now has two sub-tabs (like student's "My Finance"):

1. **Letter Requests** — session toggle, contact details, training period, letterhead
2. **Placements** — pending TS review cards, company vacancies, add vacancy form

- Sub-tabs use `.ses-tabs` / `.ses-tab` / `.ses-panel` CSS classes
- Placements data is **lazy-loaded** — only fetches from Firestore when the user clicks the "Placements" sub-tab
- This prevents unnecessary Firestore reads on every page load

### 4.2 TS CV Review in Pending Placement Cards
**File:** `public/js/industrial-secretary.js`

The `renderTSReviewCard()` function now checks if the student has a CV (`placement.cvUrl`). If they do, a **"📄 REVIEW CV"** button appears below the "AWAITING REVIEW" status pill and above the action buttons. Clicking opens the CV in a new browser tab.

```html
<!-- Layout inside each card -->
AWAITING REVIEW
[📄 REVIEW CV] ← (new, below status, right-aligned)
[Approve & Send Letter] [Reject (no penalty)]
```

### 4.3 Login Page — No Toggle, Follows Homepage Theme
**File:** `public/login.html`

- The dark/light mode toggle button was **removed** from the login page
- The login page still loads `chrome.js`, which applies the theme stored in `localStorage` from the homepage
- After login, the user can toggle the theme from the sub-hero bar on any logged-in page

### 4.4 Forgot Password Flow
**Files:** `public/login.html` + `public/js/login.js`

- Added **"Forgot password?"** link below the Sign in button on `login.html`
- Clicking opens a modal asking for email address (or computer number)
- Uses Firebase's `sendPasswordResetEmail()` to send a real password reset link to the user's email
- Supports computer number lookup via the `compIndex` collection (same logic as login)
- Error handling for:
  - `auth/invalid-email` → "Invalid email address."
  - `auth/user-not-found` → "No account found with this email."
  - `auth/too-many-requests` → "Too many attempts. Try again later."
- Modal closes on backdrop click, Escape key, or after successful send
- Success message: "Reset link sent. Check your email."

---

## 5. Files Modified

| File | Changes |
|------|---------|
| `public/css/styles.css` | Added: toast styles, dark mode palette, WhatsApp FAB, theme toggle buttons, mobile payment cards, pull-to-refresh indicator, membership ring, search box, session sub-tab styles. **Fixed:** missing `}` after `@media (max-width: 640px)` block |
| `public/js/chrome.js` | Added: global `showToast()`, dark mode toggle system (with `localStorage` persistence), WhatsApp FAB (student-only), pull-to-refresh for mobile. **Fixed:** MutationObserver now detects descendant toggle buttons, added `DOMContentLoaded` fallback |
| `public/js/subhero.js` | **Fixed:** refresh tab persistence by checking `location.hash` before defaulting to first tab. Added theme toggle button in sub-hero bar |
| `public/js/placement.js` | **Fixed:** `_isSubmitting` gate prevents `onSnapshot` re-render during form submit. Added `e.stopPropagation()`. Added success card with "Edit Details" button. Added toast on save/error. Added phone number auto-formatter (`+260 XX XXX XXXX`) |
| `public/js/student.js` | Added: time-of-day greeting, membership progress ring, skeleton loaders for payment history, illustrated empty states, payment search/filter, camera capture for proof uploads, toast on payment submission |
| `public/js/login.js` | Added: `sendPasswordResetEmail` import, forgot password modal handler, computer number lookup for password reset, error handling for all Firebase auth error codes |
| `public/js/industrial-secretary.js` | Added: session sub-tab logic (`sesTabs`, `sesPanels`, lazy-load for placement data), **"📄 REVIEW CV"** button in `renderTSReviewCard()` |
| `public/industrial-secretary.html` | Added: session sub-tabs (`ses-tabs` wrapper with `Letter Requests` and `Placements` tabs), reorganized content into two `.ses-panel` divs, moved all placement content into the Placements sub-tab |
| `public/login.html` | Added: "Forgot password?" link, forgot password modal HTML. **Removed:** theme toggle button from login page. **Added:** `chrome.js` script tag for theme persistence |
| `public/index.html` | Added: theme toggle button in public nav. Bumped CSS `?v=5` to `?v=7` |
| `public/about.html` | Added: theme toggle button in public nav. Bumped CSS `?v=5` to `?v=7` |
| `public/activities.html` | Added: theme toggle button in public nav. Bumped CSS `?v=5` to `?v=7` |
| `public/faq.html` | Added: theme toggle button in public nav. Bumped CSS `?v=5` to `?v=7` |
| `public/contact.html` | Added: theme toggle button in public nav. Bumped CSS `?v=6` to `?v=7` |
| `public/support.html` | Added: theme toggle button in public nav. Bumped CSS `?v=6` to `?v=7` |
| `public/student.html` | Bumped CSS `?v=5` to `?v=7` |
| `public/executive.html` | Bumped CSS `?v=5` to `?v=7` |
| `public/admin.html` | Bumped CSS `?v=5` to `?v=7` |
| `public/register.html` | Bumped CSS `?v=5` to `?v=7` |
| `public/library.html` | Bumped CSS `?v=5` to `?v=7` |
| `public/attachment.html` | Bumped CSS `?v=5` to `?v=7` |
| `public/verify.html` | Bumped CSS `?v=3` to `?v=7` |
| `AUDIT-REPORT.md` | Created — full security audit report |
| `DEPLOY-INSTRUCTIONS.md` | Created — deployment guide (now partially outdated) |

---

## 6. Known Issues Remaining

These are **not yet fixed** and require either Firestore rule changes, backend worker changes, or manual action by the project owner.

| # | Issue | Why Not Fixed | Action Required |
|---|-------|---------------|-----------------|
| R1 | Firestore allows any user to read all other users' data | Requires changing `firestore.rules` — dangerous to edit without testing | Review and rewrite Firestore rules with role-based access |
| R2 | Students can self-escalate role in `users` collection | Requires `firestore.rules` change — lock down `role` field | Add `allow update` with field validation that rejects `role` changes |
| R3 | Students can update their own payment status | Requires `firestore.rules` change — remove student `update` on payments | Change `allow update` to `isExecOrAdmin()` |
| R4 | Same admin secret used for delete and password reset | Requires Cloudflare Worker env change | Create separate `ADMIN_DELETE_SECRET` and `PASSWORD_RESET_SECRET` |
| R5 | Any auth user can delete any file in R2 | Requires Cloudflare Worker code change | Check `customMetadata.uploadedBy` against request UID |
| R6 | In-memory rate limiting bypassable across edge nodes | Requires Cloudflare infrastructure change | Use Durable Objects or edge rate limiting rules |
| R7 | No Content Security Policy (CSP) | Requires Firebase Hosting config or HTML meta tag | Add CSP header to `firebase.json` hosting headers |
| R8 | No Firebase App Check enabled | Requires Firebase Console setup | Enable App Check in Firebase Console and add `App Check` to client SDK |
| R9 | Attachment form has duplicate event listeners | Code fix was attempted but needs deeper testing | The `_isSubmitting` fix helps, but a proper cleanup of listeners is still needed |
| R10 | `resetApproved()` deletes all approved requests without archiving | Code change needed — add `archive` collection before deletion | Modify `resetApproved()` to write to `archivedRequests` before deleting |
| R11 | Registration doesn't check for duplicate computer number | Requires Firestore transaction | Add `compIndex` lookup before creating account |
| R12 | No audit logging for admin actions | Requires new Firestore collection and code changes | Create `auditLogs` collection, log all critical actions |
| R13 | `execProfiles` allows any exec to overwrite another exec's profile | Requires `firestore.rules` change | Add ownership check: `resource.data.uid == request.auth.uid` |
| R14 | `library` collection doesn't allow users to delete their own uploads | Requires `firestore.rules` change | Add `allow delete: if request.auth.uid == resource.data.uploadedBy` |
| R15 | `industrial-secretary.js` `initPlacement()` standalone bootstrap conflicts when imported | Requires module structure change | Separate `initPlacement` from standalone bootstrap in `placement.js` |
| R16 | Admin password verification modal doesn't handle 2FA | Requires Firebase MFA handling | Check for `multiFactor` requirement before attempting password verification |
| R17 | `seedLibrary()` doesn't handle partial failures or deduplication | Requires batch deduplication check | Query existing documents before writing, or use a transaction |

---

## 7. Deploy Instructions

### Step 1: Deploy

```bash
firebase deploy --only hosting --project=uzes-friendly-web
```

### Step 2: Hard Refresh

After deploy, clear browser cache with `Ctrl+Shift+R` (or `Ctrl+F5`) on all pages.

### Step 3: Test Checklist

| Test | Expected Result |
|------|-----------------|
| Public homepage → toggle 🌙 in nav | Dark mode applies, persists to login page |
| Login page | No toggle visible. Already in dark mode if toggled on homepage. |
| Log in as student | Sub-hero has 🌙 toggle → click it → mode switches |
| Student dashboard | Says "Good morning/afternoon/evening, [Name]" |
| Student membership badge | Shows green ring with checkmark (if paid) or red with `!` (if not) |
| Payment history | Skeleton bars while loading, illustrated empty state if no payments, search box filters live |
| Submit payment | On mobile, proof input opens camera. Toast confirms "Payment submitted" after success. |
| Attachment Placement | Phone auto-formats to `+260 XX XXX XXXX`. Update Details → toast "Details Saved" → no dashboard jump. |
| Refresh on any tab | Stays on the same tab (e.g., My Finance) instead of jumping to Dashboard |
| WhatsApp button | Only visible on student.html and attachment.html, NOT on admin/executive/TS pages |
| Login page → "Forgot password?" | Opens modal → enter email → "Reset link sent. Check your email." |
| TS page → Session Control | Two sub-tabs: "Letter Requests" and "Placements". Clicking "Placements" loads data. |
| TS page → Placements → Pending Review | Cards with CV show "📄 REVIEW CV" button below status, opens CV in new tab. |

### Step 4: Configure WhatsApp Number

Edit `public/js/chrome.js` line 11:

```javascript
const UZES_WHATSAPP_NUMBER = "260979797979"; // ← CHANGE THIS TO YOUR REAL SUPPORT NUMBER
```

Save, then redeploy.

---

## Appendix A: CSS Validation

After all changes, the CSS file was validated programmatically:
- **Total lines:** 1131
- **Brace balance:** ✅ All opening and closing braces matched
- **No broken `[data-theme=` selectors**
- **No duplicate content blocks**

## Appendix B: Firebase Project ID

The correct project ID for deployment is **`uzes-friendly-web`** (from `.firebaserc`), not `uzes-8b5b0`.

```bash
firebase deploy --only hosting --project=uzes-friendly-web
```

---

*End of Playbook.*
