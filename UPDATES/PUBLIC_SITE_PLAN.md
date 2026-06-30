# UZES Public Website + Member Portal — Implementation Plan

Turns the current members-only payments tool into a public society website with the
payments/finance portal behind a login. Every feature below is tied to a duty in the
UZES Constitution (Revised 2014), so the site mirrors how the society is actually run.

Status: **PLAN ONLY — not yet built.** Reviewed decisions baked in:
- `index.html` becomes the **public home**; the login form moves to `login.html`.
- Public content is edited inside the existing executive dashboard (new tabs), gated by
  `position`, reusing the lazy-load pattern already used for Reports/Finances.

---

## 1. Constitution → feature map

| Feature | Constitution basis | Office that manages it | Phase |
|---|---|---|---|
| About page — exec **hierarchy** w/ photos + side detail | Art 5 (Patrons), Art 7 (composition) | Information & Publicity | B |
| FAQ | Art 8(7) publicity | Information & Publicity | C |
| Activities / events feed | Art 8(7) + 8(8), Art 20 (Welcome Party, MAFIFI's, BENG CUP) | **Info & Publicity + Social & Cultural** | D |
| News / announcements | Art 8(7) | Information & Publicity | E |
| Published monthly financial report + budget | Art 8(6); Art 14(5) books open to members | Treasurer (finance backend exists) | E |
| Membership / paid-up status card | Art 4 (compulsory; only paid-up recognized) | auto from existing `payments` | E |
| Council of Class Reps directory + issue reports | Art 13 | Vice Secretary | E |
| Industrial Training placement tracker | Art 3(i) "ensure ALL students are placed" | Secretary | E |
| Disciplinary Committee case log | Art 12 (7-day disposal, publish in 1 day) | Vice Chairperson | E |
| Elections — nominations, manifestos, results | Art 10–11 | Electoral Commission | E |
| Awards / honorary recognition | Art 20(b)(c) | Social & Cultural | E |
| Contact + affiliations (EIZ, UNZASU, Deans) | Art 2 | Info & Publicity | B |

Phases A–D are the public-facing core. E is the longer backlog.

---

## 2. Architecture changes

Current app has almost no public surface: the only unauthenticated page is the login,
and the only public-read collection is `compIndex`. The public site needs **public
pages** and **public-read Firestore collections**, with writes still locked to specific
executive positions.

### Role helpers (firestore.rules)
Mirror the existing `isTreasurer()` / `isChairOrVice()` helpers:

```
function isInfoPublicity() {
  return isExec() && 'position' in myProfile()
         && myProfile().position == 'Information and Publicity Secretary';
}
function isCultural() {
  return isExec() && 'position' in myProfile()
         && myProfile().position == 'Social and Cultural Secretary';
}
function isContentEditor()    { return isAdmin() || isInfoPublicity(); }
function isActivitiesEditor() { return isAdmin() || isInfoPublicity() || isCultural(); }
```

### New collections + rules

```
// Public exec directory (decoupled from /users, which is sensitive & not public-readable)
match /execProfiles/{id} {
  allow read:  if resource.data.published == true || isContentEditor();
  allow write: if isContentEditor();
}
match /faq/{id} {
  allow read:  if resource.data.published == true || isContentEditor();
  allow write: if isContentEditor();
}
match /siteContent/{id} {                 // singletons: about, home, contact
  allow read:  if true;
  allow write: if isContentEditor();
}
match /activities/{id} {
  allow read:  if resource.data.published == true || isActivitiesEditor();
  allow write: if isActivitiesEditor();
}
match /news/{id} {                         // phase E
  allow read:  if resource.data.published == true || isContentEditor();
  allow write: if isContentEditor();
}
```

`allow read: if resource.data.published == true` means public pages must query
`where('published','==',true)`; editor dashboards (signed in as a content editor) can
read drafts too. Writes get the same field validation rigor as existing rules
(string types + size caps) — see §4.

**Why a separate `execProfiles` collection** rather than reusing `/users`: `/users`
holds `role`/`active`/`email` and is only readable by self or execs. The About page
needs anonymous read, so we publish a curated, public-safe subset (name, position,
photo, bio, socials) into its own collection. No student data is ever made public.

---

## 3. Data model (new docs)

### execProfiles/{autoId}
```
name        string
position    string   // a POSITIONS value, or "Patron (Internal)" / "Patron (External)"
tier        number   // org-chart row: 1 Patron, 2 Chair, 3 Vice, 4 Sec/Treasurer,
                     //                5 ViceSec/Info/Cultural, 6 Committee
rank        number   // sort order within + across tiers
department  string?  yearOfStudy string?
bio         string
photoUrl    string   // Cloudinary, same pipeline as proof/signature uploads
email       string?  phone string?
socials     map?     // {facebook, x, linkedin, instagram, whatsapp}
linkedUid   string?  // optional link back to the /users exec account
published   bool
updatedAt   ts   updatedBy string
```

### faq/{autoId}
```
question  string   answer string
category  string?  // Membership | Payments | Events | General
order     number   published bool
updatedAt ts   updatedBy string
```

### activities/{autoId}
```
title       string   description string
category    string   // Sports | Cultural | Academic | Social | BENG CUP | Other
date        ts       // event date
location    string?
posterUrl   string?  // Cloudinary
status      string   // upcoming | ongoing | past | cancelled
managedBy   string   // "publicity" | "cultural"  (who created)
published   bool
createdAt ts  createdBy string  createdByName string  updatedAt ts
```

### siteContent/{docId}  (docId ∈ {about, home, contact})
```
about:   { mission, history, affiliations[], heroText }
home:    { heroTitle, heroSubtitle, ctaText }
contact: { email, phone, address, socials{} }
```

---

## 4. File-by-file changes

### Restructure (Phase A)
- **`public/login.html`** — new; the current `index.html` body (login card + `login.js`).
- **`public/index.html`** — rewritten as the public home (hero, nav, quick links, latest
  activities preview, "Sign in" → `login.html`).
- **`public/js/guard.js`** — unauthenticated / disabled redirects change
  `index.html` → `login.html` (3 spots). `routeByRole` default stays. `logout()` → `index.html`
  (public home).
- **`public/js/login.js`** — unchanged logic; just referenced from `login.html`.
- **`public/register.html`** — update any "back to login" link to `login.html`.
- **`public/js/admin.js`** — `resetPw` continuation URL `https://uzes-friendly-web.web.app/`
  still valid (lands on public home); optionally point to `/login.html`.
- **`public/js/nav.js`** — new; injects the shared public nav into a `<div id="site-nav">`
  placeholder on each public page (Home · About · Activities · FAQ · Sign in).
- **`public/css/styles.css`** — add public-site styles (navbar, hero, org-chart, FAQ
  accordion, activity cards). Large block; could split into `public.css`.

### About + content editor (Phase B)
- **`public/about.html`** + **`public/js/about.js`** — fetch published `execProfiles`
  ordered by `rank`, group by `tier` into org-chart rows with CSS connectors; click a node
  → side detail panel (modal on mobile). Loads `siteContent/about` for mission/affiliations.
- **`public/executive.html`** — add **"Public Content"** tab (hidden unless Info&Publicity
  or admin).
- **`public/js/content.js`** — new lazy-loaded module (like `reports.js`): CRUD for
  `execProfiles` (with photo upload via `upload.js`), edit `siteContent/about` & `contact`.
- **`public/js/executive.js`** — register the tab + position gate in `initTabs()` /
  bootstrap, matching the existing `isT`/`isCA` pattern.

### FAQ (Phase C)
- **`public/faq.html`** + **`public/js/faq.js`** — published FAQ accordion, grouped by category.
- FAQ CRUD added to `content.js` (new section in the Public Content tab).

### Activities (Phase D)
- **`public/activities.html`** + **`public/js/activities.js`** — published activities grid,
  filter by category, upcoming vs past.
- **`public/executive.html`** — add **"Activities"** tab (Info&Publicity OR Social&Cultural,
  or admin).
- **`public/js/activities-editor.js`** — lazy-loaded CRUD for `activities` (poster upload),
  both secretaries.

### Rules (each phase that adds a collection)
- **`firestore.rules`** — helpers (§2) + match blocks; `firebase deploy --only firestore:rules`.

---

## 5. Open decisions / risks

1. **Draft exposure** — public read is gated on `published==true`, so unpublished drafts
   stay private to editors. Keep nothing sensitive in any public collection regardless.
2. **Seeding exec profiles** — recommend manual curated entry by Info & Publicity, with an
   optional "import from exec accounts" button that prefills name/position from `/users`.
   (Auto-publishing every exec account risks leaking emails.)
3. **Photos** — reuse the existing Cloudinary unsigned preset (`uzes-unsigned`); no new infra.
4. **Shared nav** — JS injection (`nav.js`) keeps one source of truth on the static host;
   alternative is duplicating nav markup per page.
5. **App Check** is currently off (`RECAPTCHA_SITE_KEY=""`); public *reads* are open by
   design, public *writes* remain auth+role gated. No change needed for launch.

---

## 6. Suggested build order

- **A. Foundation/restructure** — home page, login move, nav, base CSS, rules scaffold.
- **B. About + exec hierarchy + Info&Publicity content editor.**
- **C. FAQ.**
- **D. Activities (shared Publicity + Cultural editor).**
- **E. Backlog** — news, public financial report, membership card, class reps,
  disciplinary log, elections, IT tracker (pick later).

Each phase is independently shippable.
