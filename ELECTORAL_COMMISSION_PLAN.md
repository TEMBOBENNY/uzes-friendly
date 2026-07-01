# UZES Electoral Commission — System Architecture Plan

> **Scope:** Add a complete Electoral Commission module to the UZES web platform (Firebase + Firestore + vanilla JS).  
> **Audience:** Another AI implementation model. This document is pure architecture / specification — no code.
> **Date:** July 2025

---

## 1. Constitutional Basis (UZES Constitution, Revised 2014)

| Article | Requirement | System Impact |
|---|---|---|
| **Art. 7** | Executive = Chairperson, Vice Chairperson, Secretary, Vice Secretary, Treasurer, Information & Publicity Secretary, Social & Cultural Secretary, **3 Committee Members** | 8 voting positions on the student ballot. Committee Members = multi-select (exactly 3). |
| **Art. 9(a)** | Chairperson and Secretary must be **4th Year**, not graduating, paid-up, good character. | System **warns** EC Chair when adding a contestant for these two positions if year ≠ 4th. Does not block — EC Chair has final constitutional authority to approve. |
| **Art. 9(b)** | All other positions: not graduating, paid-up, good character. | System warns if year = 5th / Graduate. |
| **Art. 10(2)** | Elections by **secret ballot**. | `votes` collection must contain **no voter identity**. `voterTurnout` only tracks eligibility and double-vote prevention. |
| **Art. 10(3)** | Candidates pay a **non-refundable fee** to the EC. | `ecPayments` collection, separate from normal `payments`. |
| **Art. 10(5)** | Elected by **simple majority**. | Winner = highest vote count. No runoff. |
| **Art. 10(6)** | Vacancy → by-election within 10 days. | `electionCycles` supports multiple cycles; a by-election is just a new cycle with fewer positions. |
| **Art. 10(7–9)** | EC has 10 members; appointed by **outgoing Executive**; EC Chair elected by commissioners from among themselves. | System only creates **one** user login for the EC Chairperson. The other 9 commissioners are recorded as metadata on the election cycle (names, emails, gender) but do not need accounts. |
| **Art. 10(10)** | Candidates witness counting; responsible for poster removal; intimidation penalised. | Out of scope for v1 — procedural, not system-enforced. |
| **Art. 11** | EC duties: approve nominations, decide voting time, supervise, declare winner, compile report. | System gives EC Chair control over phases, live counts, publishing, and archive export. |

**Key deduction:** 5th Years are **graduating students** and therefore **ineligible to contest** (Art. 9). This means the UZES Chairperson (who was elected as a 4th Year and is now in 5th Year) is **not a contestant** in the current election cycle. The OTP for the "allow all students to vote" toggle can therefore be sent to the **UZES Chairperson** without conflict of interest.

---

## 2. High-Level Actors & Roles

| Actor | Role | Actions |
|---|---|---|
| **Admin (Patron)** | Creates the EC Chairperson account. Activates/deactivates the election cycle globally. Archives the cycle when done. | Toggle "Elections Active" in Admin → System. Toggle "Archive" which triggers archive export. |
| **EC Chairperson** | The **only** EC user with a login. Manages the full election lifecycle. | Approve nomination fees. Add contestants. Control election phases. View results. Publish. Call revotes. |
| **Student (Voter)** | Paid-up member (or all students if toggle is on). | View contestants during Campaigning. Vote during Voting. See published results. |
| **Student (Contester)** | Paid-up member, not graduating. | Submit EC nomination fee via My Finance. See own contestant card after approval. |
| **Public** | Non-logged-in visitors. | See published election results on `election-results.html`. |

---

## 3. Firestore Data Model

### 3.1 `electionCycles/{cycleId}` — Master Election Controller

```
cycleId           auto-generated or timestamp-based (e.g., "2024-2025")
name              string  "2024/2025 Executive Elections"
createdAt         timestamp
phase             string  "nominations" | "campaigning" | "voting" | "counting" | "published"
status            string  "active" | "archived"
allowAllStudents  boolean  default false
revote            null | { position, active, calledAt, closedAt }
  position        string  e.g., "Chairperson"
  active          boolean
  calledAt        timestamp
  closedAt        timestamp | null
publishedAt       timestamp | null
archivedAt        timestamp | null
ecCommissioners   array<map>   // metadata for all 10 commissioners
  [ { name, email, gender, isChair: true/false } ]
```

