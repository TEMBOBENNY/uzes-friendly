import { db, auth } from "./firebase.js";
import { collection, addDoc, serverTimestamp }
  from "https://www.gstatic.com/firebasejs/10.12.2/firebase-firestore.js";

/**
 * Write a structured audit-log entry to Firestore `auditLog`.
 * Firestore rules ensure:
 *   - uid must equal request.auth.uid (user owns the entry)
 *   - append-only (no update/delete by users)
 *   - action field must be < 200 chars
 *
 * Never throws — audit failures must not interrupt the main operation.
 *
 * @param {string} action  Short description e.g. "login", "payment_confirmed"
 * @param {object} [meta]  Extra context — never include passwords, tokens, secrets
 */
export async function audit(action, meta = {}) {
  try {
    const user = auth.currentUser;
    if (!user) return;
    await addDoc(collection(db, "auditLog"), {
      uid:    user.uid,
      action: String(action).slice(0, 199),
      at:     serverTimestamp(),
      ...sanitizeMeta(meta),
    });
  } catch (_) {
    // Intentionally swallowed — audit failures are non-fatal
  }
}

// Strip any keys that could contain secrets, tokens, or PII beyond what's needed
const BLOCKED_KEYS = new Set(["password","token","secret","key","idToken","accessToken","Authorization"]);
function sanitizeMeta(obj) {
  if (!obj || typeof obj !== "object") return {};
  const out = {};
  for (const [k, v] of Object.entries(obj)) {
    if (BLOCKED_KEYS.has(k)) continue;
    if (typeof v === "string" || typeof v === "number" || typeof v === "boolean") {
      out[k] = typeof v === "string" ? v.slice(0, 500) : v;
    }
  }
  return out;
}
