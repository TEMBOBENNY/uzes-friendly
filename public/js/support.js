import { db } from "./firebase-public.js";
import { doc, getDoc } from "https://www.gstatic.com/firebasejs/10.12.2/firebase-firestore.js";

const DEFAULTS = {
  donate: "Your contribution funds student projects, the BENG CUP, academic tours and member welfare. To donate via mobile money or arrange a contribution, contact the Treasurer through uzesofficial@gmail.com.",
  careers: "We host industry talks, CV clinics and mentorship with practising engineers. Companies and alumni who would like to run a career session for our members are warmly welcome — get in touch to partner with us.",
  attachments: "We connect members with industrial attachment and internship opportunities. Employers can share placement openings and we will circulate them to qualifying students across all departments.",
};

function esc(s) {
  return String(s).replace(/[&<>"]/g, c => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;" }[c]));
}

function set(id, text) {
  const el = document.getElementById(id);
  if (el) el.innerHTML = esc(text).replace(/\n/g, "<br>");
}

(async () => {
  const s = { ...DEFAULTS };
  try {
    const snap = await getDoc(doc(db, "siteContent", "support"));
    if (snap.exists()) {
      const d = snap.data();
      ["donate", "careers", "attachments"].forEach(k => { if (d[k]) s[k] = d[k]; });
    }
  } catch (_) { /* fall back to defaults */ }
  set("sup-donate", s.donate);
  set("sup-careers", s.careers);
  set("sup-attach", s.attachments);
})();