**Rules:**
- Admin creates the cycle (sets `status: "active"`, `phase: "nominations"`).
- EC Chairperson can transition `phase` forward. No backward transitions.
- Admin sets `status: "archived"` when the election is done. This triggers the archive export.
- `revote` is null during normal election. Populated by EC Chair when a tie is detected.

### 3.2 `ecPayments/{id}` — Nomination Fee Submissions

```
studentUid        string
studentName       string
compNumber        string
department        string
yearOfStudy       string
amount            number
method            string
proofUrl          string
status            string  "pending" | "confirmed" | "rejected"
reviewedBy        string  // EC Chair UID
reviewedAt        timestamp
rejectionReason   string
submittedAt       timestamp
```

**Rules:**
- Separate collection from `payments`. Not visible to other executives.
- 5th Years / Graduates are **blocked** from submitting by UI logic (not just Firestore rules). The My Finance form filters the EC option if `yearOfStudy === "5th Year" || "Graduate"`.
- Students can submit during the **Nominations** phase only. UI blocks submission outside this phase.

### 3.3 `contestants/{id}` — Approved Candidates

```
cycleId           string
studentUid        string
studentName       string
compNumber        string
department        string
yearOfStudy       string
position          string  // one of the 8 positions
photoUrl          string  // uploaded by EC Chair
manifestoUrl      string  // Google Drive link, optional, added by EC Chair
ecPaymentId       string  // MUST reference an ecPayment with status "confirmed"
status            string  "approved" | "disqualified" | "withdrawn"
disqualificationReason  string
createdAt         timestamp
approvedAt        timestamp
```

**Rules:**
- **No manual contestant addition.** A contestant can only be created from an **approved** `ecPayment`. The UI enforces this by surfacing an "Add as Contestant" button inline on each confirmed payment row.
- The system **warns** (yellow banner) if the student is 5th Year / Graduate or if Chairperson/Secretary is not 4th Year. It does **not** block — the EC Chair has constitutional authority to approve.
- `manifestoUrl` is a plain Google Drive link. Students click it and read in a new tab. No in-app viewer.

### 3.4 `votes/{autoId}` — Anonymous Ballots

```
cycleId           string
position          string
contestantId      string
round             string  "main" | "revote"
votedAt           timestamp
```

**Rules:**
- **Absolutely no voter identity.** One document per vote.
- For Committee Members, **3 separate `votes` docs** are written (one per selected contestant).
- `round: "revote"` used only when a revote has been called for a specific position.

### 3.5 `voterTurnout/{uid}` — Double-Vote Prevention & Audit

```
cycleId           string
mainRound         map<position, contestantId | array<contestantId>>
  Chairperson           string
  Vice Chairperson      string
  Secretary             string
  Vice Secretary        string
  Treasurer             string
  Information and Publicity Secretary  string
  Social and Cultural Secretary        string
  Committee Members     array<string>  // 3 IDs
revotes           map<position, map>
  {position}:
    contestantId    string
    votedAt         timestamp
submittedAt       timestamp
```

**Rules:**
- Only the **student** (via their UID) and **EC Chair / Admin** can read this doc.
- During the main round, the student writes once. After that, the Elections tab is locked.
- During a revote, only the **revote position** field is updated. The rest of the doc is immutable.
- If a student has already voted in the main round, they can still vote in a revote for the tied position.

### 3.6 `draftSelections/{uid}` — Campaigning Pre-Selections

```
cycleId           string
selections        map<position, contestantId | array<contestantId>>
  // same shape as voterTurnout.mainRound
updatedAt         timestamp
```

**Rules:**
- Students write this during **Campaigning** phase when they press "Done" on each position tab.
- During **Voting** phase, the system pre-loads these selections into the ballot UI. The student can change them before final submit.
- On successful submit, the `draftSelections` doc is **deleted** to avoid confusion.
- If a student never pressed "Done" during Campaigning, they start with blank selections during Voting.

### 3.7 `electionStats/{cycleId}` — Live Aggregates (Single Document)

```
totalStudents             number
totalPaidMembers          number
votesCast                 number
turnoutPercent            number
votesByDepartment         map<dept, count>
votesByYear               map<year, count>
positionResults           map<position, object>
  {position}:
    totalVotes            number
    contestants           map<contestantId, voteCount>
    winner                string | null      // contestantId (single) or array (committee)
    isTie                 boolean
    isRevoteActive        boolean
```

**Rules:**
- Updated **by Cloud Function** or **batched client write** when votes are submitted.
- EC Chair's Results tab reads **only this document** — fast, real-time.
- `isTie` is computed per position. If true, EC Chair sees a "Call Revote" button.
- For Committee Members, `winner` is an array of the top 3 contestantIds. `isTie` is true if 3rd and 4th place are tied.

