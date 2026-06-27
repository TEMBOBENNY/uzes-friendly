// Page protection — every dashboard calls protect().
// Uses onSnapshot so disabling a user takes effect immediately mid-session.
import { auth, db } from "./firebase.js";
import { onAuthStateChanged, signOut }
  from "https://www.gstatic.com/firebasejs/10.12.2/firebase-auth.js";
import { doc, getDoc, onSnapshot }
  from "https://www.gstatic.com/firebasejs/10.12.2/firebase-firestore.js";

const HOME = { admin: "admin.html", executive: "executive.html", student: "student.html" };

// A profile may live in executives/, students/, or (legacy) users/.
export const PROFILE_COLLECTIONS = ["executives", "students", "users"];

export function routeByRole(role) {
  location.replace(HOME[role] || "index.html");
}

// ── Profile-collection cache ──────────────────────────────────────────────────
// Once we know which collection holds a uid, remember it so subsequent page
// loads go STRAIGHT to that doc instead of probing all three. Keyed by uid so a
// shared device with multiple accounts never crosses wires.
const PCOL_KEY = (uid) => `uzes:pcol:${uid}`;
function cachedCol(uid) {
  try {
    const v = localStorage.getItem(PCOL_KEY(uid));
    return PROFILE_COLLECTIONS.includes(v) ? v : null;
  } catch (_) { return null; }
}
function setCachedCol(uid, col) { try { localStorage.setItem(PCOL_KEY(uid), col); } catch (_) {} }
function clearCachedCol(uid)    { try { localStorage.removeItem(PCOL_KEY(uid)); } catch (_) {} }

// Returns the collection name that holds this uid's profile, or null.
// Probes all three collections IN PARALLEL (one round-trip instead of up to
// three sequential ones) and preserves executives > students > users priority.
export async function findProfileCollection(uid) {
  const results = await Promise.all(PROFILE_COLLECTIONS.map(async (col) => {
    try { return (await getDoc(doc(db, col, uid))).exists() ? col : null; }
    catch (_) { return null; }
  }));
  const found = results.find(Boolean) || null;   // results keep PROFILE_COLLECTIONS order → priority
  if (found) setCachedCol(uid, found);
  return found;
}

export function protect(allowedRoles, onReady) {
  let unsubProfile = null;
  let initialized  = false;

  onAuthStateChanged(auth, async (user) => {
    // Clean up any existing profile listener when auth state changes
    if (unsubProfile) { unsubProfile(); unsubProfile = null; }
    initialized = false;

    if (!user) { location.replace("login.html"); return; }

    // Fast path: a remembered collection lets us subscribe immediately, with no
    // discovery round-trips. Cold path: probe all three in parallel (one trip).
    const hint = cachedCol(user.uid);
    const col  = hint || await findProfileCollection(user.uid);
    if (!col) { logout(); return; }

    watch(col, hint != null);

    // Real-time profile listener — fires on load AND on every subsequent change.
    // This is what makes "disable" instant: admin flips active→false in Firestore
    // and this callback fires within seconds, logging the user out immediately.
    function watch(collectionName, fromHint) {
      unsubProfile = onSnapshot(
        doc(db, collectionName, user.uid),
        async (snap) => {
          if (!snap.exists()) {
            // A stale hint (e.g. account migrated to another collection) can point
            // at an empty doc — re-discover ONCE before giving up.
            if (fromHint) {
              clearCachedCol(user.uid);
              const real = await findProfileCollection(user.uid);
              if (real && real !== collectionName) {
                if (unsubProfile) { unsubProfile(); unsubProfile = null; }
                watch(real, false);
                return;
              }
            }
            logout();
            return;
          }
          setCachedCol(user.uid, collectionName);
          const profile = { id: snap.id, __collection: collectionName, ...snap.data() };

          if (profile.active === false) {
            alert("Your account has been disabled. Contact the administrator.");
            logout();
            return;
          }

          if (!initialized) {
            // First fire: enforce role access and boot the page
            if (!allowedRoles.includes(profile.role)) { routeByRole(profile.role); return; }
            initialized = true;
            onReady(user, profile);
          }
        },
        async (err) => {
          // A hint that points at a collection we can no longer read (rules)
          // also lands here — re-discover once before treating it as disabled.
          if (fromHint) {
            clearCachedCol(user.uid);
            const real = await findProfileCollection(user.uid);
            if (real && real !== collectionName) {
              if (unsubProfile) { unsubProfile(); unsubProfile = null; }
              watch(real, false);
              return;
            }
          }
          console.error("Profile watch error:", err.code);
          logout();
        }
      );
    }
  });
}

export function logout() {
  return signOut(auth).then(() => location.replace("index.html"));
}
