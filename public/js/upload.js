import { UPLOAD_WORKER_URL } from "./config.js";
import { auth } from "./firebase.js";
import { onAuthStateChanged } from "https://www.gstatic.com/firebasejs/10.12.2/firebase-auth.js";

// Returns the current user's Firebase ID token, waiting up to 5 s for auth
// state to restore on first page load.  Throws if not signed in.
async function bearer() {
  let user = auth.currentUser;
  if (!user) {
    user = await new Promise(resolve => {
      const unsub = onAuthStateChanged(auth, u => { unsub(); resolve(u); });
      setTimeout(() => resolve(null), 5000);
    });
  }
  if (!user) throw new Error("Not signed in — please refresh the page and try again.");
  try { return await user.getIdToken(); }
  catch (e) {
    console.warn("[UZES] getIdToken failed:", e);
    throw new Error("Could not get auth token — check your connection and try again.");
  }
}

export async function authHeaders() {
  try {
    const t = await bearer();
    return { Authorization: "Bearer " + t };
  } catch (_) { return {}; }
}

/**
 * Upload a File to the Cloudflare Worker / R2.
 * Returns the public URL string. Throws on failure with the real error message.
 *
 * @param {File}     file
 * @param {Function} [onProgress]  called with 0..1
 * @param {string}   [folder]      R2 key prefix (e.g. "uzes-exec-photos")
 */
export async function uploadProof(file, onProgress, folder = "uzes-proofs") {
  if (!UPLOAD_WORKER_URL) {
    throw new Error("Upload not configured — set UPLOAD_WORKER_URL in config.js");
  }

  const MAX_MB = 10;
  if (file.size > MAX_MB * 1024 * 1024) {
    throw new Error(`File must be under ${MAX_MB} MB (this one is ${(file.size / 1024 / 1024).toFixed(1)} MB).`);
  }

  const allowed = ["image/jpeg", "image/png", "image/webp", "image/gif", "application/pdf"];
  if (file.type && !allowed.includes(file.type)) {
    throw new Error("Only JPG, PNG, WEBP, GIF or PDF files are accepted.");
  }

  const fd = new FormData();
  fd.append("file", file);
  fd.append("folder", folder);

  const token = await bearer();

  return new Promise((resolve, reject) => {
    const xhr = new XMLHttpRequest();
    xhr.open("POST", UPLOAD_WORKER_URL + "/upload");
    if (token) xhr.setRequestHeader("Authorization", "Bearer " + token);
    if (onProgress) {
      xhr.upload.onprogress = (e) => e.lengthComputable && onProgress(e.loaded / e.total);
    }
    xhr.onload = () => {
      let body = {};
      try { body = JSON.parse(xhr.responseText); } catch (_) {}
      if (xhr.status === 200 && body.secure_url) { resolve(body.secure_url); return; }
      const msg = body?.error || `Worker returned HTTP ${xhr.status}`;
      reject(new Error("Upload failed — " + msg));
    };
    xhr.onerror = () => reject(new Error("Network error — could not reach the upload server."));
    xhr.send(fd);
  });
}

/**
 * Upload a CV (Word doc, PDF) for placement matching to R2.
 * Allows .doc, .docx, .pdf up to 10 MB. Returns the public URL.
 *
 * @param {File}   file
 * @param {string} [folder]
 */