### 3.8 `electionArchives/{cycleId}` — Soft Archive (Admin only)

```
// Auto-generated when Admin archives the cycle.
// Contains a snapshot of the full election data:
- cycle metadata
- contestants (with photo URLs, manifesto URLs)
- aggregated vote counts
- voter turnout summary (counts only, no individual voter links)
- financial summary (total EC fees collected)
- revote history
```

**Rules:**
- Original data in `votes`, `contestants`, `ecPayments` remains in place with `cycleId` filtering. Nothing is deleted.
- Admin can download an **Excel export** containing all contestant details, vote counts broken down by position, department/year turnout, and financials.

---

## 4. Election Phase Lifecycle

```
Admin creates cycle
        ↓
  [NOMINATIONS]
  • Students submit EC fees
  • EC Chair approves payments
  • EC Chair adds contestants (from approved payments only)
  • EC Chair can disqualify
        ↓
  EC Chair clicks "Advance to Campaigning"
        ↓
  [CAMPAIGNING]
  • Students see all contestants
  • Students can click "View Manifesto" (Drive link)
  • Students select candidates, press "Done" per position
  • Selections saved to draftSelections
  • Submit button DISABLED: tooltip says "Voting will open when the Electoral Commission activates it."
        ↓
  EC Chair clicks "Advance to Voting"
        ↓
  [VOTING]
  • Students see pre-loaded selections from draftSelections
  • Students can edit selections
  • Submit button ENABLED
  • On submit: writes anonymous votes, writes voterTurnout, deletes draftSelections
  • Students who already voted see locked tab: "You have already voted."
        ↓
  EC Chair clicks "Advance to Counting"
        ↓
  [COUNTING]
  • Voting closes automatically
  • System aggregates all votes into electionStats
  • EC Chair sees Results tab with live counts per position
  • If tie detected: EC Chair clicks "Call Revote for {Position}"
        ↓
  [REVOTE — if triggered]
  • electionCycles.revote = { position, active: true }
  • Students see ONLY the revote position active; all others locked
  • Students who voted in main round can vote again on this position
  • EC Chair clicks "Close Revote" when done
  • System re-aggregates only revote ballots for that position
  • Winner updated in electionStats
        ↓
  [No ties → or ties resolved]
  EC Chair clicks "Publish Results"
        ↓
  [PUBLISHED]
  • electionCycles.publishedAt = timestamp
  • `election-results.html` becomes visible in public nav
  • Public sees winner cards + statistics
        ↓
  Admin clicks "Archive Election" in Admin → System
        ↓
  [ARCHIVED]
  • electionCycles.status = "archived", archivedAt = timestamp
  • Archive doc created in electionArchives
  • Excel export available for download
  • New cycle can be created
```

---

## 5. Student Voting UI (student.html → Elections Tab)

### 5.1 Tab Placement

Add as the **last** tab in the student sub-hero:
```
Dashboard | My Finance | Account | Library | Attachment Letter | Attachment Placements | Elections
```

### 5.2 Gating States

| State | What Student Sees |
|---|---|
| Elections not active | "Elections are currently closed." |
| Not paid-up & !allowAllStudents | "Pay your membership dues to vote." |
| Already voted (main round) | "You have already voted. Thank you for participating." |
| Phase = Nominations | "Nominations are open. The candidate list will be available soon." |
| Phase = Campaigning / Voting / Revote | Full ballot UI |

### 5.3 Position Sub-Tabs

Inside the Elections panel, a **horizontal sub-tab bar**:
```
[Chairperson] [Vice Chairperson] [Secretary] [Vice Secretary] [Treasurer] [Information & Publicity] [Social & Cultural] [Committee Members]
```

Each tab shows a ✓ when the student has selected and pressed "Done".

### 5.4 Contestant Card

```
┌─────────────────────────────┐
│  [Photo]                    │
│  Chanda Mwale               │
│  202301234                  │
│  4th Year | Civil           │
│  [View Manifesto] → Drive   │
│  ○ Select                   │
└─────────────────────────────┘
```

- **Manifesto:** Clickable link to Google Drive. Opens in new tab. No in-app viewer.
- **Photo:** Uploaded by EC Chair during nomination approval.

### 5.5 Single-Position Voting (Chairperson → Social & Cultural)

