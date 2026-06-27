// Matching algorithm for placement vacancies.
// Builds eligible pool, sorts by rejection count, randomly selects.

import { db } from "./firebase.js";
import {
  collection, getDocs, getDoc, query, where, runTransaction, doc, serverTimestamp
} from "https://www.gstatic.com/firebasejs/10.12.2/firebase-firestore.js";

/**
 * Build the eligibility pool for a department in a vacancy.
 * Filters: status=pending, department match, province match, has_paid, gender (if specified).
 *
 * @param {string}  dept        Department name (e.g. "Electrical and Electronic Engineering")
 * @param {Object}  vacancy     Vacancy doc data
 * @param {Array}   payments    All payment docs (for has_paid check)
 * @returns {Promise<Array>}    Array of {uid, rejectionCount} eligible students
 */
export async function buildEligibilityPool(dept, vacancy, payments) {
  const paidStudents = new Set(
    payments
      .filter(p => p.status === "confirmed" && p.category === "Membership Dues")
      .map(p => p.studentUid)
  );

  try {
    const placementsSnap = await getDocs(collection(db, "placements"));
    let pool = [];

    for (const plSnap of placementsSnap.docs) {
      const p = plSnap.data();
      if (p.placementStatus !== "pending") continue;

      // Load student profile to check dept, gender, infer type
      const studentSnap = await getDoc(doc(db, "students", plSnap.id));
      const student = studentSnap.data();
      if (!student) continue;

      // Filters
      if (student.department !== dept) continue;
      if (p.preferredProvince !== vacancy.province) continue;
      if (!paidStudents.has(plSnap.id)) continue;
      if (vacancy.genderPreference !== "All" && student.gender !== vacancy.genderPreference) continue;

      // Type inference: yearOfStudy >= 5 or "fifth/5th" text → Internship
      const yStr = String(student.yearOfStudy || "");
      const yNum = parseInt(yStr) || 0;
      const isFifth = yNum >= 5 || /fifth|5th/i.test(yStr);
      const inferredType = isFifth ? "Internship" : "Attachment";
      if (inferredType !== vacancy.type) continue;

      pool.push({
        uid: plSnap.id,
        rejectionCount: p.rejectionCount || 0
      });
    }

    return pool;
  } catch (err) {
    console.error("Error building eligibility pool:", err);
    return [];
  }
}

/**
 * Sort pool by rejectionCount ascending (0-rejects first).
 *
 * @param {Array} pool Array of {uid, rejectionCount}
 * @returns {Array}    Sorted pool
 */
export function sortByRejectionCount(pool) {
  return pool.slice().sort((a, b) => a.rejectionCount - b.rejectionCount);
}

/**
 * Randomly select N items from an array.
 *
 * @param {Array}  array
 * @param {number} n
 * @returns {Array} Selected items
 */
export function randomSelect(array, n) {
  if (array.length <= n) return array;
  const selected = [];
  const indices = new Set();
  while (selected.length < n) {
    const idx = Math.floor(Math.random() * array.length);
    if (!indices.has(idx)) {
      indices.add(idx);
      selected.push(array[idx]);
    }
  }
  return selected;
}

/**
 * Run the matching algorithm for a vacancy.
 * Creates a list of matched placements (not committed yet; can be used for draft mode).
 *
 * @param {string}  vacancyId   Vacancy doc ID
 * @param {Object}  vacancy     Vacancy doc data (with departmentsRequired, slotsRemaining)
 * @param {Array}   payments    All payment docs
 * @returns {Promise<Array>}    List of {uid, companyId} to match (not yet written)
 */
export async function runMatchingAlgorithm(vacancyId, vacancy, payments) {
  const matches = [];

  for (const [dept, slotsNeeded] of Object.entries(vacancy.slotsRemaining || {})) {
    if (slotsNeeded <= 0) continue;

    const pool = await buildEligibilityPool(dept, vacancy, payments);
    const sorted = sortByRejectionCount(pool);
    const selected = randomSelect(sorted, slotsNeeded);

    matches.push({
      dept,
      students: selected.map(s => s.uid)
    });
  }

  return matches;
}

/**
 * Commit matches to Firestore atomically (transaction).
 * Updates placements to "matched" and decrements vacancy slots.
 *
 * @param {string}  vacancyId   Vacancy doc ID
 * @param {Array}   matches     Output from runMatchingAlgorithm
 * @returns {Promise<void>}
 */
export async function commitMatches(vacancyId, matches) {
  return runTransaction(db, async (tx) => {
    const vacancyRef = doc(db, "vacancies", vacancyId);
    const vacancySnap = await tx.get(vacancyRef);
    if (!vacancySnap.exists()) throw new Error("Vacancy not found");

    const vacancy = vacancySnap.data();
    const newSlots = { ...vacancy.slotsRemaining };
    const autoConfirm = vacancy.acceptMode === "auto";

    for (const { dept, students } of matches) {
      for (const uid of students) {
        const placementRef = doc(db, "placements", uid);
        tx.update(placementRef, autoConfirm
          ? { placementStatus: "confirmed", matchedCompanyId: vacancyId, matchedAt: serverTimestamp(), cvUrl: "" }
          : { placementStatus: "matched",   matchedCompanyId: vacancyId, matchedAt: serverTimestamp() }
        );
      }
      newSlots[dept] = (newSlots[dept] || 0) - students.length;
    }

    tx.update(vacancyRef, { slotsRemaining: newSlots });
  });
}

/**
 * Auto-rerun matching for a single vacancy/department after a student rejects.
 * Refills the vacated slot from the eligible pool.
 *
 * @param {string}  vacancyId
 * @param {string}  dept
 */
export async function autoRerrunForSlot(vacancyId, dept, payments) {
  try {
    const vacancySnap = await getDoc(doc(db, "vacancies", vacancyId));
    if (!vacancySnap.exists()) return;

    const vacancy = vacancySnap.data();
    const pool = await buildEligibilityPool(dept, vacancy, payments);
    const sorted = sortByRejectionCount(pool);
    const selected = randomSelect(sorted, 1);

    if (selected.length > 0) {
      await commitMatches(vacancyId, [{ dept, students: [selected[0].uid] }]);
    }
  } catch (err) {
    console.error("Auto-rerun failed:", err);
  }
}