export async function uploadCV(file, folder = "uzes-cvs") {
  if (!UPLOAD_WORKER_URL) {
    throw new Error("Upload not configured — set UPLOAD_WORKER_URL in config.js");
  }

  const MAX_MB = 10;
  if (file.size > MAX_MB * 1024 * 1024) {
    throw new Error(`File must be under ${MAX_MB} MB (this one is ${(file.size / 1024 / 1024).toFixed(1)} MB).`);
  }

  const allowed = [
    "application/pdf",
    "application/msword",
    "application/vnd.openxmlformats-officedocument.wordprocessingml.document"
  ];
  if (file.type && !allowed.includes(file.type)) {
    throw new Error("Only PDF, DOC, and DOCX files are accepted.");
  }

  const fd = new FormData();
  fd.append("file", file);
  fd.append("folder", folder);

  const token = await bearer();

  return new Promise((resolve, reject) => {
    const xhr = new XMLHttpRequest();
    xhr.open("POST", UPLOAD_WORKER_URL + "/upload");
    if (token) xhr.setRequestHeader("Authorization", "Bearer " + token);
    xhr.onload = () => {
      let body = {};
      try { body = JSON.parse(xhr.responseText); } catch (_) {}
      if (xhr.status === 200 && body.secure_url) { resolve(body.secure_url); return; }
      const msg = body?.error || `Worker returned HTTP ${xhr.status}`;
      reject(new Error("Upload failed — " + msg));
    };
    xhr.onerror = () => reject(new Error("Network error — could not reach the upload server."));
    xhr.send(fd);
  });
}

/**
 * Upload an archive file (e.g. an .xlsx year-end report) to R2.
 * Unlike uploadProof this allows spreadsheet/CSV types. Returns the public URL.
 *
 * @param {File}   file
 * @param {string} [folder]
 */
export async function uploadArchive(file, folder = "Archive") {
  if (!UPLOAD_WORKER_URL) {
    throw new Error("Upload not configured — set UPLOAD_WORKER_URL in config.js");
  }
  const fd = new FormData();
  fd.append("file", file);
  fd.append("folder", folder);
  const res = await fetch(UPLOAD_WORKER_URL + "/upload", {
    method: "POST", body: fd, headers: { ...(await authHeaders()) }
  });
  let body = {};
  try { body = await res.json(); } catch (_) {}
  if (res.ok && body.secure_url) return body.secure_url;
  throw new Error(body.error || `Archive upload failed (HTTP ${res.status})`);
}

/**
 * Best-effort delete of one or more files from R2 (via the Worker).
 * Accepts a single file URL/key or an array. Never throws — cleanup failures
 * must not block the main operation. Only deletes files hosted on our Worker.
 *
 * @param {string|string[]} urls
 * @returns {Promise<boolean>} true if the delete request succeeded
 */
export async function deleteUpload(urls) {
  if (!UPLOAD_WORKER_URL) return false;
  const list = (Array.isArray(urls) ? urls : [urls])
    .filter(u => typeof u === "string" && u.includes(UPLOAD_WORKER_URL));
  if (!list.length) return false;
  try {
    const res = await fetch(UPLOAD_WORKER_URL + "/delete", {
      method: "POST",
      headers: { "Content-Type": "application/json", ...(await authHeaders()) },
      body: JSON.stringify({ urls: list }),
    });
    return res.ok;
  } catch (_) {
    return false; // best-effort
  }
}

/**
 * Delete EVERY file under a key prefix (e.g. "uzes-proofs/") from R2.
 * Used by the year-end reset to guarantee the proofs folder is fully cleared.
 * This mass operation is gated by the admin secret on the Worker, so the caller
 * must pass it (from settings/adminApi.deleteToken).
 *
 * @param {string} prefix
 * @param {string} secret  admin delete secret (ADMIN_DELETE_SECRET on the Worker)
 * @returns {Promise<number>} number of files deleted (0 on failure)
 */
export async function deleteUploadPrefix(prefix, secret) {
  if (!UPLOAD_WORKER_URL || !prefix) return 0;
  try {
    const res = await fetch(UPLOAD_WORKER_URL + "/delete", {
      method: "POST",
      headers: { "Content-Type": "application/json", ...(await authHeaders()) },
      body: JSON.stringify({ prefix, secret: secret || "" }),
    });
    if (!res.ok) return 0;
    const body = await res.json().catch(() => ({}));
    return body.deleted || 0;
  } catch (_) {
    return 0;
  }
}