- **Radio buttons** for selection.
- Press **Done** → tab collapses to summary: `Chairperson ✓ — Chanda Mwale`
- Tap tab again to re-open and change.
- **During Campaigning:** "Done" saves to `draftSelections`. Submit button is disabled.
- **During Voting:** "Done" updates local state. Submit button is enabled.
- **During Revote:** All positions except the revote one are locked (showing "Already voted"). Only the revote position is active.

### 5.6 Committee Members — Multi-Select (Exactly 3)

```
Committee Members (2/3 selected)     ← live counter
┌────────┐  ┌────────┐  ┌────────┐  ┌────────┐
│ [Photo]│  │ [Photo]│  │ [Photo]│  │ [Photo]│
│ Name   │  │ Name   │  │ Name   │  │ Name   │
│ Comp#  │  │ Comp#  │  │ Comp#  │  │ Comp#  │
│  ☐     │  │  ☑     │  │  ☑     │  │  ☐     │
└────────┘  └────────┘  └────────┘  └────────┘

[Done] ← disabled if counter ≠ 3
```

**Edge cases:**
- **< 3 candidates:** Adaptive message. If 2 candidates: "Select up to 2 candidates" (both win by default). If 1: auto-selected.
- **Error messages:** "Select 3 candidates" (if < 3 checked). "You can only select 3 candidates" (if > 3 checked — auto-prevent or show error).

### 5.7 Final Confirm Panel

After all tabs show ✓, a bottom panel appears:

```
Your Selections
  Chairperson:        Chanda Mwale
  Vice Chairperson:   Mwape Banda
  Secretary:          Mutale Chileshe
  ...
  Committee Members:  [Name A, Name B, Name C]

[Confirm Selection and Submit]
  ← During Campaigning: DISABLED, tooltip "Voting will open when the
     Electoral Commission activates it."
  ← During Voting: ENABLED
```

**On Submit:**
1. Write anonymous `votes` docs (one per selection, 3 for Committee Members).
2. Write `voterTurnout` doc.
3. Delete `draftSelections` doc.
4. Lock Elections tab: "You have already voted. Thank you for participating."
5. Show a **Vote Receipt** (random hash token) — student can screenshot for dispute resolution. The token is not linked to their vote choices.

### 5.8 Revote UI

When a revote is called for a specific position:
- The Elections tab re-opens for **all students who voted in the main round**.
- **All other positions** are locked and show: "Already voted" (blank cards, no names, no selection buttons).
- **Only the revote position** shows active contestant cards.
- Student selects again, presses Done, then submits.
- The vote is written with `round: "revote"`.
- `voterTurnout` is updated only for the revote position.

---

## 6. EC Chairperson Page (`ec-chair.html`)

### 6.1 Page Structure

Follows the `industrial-secretary.html` pattern — a **dedicated page** with its own sub-hero tabs, separate from the regular `executive.html`.

**In `executive.js` / `guard.js`:** If `profile.position === "EC Chairperson"`, redirect to `ec-chair.html`.

### 6.2 Tab Structure (5 Tabs)

| Tab | Content |
|---|---|
| **Dashboard** | Election Control Card (phase manager) + KPI cards (total nominations, fees collected, votes cast, turnout %). |
| **Nominations** | EC Payment approval list + inline "Add as Contestant" form (no manual bypass). Disqualify button. |
| **Overview** | Student totals (all / paid-up), broken down by department & year. "Allow all students to vote" toggle (OTP-gated). |
| **Results** | Live vote counts per position, bar charts, tie detection, revote controls, Publish button. |
| **My Profile** | Signature, password change, etc. (same as other executives). |

### 6.3 Dashboard — Election Control Card

```
┌─────────────────────────────────────────────────────────┐
│  Election Control                        Phase: NOMINATIONS │
├─────────────────────────────────────────────────────────┤
│  ┌────────────┐    ┌────────────┐    ┌────────────┐   │
│  │ Nominations│ →  │ Campaigning│ →  │  Voting    │   │
│  │   [active] │    │            │    │            │   │
│  └────────────┘    └────────────┘    └────────────┘   │
│         ↓                 ↓                 ↓            │
│  ┌────────────┐    ┌────────────┐    ┌────────────┐   │
│  │  Counting  │ →  │  Published │ →  │  Archived* │   │
│  │            │    │            │    │  (Admin)   │   │
│  └────────────┘    └────────────┘    └────────────┘   │
│                                                         │
│  [Advance to Campaigning]                               │
│  ⚠️ This action cannot be reversed.                     │
└─────────────────────────────────────────────────────────┘
```

