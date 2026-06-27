import { auth, db } from "./firebase.js";
import { createUserWithEmailAndPassword, signOut, onAuthStateChanged }
  from "https://www.gstatic.com/firebasejs/10.12.2/firebase-auth.js";
import { doc, setDoc, serverTimestamp }
  from "https://www.gstatic.com/firebasejs/10.12.2/firebase-firestore.js";

function sanitizeCompNo(v) {
  return String(v).trim().toUpperCase().replace(/\//g, "_");
}

const COMMON_PASSWORDS = new Set([
  "password123","password1234","Password123","Password1234",
  "qwerty123456","Qwerty123456","12345678","123456789","1234567890",
  "abc123456","letmein1","welcome1","iloveyou1","sunshine1",
  "admin1234","Admin1234","student123","Student123","unza1234","Unza1234",
]);

function validatePassword(pw) {
  if (pw.length < 12)           return "Password must be at least 12 characters long.";
  if (!/[A-Z]/.test(pw))        return "Password must contain at least one uppercase letter.";
  if (!/[a-z]/.test(pw))        return "Password must contain at least one lowercase letter.";
  if (!/[0-9]/.test(pw))        return "Password must contain at least one number.";
  if (!/[^A-Za-z0-9]/.test(pw)) return "Password must contain at least one special character (e.g. @, #, !).";
  if (COMMON_PASSWORDS.has(pw)) return "That password is too common. Please choose a more unique one.";
  return null;
}

// If someone navigates here while already signed in, send them to their dashboard
onAuthStateChanged(auth, (user) => {
  if (user) location.replace("student.html");
});

const form   = document.getElementById("regForm");
const regBtn = document.getElementById("regBtn");
const regErr = document.getElementById("regErr");
const regOk  = document.getElementById("regOk");

form.addEventListener("submit", async (e) => {
  e.preventDefault();
  regErr.textContent = ""; regOk.textContent = "";

  const name        = document.getElementById("regName").value.trim();
  const email       = document.getElementById("regEmail").value.trim();
  const compNumber  = document.getElementById("regComp").value.trim().toUpperCase();
  const gender      = document.getElementById("regGender").value;
  const yearOfStudy = document.getElementById("regYear").value;
  const department  = document.getElementById("regDept").value;
  const password    = document.getElementById("regPw").value;
  const confirm     = document.getElementById("regPwConfirm").value;

  // Client-side validation (Firestore rules re-validate server-side)
  if (!name)        { regErr.textContent = "Please enter your full name.";         return; }
  if (!compNumber)  { regErr.textContent = "Please enter your computer number.";   return; }
  if (!gender)      { regErr.textContent = "Please select your gender.";           return; }
  if (!yearOfStudy) { regErr.textContent = "Please select your year of study.";    return; }
  if (!department)  { regErr.textContent = "Please select your department.";       return; }

  const pwErr = validatePassword(password);
  if (pwErr) { regErr.textContent = pwErr; return; }
  if (password !== confirm) { regErr.textContent = "Passwords do not match.";     return; }

  regBtn.disabled = true; regBtn.textContent = "Creating account…";

  try {
    // Use the MAIN auth app — this signs the user in and ensures
    // the Firestore writes below carry a valid request.auth token
    const cred = await createUserWithEmailAndPassword(auth, email, password);
    const uid  = cred.user.uid;

    // Write profile — Firestore rules verify role == 'student' and required fields
    await setDoc(doc(db, "students", uid), {
      role: "student", name, email, compNumber, gender, yearOfStudy, department,
      active: true, createdAt: serverTimestamp()
    });

    // Write comp-number → email index for login-by-comp# support
    await setDoc(doc(db, "compIndex", sanitizeCompNo(compNumber)), { email, uid });

    // Sign out — they'll log in normally so guard.js initialises cleanly
    await signOut(auth);

    form.reset();
    regOk.textContent = "Account created! Redirecting to sign in…";
    setTimeout(() => { location.href = "index.html"; }, 2000);

  } catch (err) {
    const msgs = {
      "auth/email-already-in-use": "An account with that email already exists.",
      "auth/invalid-email":        "Please enter a valid email address.",
      "auth/weak-password":        "Password is too weak — must be at least 12 characters with uppercase, lowercase, number, and special character.",
      "permission-denied":         "Registration blocked. Contact the administrator."
    };
    regErr.textContent = msgs[err.code] || err.message;
    regBtn.disabled = false; regBtn.textContent = "Create account";
  }
});
