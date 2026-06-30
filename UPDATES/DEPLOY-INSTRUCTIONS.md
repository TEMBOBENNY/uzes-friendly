Here are the **exact steps** to rollback and deploy.

I can’t run the Firebase CLI from here, but I’ll walk you through it in your **VS Code terminal**.

---

## Step 1: Roll back to the last clean release

In your VS Code terminal, run:

```bash
firebase hosting:releases:list --project=uzes-8b5b0
```

You’ll see a table like:

```
╔═══════════╤════════════════════════════════════╤═══════════╗
║ Release   │ Time                               │ Author    ║
╠═══════════╪════════════════════════════════════╪═══════════╣
║ 123456789 │ 2025-07-15T14:22:00.000Z           │ You       ║
║ 123456788 │ 2025-07-15T10:15:00.000Z           │ You       ║ ← likely clean
╚═══════════╧════════════════════════════════════╧═══════════╝
```

Copy the **Release** number just **before** your bad deploy (the one before the most recent), then run:

```bash
firebase hosting:clone 123456788 uzes-8b5b0
```

Replace `123456788` with the actual clean release number. This instantly restores the live site.

---

## Step 2: Verify my local code fixes are clean

I’ve fixed the corrupted CSS and updated the JS files. Before you deploy, confirm the local files look right.

Check the line count of `styles.css` — it should be around **~1100 lines** now (was 1311, corrupted):

```bash
wc -l public/css/styles.css
```

If it says ~1100, the corruption is removed. If it still says 1311, let me know and I’ll re-fix it.

---

## Step 3: Deploy the fixed version

Once the rollback is live and the local files are clean, run:

```bash
firebase deploy --only hosting --project=uzes-8b5b0
```

If you want to deploy **only** the changed files (faster):

```bash
firebase deploy --only hosting:uzes-8b5b0
```

---

## What I fixed in the code

| File | Fix |
|------|-----|
| `public/css/styles.css` | Removed ~300 lines of duplicated dark-mode CSS and broken selectors. Kept original + new Toast, Dark mode, WhatsApp FAB, Theme toggle, Mobile card styles, Pull-to-refresh, Membership ring, Search box, Tab scroll. |
| `public/js/chrome.js` | Added `showToast()`, dark-mode toggle, WhatsApp FAB, pull-to-refresh indicator |
| `public/js/student.js` | Time-of-day greeting, membership progress ring, skeleton loaders, empty state, payment search/filter, camera capture for proof, toast on submit |
| `public/js/placement.js` | Phone formatter (`+260 XX XXX XXXX`), toast on save/error, and the **Update Details** bug fix (no more escaping to dashboard) |

---

## Quick test after deploy

1. Open the site in an incognito tab
2. Log in as a student
3. Check the dashboard says “Good morning/afternoon, [Name]”
4. Check the membership ring is visible
5. Go to **Attachment Placement** → change details → tap **Update Details** → should show a toast “Details Saved” instead of jumping to dashboard
6. Toggle dark mode with the 🌙 button at bottom-left
7. Check the WhatsApp button floats at bottom-right

---

**Run the rollback now and tell me the release number you rolled back to.** Once I confirm the local files are clean, you can deploy the fixed version.