**Phase buttons:**
- **Nominations → Campaigning:** EC Chair clicks "Advance". All approved contestants become visible to students. No new EC payments can be submitted after this.
- **Campaigning → Voting:** EC Chair clicks "Advance". Student Submit buttons unlock.
- **Voting → Counting:** EC Chair clicks "Advance". Voting closes. System aggregates.
- **Counting → Published:** EC Chair clicks "Publish Results". Requires confirmation modal.
- **Published → Archived:** Only Admin can trigger this from Admin → System tab.

### 6.4 Nominations Tab — Payment → Contestant Pipeline

```
┌─────────────────────────────────────────────────────────┐
│  EC Payment Approvals                                   │
├─────────────────────────────────────────────────────────┤
│  John Banda    K50    Airtel Money    [View Proof]      │
│  Status: PENDING                                        │
│  [Approve] [Reject]                                     │
│                                                         │
├─────────────────────────────────────────────────────────┤
│  Mary Chileshe K50    MTN Money       [View Proof]      │
│  Status: CONFIRMED    ✅ Approved by you on 12 Jul      │
│  [+ Add as Contestant] ← ONLY appears after approval    │
└─────────────────────────────────────────────────────────┘
```

**"+ Add as Contestant" Modal:**
- Pre-filled: name, comp#, department, year from the `ecPayment` doc.
- **Position dropdown:** Required. Must select one of the 8 positions.
- **Photo upload:** Required. EC Chair uploads contestant photo.
- **Manifesto URL:** Optional. Google Drive link. EC Chair pastes it.
- **Warning banner:** If student is 5th/Graduate, or if Chairperson/Secretary and not 4th Year → yellow warning. EC Chair can still save.
- **Save:** Creates `contestant` doc. Links back to `ecPaymentId`.

**No standalone "Add Contestant" button.** The only entry point is through an approved EC payment.

**Disqualify:** After a contestant is saved, a red "Disqualify" button appears. Sets `status: "disqualified"`, requires a reason note. Disqualified contestants are hidden from the ballot but retained in the record.

### 6.5 Results Tab — Live Counts, Tie Detection, Revote

```
┌─────────────────────────────────────────────────────────┐
│  Live Results (Phase: Counting)                         │
├─────────────────────────────────────────────────────────┤
│  Chairperson                          Total: 412 votes │
│  ┌─────────────────────────────────────┐                │
│  │ ▓▓▓▓▓▓▓▓▓▓▓▓▓▓▓ 234  Chanda Mwale  │  🏆 Winner    │
│  │ ▓▓▓▓▓▓▓▓          120  Mwape Banda   │                │
│  │ ▓▓▓▓               58  Mutale Chileshe│                │
│  └─────────────────────────────────────┘                │
│                                                         │
│  Vice Chairperson                     Total: 412 votes │
│  ┌─────────────────────────────────────┐                │
│  │ ▓▓▓▓▓▓▓▓▓▓▓▓▓▓▓▓▓ 206 John Banda   │                │
│  │ ▓▓▓▓▓▓▓▓▓▓▓▓▓▓▓▓   206 Mary Chileshe│                │
│  └─────────────────────────────────────┘                │
│  ⚠️ TIE DETECTED — 206 vs 206                           │
│  [Call Revote for Vice Chairperson]                     │
│                                                         │
│  Committee Members (Top 3)            Total: 412 votes │
│  ...                                                    │
├─────────────────────────────────────────────────────────┤
│  [Publish Results]  ← disabled if any unresolved tie   │
└─────────────────────────────────────────────────────────┘
```

**Revote Flow:**
1. System detects tie in `electionStats` (same highest vote count for a single position; or 3rd/4th tie for Committee Members).
2. EC Chair clicks **"Call Revote for {Position}"**.
3. Modal confirmation: "This will open re-voting for {Position} only. All students who voted will be notified. Continue?"
4. System sets `electionCycles.revote = { position: "Vice Chairperson", active: true, calledAt: timestamp }`.
5. Students see revote UI (only that position active, others locked with "Already voted").
6. New votes are written with `round: "revote"`.
7. EC Chair clicks **"Close Revote"** when satisfied.
8. System re-aggregates only revote ballots for that position.
9. Winner is updated in `electionStats`. Previous main-round votes remain in `votes` for audit but are **ignored** in the final result.

**Committee Members Tie:** If 3rd and 4th place are tied, the revote is between those two candidates only. Students still select 3 total, but the pool is reduced. The system adapts the UI accordingly.

### 6.6 Overview Tab — Student Stats & "Allow All Students to Vote" Toggle

