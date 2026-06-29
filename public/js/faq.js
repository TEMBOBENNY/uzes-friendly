import { db } from "./firebase-public.js";
import {
  collection, getDocs, query, where
} from "https://www.gstatic.com/firebasejs/10.12.2/firebase-firestore.js";

// Event delegation (onclick attr removed from template for CSP compliance)
document.addEventListener("click", e => {
  const el = e.target.closest("[data-action='fq:toggle']");
  if (el) window.toggleFaq(el.dataset.fid);
});

async function init() {
  const container = document.getElementById("faqContainer");
  try {
    const snap = await getDocs(query(
      collection(db, "faq"),
      where("published", "==", true)
    ));

    if (snap.empty) {
      container.innerHTML = `<div class="empty-state">
        <div class="empty-state-icon">❓</div>
        <h3>No FAQ items yet</h3>
        <p>Check back soon.</p>
      </div>`;
      return;
    }

    const items = snap.docs.map(d => ({ id: d.id, ...d.data() }))
      .sort((a, b) => (a.order ?? 10) - (b.order ?? 10) || (a.category||"").localeCompare(b.category||""));

    // Group by category
    const categories = {};
    items.forEach(item => {
      const cat = item.category || "General";
      (categories[cat] = categories[cat] || []).push(item);
    });

    const parts = [];
    Object.entries(categories).forEach(([cat, faqItems]) => {
      parts.push(`<div class="faq-category">${cat}</div>`);
      faqItems.forEach(item => {
        parts.push(`<div class="faq-item" id="faq-${item.id}">
          <button class="faq-question" data-action="fq:toggle" data-fid="${item.id}">
            <span>${item.question || "—"}</span>
            <span class="faq-chevron">&#8964;</span>
          </button>
          <div class="faq-answer">${item.answer || ""}</div>
        </div>`);
      });
    });

    container.innerHTML = parts.join("");

  } catch (e) {
    container.innerHTML = `<p class="error">Could not load FAQ: ${e.message}</p>`;
  }
}

window.toggleFaq = (id) => {
  const el = document.getElementById("faq-" + id);
  if (!el) return;
  // Close all others first
  document.querySelectorAll(".faq-item.open").forEach(other => {
    if (other !== el) other.classList.remove("open");
  });
  el.classList.toggle("open");
};

init();