```
┌─────────────────────────────────────────────────────────┐
│  Student Overview                                       │
├─────────────────────────────────────────────────────────┤
│  Total students: 450                                    │
│    ├─ Civil: 120 | Electrical: 110 | Mechanical: 100   │
│    └─ Geomatic: 70 | Agricultural: 50                   │
│                                                         │
│  Paid-up members (eligible voters): 380                 │
│    ├─ 1st Year: 80 | 2nd Year: 90 | 3rd Year: 85     │
│    └─ 4th Year: 75 | 5th Year: 50                      │
│                                                         │
│  ─────────────────────────────────────────────────────  │
│  [Toggle] Allow all students to vote (not just paid)    │
│  Currently: OFF                                         │
│  Clicking ON requires OTP sent to UZES Chairperson      │
│  (non-contestant, 5th year — no conflict of interest)   │
└─────────────────────────────────────────────────────────┘
```

**OTP Flow:**
1. EC Chair toggles ON.
2. System generates 6-digit OTP, sends to **UZES Chairperson's email** (stored in `executives/{uid}`).
3. EC Chair enters OTP in modal.
4. System validates OTP hash (stored in `settings/ecRevoteOtp` or similar, expires in 10 min).
5. On success: `allowAllStudentsVote = true`.

**Why UZES Chairperson?** They are 5th Year (graduating) and therefore **ineligible to contest** in the current election. No conflict of interest exists.

---

## 7. Admin (Patron) — Minimal UI

The Admin is **not** burdened with election tabs. Admin involvement is limited to:

### 7.1 Admin → System Tab

Add one section:
```
┌─────────────────────────────────────────────────────────┐
│  Election Management                                    │
├─────────────────────────────────────────────────────────┤
│  [Create Election Cycle]  ← only if no active cycle       │
│  Active Cycle: 2024/2025 Executive Elections            │
│  Phase: Voting                                          │
│  [Archive Election]  ← only when phase = Published      │
│  Archive will export all data to Excel.                 │
│  ⚠️ This action is irreversible.                        │
└─────────────────────────────────────────────────────────┘
```

**Create Election Cycle:**
- Modal: Enter election name (e.g., "2024/2025 Executive Elections").
- System creates `electionCycles` doc with `status: "active"`, `phase: "nominations"`.
- Admin must also create the EC Chairperson account (same as other executives, position = "EC Chairperson").

**Archive Election:**
- Sets `status: "archived"`, `archivedAt = timestamp`.
- Triggers Excel export (generated client-side or Cloud Function).
- Creates `electionArchives` doc with full snapshot.
- Original data remains in place for historical lookup.

---

## 8. Public Results Page (`election-results.html`)

### 8.1 Navigation Link

The link is **dynamically injected** into `index.html`, `activities.html`, etc., when `electionCycles.resultsPublished === true`.

```js
if (published) {
  navLinks.insertAdjacentHTML("beforeend", `<a href="election-results.html">Election Results</a>`);
}
```

### 8.2 Page Layout

```
┌─────────────────────────────────────────┐
│  UZES Executive Election Results 2024   │
│  Published: 15 July 2024                │
├─────────────────────────────────────────┤
│  Chairperson 🏆                         │
│  ┌────────┐  Chanda Mwale               │
│  │ [Photo]│  4th Year | Civil           │
│  │        │  202301234                  │
│  └────────┘  234 votes (56.8%)          │
│  (Manifesto: [View on Google Drive])    │
├─────────────────────────────────────────┤
│  Vice Chairperson 🏆                    │
│  ┌────────┐  John Banda                │
│  │ [Photo]│  3rd Year | Electrical      │
│  │        │  202202345                  │
│  └────────┘  215 votes (52.2%)          │
│  (Revote held)                          │
├─────────────────────────────────────────┤
│  Committee Members 🏆 (3)               │
│  ┌────────┐ ┌────────┐ ┌────────┐       │
│  │ [Photo]│ │ [Photo]│ │ [Photo]│       │
│  │ Name 1 │ │ Name 2 │ │ Name 3 │       │
│  └────────┘ └────────┘ └────────┘       │
├─────────────────────────────────────────┤
│  [View Full Statistics]                 │
│  → Total votes cast: 412                │
│  → Turnout: 91.5%                       │
│  → Department turnout graph               │
│  → Year turnout graph                     │
│  → Per-position vote counts               │
│  → Per-contestant vote counts (all)     │
└─────────────────────────────────────────┘
```

**Note:** Manifesto links are shown on the public results page so the wider student body can read them.

---

## 9. My Finance — Student Payment Flow

### 9.1 EC Payment Category

Add a new category in the student My Finance → Submit Payment:
```
Payment For: [Membership Dues ▼] [Event Fee ▼] ... [EC Nomination Fee ▼]
```

**Rules:**
- The EC Nomination Fee option **only appears when** an election cycle is active (`status: "active"`).
- The EC Nomination Fee option **only appears when** the student is a **paid-up member** (has at least one confirmed "Membership Dues" payment).
- The EC Nomination Fee option is **hidden** for 5th Years and Graduates (ineligible per constitution).
- If the student is not a paid-up member: show message "Pay your membership dues to access the nomination fee."
- If the student is 5th Year / Graduate: option is simply not in the dropdown.
- The payment goes to `ecPayments` collection, not `payments`.

---

## 10. Firestore Rules Summary (Key Additions)

```
function isECChair() {
  return isExec() && 'position' in myProfile()
         && myProfile().position == 'EC Chairperson';
}

// EC Payments
match /ecPayments/{id} {
  allow read: if isECChair() || isAdmin();
  allow create: if signedIn() && myActive() && myRole() == 'student'
                && request.resource.data.studentUid == myUid();
  allow update: if isECChair() || isAdmin();
}

// Election cycles
match /electionCycles/{id} {
  allow read: if signedIn() && myActive();
  allow create: if isAdmin();
  allow update: if isECChair() || isAdmin();
}

// Contestants
match /contestants/{id} {
  allow read: if resource.data.cycleId == getCurrentCycleId()
               || isECChair() || isAdmin();
  allow create: if isECChair() || isAdmin();
  allow update: if isECChair() || isAdmin();
}

// Votes (anonymous)
match /votes/{id} {
  allow create: if signedIn() && myActive() && isEligibleVoter();
  allow read: if isECChair() || isAdmin();
}

// Voter turnout (prevents double voting)
match /voterTurnout/{uid} {
  allow read: if isECChair() || isAdmin() || myUid() == uid;
  allow create: if signedIn() && myUid() == uid;
  allow update: if signedIn() && myUid() == uid && isRevoteUpdate();
}

// Draft selections (campaigning previews)
match /draftSelections/{uid} {
  allow read, write: if signedIn() && myUid() == uid;
}

// Election stats (live aggregates)
match /electionStats/{id} {
  allow read: if isECChair() || isAdmin();
  allow write: if isECChair() || isAdmin();
}

// Election archives
match /electionArchives/{id} {
  allow read: if isAdmin();
  allow write: if isAdmin();
}
```

---

## 11. Implementation Phases

| Phase | Deliverable | Complexity |
|---|---|---|
| **P1** | Admin toggle to create election cycle. `electionCycles` schema. EC Chairperson as a new position in `POSITIONS`. `ec-chair.html` scaffold + 5 tabs. Dashboard with Election Control card. | Medium |
| **P2** | Student Elections tab. Position sub-tabs. Contestant cards. Done/Save logic. `draftSelections` collection. Phase-gated UI (Campaigning vs Voting). | High |
| **P3** | EC Chair Nominations tab. `ecPayments` collection. Payment approval → inline "Add as Contestant" (no manual bypass). Photo upload + manifesto URL. Contestant `status` workflow. | High |
| **P4** | Phase transitions (Campaigning → Voting → Counting). `electionStats` aggregation. `votes` + `voterTurnout` collections. | High |
| **P5** | Tie detection + Revote system. `electionCycles.revote` object. Student revote UI (blank cards on locked positions, "Already voted" message). Revote re-aggregation. | Medium |
| **P6** | Publish results. `election-results.html` public page. Dynamic nav link injection. Analytics graph (turnout, dept/year breakdown). | Medium |
| **P7** | Admin archive toggle. `electionArchives` doc. Excel export. | Low |
| **P8** | My Finance integration. EC Nomination Fee category. 5th Year lock. Paid-up membership gate. | Medium |

---

## 12. Edge Cases & Decisions

| Edge Case | Decision |
|---|---|
| **Student pays EC fee but is not paid-up member** | UI prevents submission. The dropdown filters out "EC Nomination Fee" if membership check fails. |
| **5th Year student tries to pay EC fee** | Dropdown simply does not show "EC Nomination Fee". No error message needed. |
| **EC Chair tries to add contestant without approved payment** | Impossible. The UI only shows the "+ Add as Contestant" button on confirmed `ecPayment` rows. |
| **Revote called but student never voted in main round** | They can still vote in the revote. The system treats them as a new voter for that position. |
| **Revote called but student already voted in main round** | They see "Already voted" on all other positions. Only the revote position is active. |
| **Only 1 or 2 candidates for Committee Members** | UI adapts. "Select up to 1" or "Select up to 2". Both win by default. Done button enables at that threshold. |
| **Tie in Committee Members (3rd and 4th place)** | Revote between the two tied candidates only. Students still pick 3 total, but the pool is reduced. |
| **Contestant withdraws after Campaigning starts** | EC Chair clicks "Withdraw". Contestant is hidden from ballot. Votes already cast for them are still counted (as per constitution, candidates are present for counting). If the withdrawn candidate was winning, the EC Chair may call a revote manually. |
| **Admin tries to create second active cycle** | UI blocks. Only one active cycle allowed at a time. |
| **Election needs to be cancelled mid-way** | Admin sets `status: "archived"` immediately. No results are published. All data is preserved in the archive. |
| **Cloud Function vs Client Aggregation** | For v1, use **batched client writes** on vote submission to update `electionStats`. If load is high, migrate to Cloud Function later. |
| **Vote receipt token** | A random 8-character alphanumeric string is shown after submit. It is stored in `voterTurnout.receiptToken` but **not** linked to vote choices. Student can screenshot it to prove they voted (not who they voted for). |
| **Photo storage** | Contestant photos are uploaded to the same Cloudflare R2 / Worker system used for payment proofs. Stored in a path like `elections/{cycleId}/contestants/{contestantId}/photo`. |
| **Manifesto link validation** | Simple regex check for `drive.google.com` or `docs.google.com`. Not strict — EC Chair can paste any link. |
| **Election results on public page after archive** | The `election-results.html` page reads from `electionArchives` and `contestants` (filtered by cycleId). It remains accessible even after archiving. |
| **Committee Members selection logic** | Students select exactly 3 (or up to N if fewer candidates). The 3 candidates with the highest vote counts win. The system does not use ranked choice or proportional representation — pure simple majority per seat. |
| **Admin vs EC Chair permission overlap** | Admin can read everything but does not have phase controls. Only the EC Chair can advance phases and call revotes. Admin can only create and archive cycles. |
| **What if the EC Chair is also the UZES Chairperson?** | Not possible in practice. The outgoing executive appoints the EC (Art. 10.8). The EC Chair is elected by the commissioners (Art. 10.9). The EC Chair is a separate role from the UZES Chairperson. Even if the same person holds both, they are 5th Year and ineligible to contest, so no conflict. |

---

## 13. Open Questions for Another AI Reviewer

1. **Should the system enforce the 4th Year requirement for Chairperson/Secretary as a hard block, or keep it as a warning?** The constitution says "shall" but the EC Chair has the authority to approve nominations. A hard block might be too restrictive if the EC Chair makes an exception.

2. **Should the EC Chair be able to edit a contestant's photo or manifesto after Campaigning has started?** Editing might be needed for corrections, but it could confuse students who have already made selections.

3. **Should the system send FCM push notifications to students when phases change (e.g., "Voting is now open")?** This would increase turnout but adds complexity.

4. **Should the vote receipt token be emailed to the student as well as shown on screen?** Email provides a paper trail, but the system does not have the student's email reliably (some use phone numbers).

5. **Should the system allow the EC Chair to set a deadline for each phase (e.g., "Nominations close on 10 July")?** This would auto-advance the phase but removes human control.

6. **Should the public results page show per-contestant vote counts (e.g., "Chanda got 234 votes, Mwape got 120") or only the winner?** The constitution says the EC Chair "declares the winner" — it does not mandate publishing full vote counts. However, transparency is desirable.

7. **Should the EC Chair be able to see who voted but not who they voted for?** The `voterTurnout` doc shows which students voted (and which positions they voted on). This is acceptable for eligibility auditing but should not be public.

8. **Should the system support by-elections (Art. 10.6) as a new mini-cycle with only one position, or as a special mode within the same cycle?** A new mini-cycle (`electionCycles` doc with only one position populated) is cleaner.

9. **Should the 5th Year lock apply to the entire My Finance tab, or only the EC Nomination Fee dropdown?** The user specified only the EC fee. The 5th Year student can still pay Membership Dues, Event Fees, etc.

10. **Should the EC Chair be able to manually trigger a revote even if the system does not detect a tie?** (e.g., if they suspect irregularities). The constitution gives the EC broad powers to "ensure transparent, democratic, free and fair" elections.

---

*End of Plan.*
