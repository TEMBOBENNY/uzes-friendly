// Reserves space at the bottom of the page for the fixed footer, so the
// scrolling content never hides behind it (and there's no empty gap when the
// footer's height changes). The top bar (.pub-nav / .topbar) is sticky, so it
// needs no offset. Uses a ResizeObserver so the reserved space always matches
// the footer's actual height — even when text wraps at narrow widths.
(function () {
  function fit() {
    var footer = document.querySelector(".pub-footer");
    document.body.style.paddingBottom = footer ? footer.offsetHeight + "px" : "";
  }
  function init() {
    var footer = document.querySelector(".pub-footer");
    fit();
    if (footer && "ResizeObserver" in window) {
      new ResizeObserver(fit).observe(footer);
    }
    window.addEventListener("resize", fit);
    window.addEventListener("load", fit);
  }
  if (document.readyState === "loading") {
    document.addEventListener("DOMContentLoaded", init);
  } else {
    init();
  }
})();

// ═══════════════════════════════════════════════════════════════════════════════
// CONFIGURATION — change these values
// ═══════════════════════════════════════════════════════════════════════════════
const UZES_WHATSAPP_NUMBER = "260971457112"; // ← CHANGE THIS TO YOUR SUPPORT NUMBER

// ═══════════════════════════════════════════════════════════════════════════════
// THEME SYSTEM (shared across all pages)
// ═══════════════════════════════════════════════════════════════════════════════
(function () {
  function applyTheme() {
    const saved = localStorage.getItem("uzes-theme");
    const isDark = saved === "dark";
    if (isDark) {
      document.documentElement.setAttribute("data-theme", "dark");
    } else {
      document.documentElement.removeAttribute("data-theme");
    }
    updateToggleIcons(isDark);
  }

  function updateToggleIcons(isDark) {
    document.querySelectorAll(".theme-toggle-btn").forEach(btn => {
      btn.innerHTML = isDark ? "☀️" : "🌙";
      btn.title = isDark ? "Switch to light mode" : "Switch to dark mode";
    });
  }

  function toggleTheme() {
    const isDark = document.documentElement.getAttribute("data-theme") === "dark";
    if (isDark) {
      document.documentElement.removeAttribute("data-theme");
      localStorage.setItem("uzes-theme", "light");
    } else {
      document.documentElement.setAttribute("data-theme", "dark");
      localStorage.setItem("uzes-theme", "dark");
    }
    updateToggleIcons(!isDark);
  }

  // Apply theme immediately on page load
  applyTheme();

  // Wire up any toggle buttons already in the DOM
  document.querySelectorAll(".theme-toggle-btn").forEach(btn => {
    btn.addEventListener("click", toggleTheme);
  });

  // Also watch for dynamically added toggle buttons (including those inside injected containers)
  if ("MutationObserver" in window) {
    new MutationObserver(muts => {
      let needsUpdate = false;
      muts.forEach(m => m.addedNodes.forEach(n => {
        if (n.nodeType === 1) {
          // Check the node itself AND its descendants
          const candidates = [];
          if (n.classList && n.classList.contains("theme-toggle-btn")) candidates.push(n);
          if (n.querySelectorAll) n.querySelectorAll(".theme-toggle-btn").forEach(btn => candidates.push(btn));
          candidates.forEach(btn => {
            btn.addEventListener("click", toggleTheme);
            needsUpdate = true;
          });
        }
      }));
      if (needsUpdate) applyTheme();
    }).observe(document.body, { childList: true, subtree: true });
  }

  // Safety: wire any toggle buttons that were already in the DOM when this script runs
  document.addEventListener("DOMContentLoaded", () => {
    document.querySelectorAll(".theme-toggle-btn").forEach(btn => {
      btn.addEventListener("click", toggleTheme);
    });
    applyTheme();
  });

  // Expose globally so modules can call it
  window.applyUzesTheme = applyTheme;
  window.toggleUzesTheme = toggleTheme;
})();

// ═══════════════════════════════════════════════════════════════════════════════
// TOAST NOTIFICATION SYSTEM
// ═══════════════════════════════════════════════════════════════════════════════
(function () {
  let container = document.getElementById("toastContainer");
  if (!container) {
    container = document.createElement("div");
    container.id = "toastContainer";
    container.className = "toast-container";
    document.body.appendChild(container);
  }

  window.showToast = function (opts) {
    const title = opts.title || "";
    const message = opts.message || opts.msg || "";
    const type = opts.type || "info";
    const duration = opts.duration || (type === "error" ? 5000 : 3500);

    const iconMap = { success: "✓", error: "✕", warn: "!", info: "ℹ" };

    const toast = document.createElement("div");
    toast.className = "toast toast-" + type;
    toast.innerHTML = `
      <span class="toast-icon">${iconMap[type]}</span>
      <div class="toast-body">
        ${title ? `<div class="toast-title">${esc(title)}</div>` : ""}
        ${message ? `<div class="toast-msg">${esc(message)}</div>` : ""}
      </div>`;
    container.appendChild(toast);

    toast.addEventListener("click", () => {
      toast.classList.add("toast-out");
      toast.addEventListener("animationend", () => toast.remove());
    });

    setTimeout(() => {
      if (toast.parentNode) {
        toast.classList.add("toast-out");
        toast.addEventListener("animationend", () => toast.remove());
      }
    }, duration);
  };

  function esc(s) {
    return String(s ?? "").replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;").replace(/"/g, "&quot;");
  }
})();

// ═══════════════════════════════════════════════════════════════════════════════
// WHATSAPP FLOATING SUPPORT BUTTON
// ═══════════════════════════════════════════════════════════════════════════════
(function () {
  const pathname = location.pathname;
  const isStudentPage = pathname.includes("student.html") || pathname.includes("attachment.html");
  if (!isStudentPage) return; // Hide on admin, executive, TS, and public pages

  const link = document.createElement("a");
  link.href = "https://wa.me/" + UZES_WHATSAPP_NUMBER + "?text=Hi%20UZES%2C%20I%20need%20help";
  link.target = "_blank";
  link.className = "wa-float";
  link.title = "Chat with Support on WhatsApp";
  link.setAttribute("aria-label", "Chat with Support on WhatsApp");
  link.innerHTML = `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 24 24" fill="currentColor" width="28" height="28" style="display:block"><path d="M17.472 14.382c-.297-.149-1.758-.867-2.03-.967-.273-.099-.471-.148-.67.15-.197.297-.767.966-.94 1.164-.173.199-.347.223-.644.075-.297-.15-1.255-.463-2.39-1.475-.883-.788-1.48-1.761-1.653-2.059-.173-.297-.018-.458.13-.606.134-.133.298-.347.446-.52.149-.174.198-.298.298-.497.099-.198.05-.371-.025-.52-.075-.149-.669-1.612-.916-2.207-.242-.579-.487-.5-.669-.51-.173-.008-.371-.01-.57-.01-.198 0-.52.074-.792.372-.272.297-1.04 1.016-1.04 2.479 0 1.462 1.065 2.875 1.213 3.074.149.198 2.096 3.2 5.077 4.487.709.306 1.262.489 1.694.625.712.227 1.36.195 1.871.118.571-.085 1.758-.719 2.006-1.413.248-.694.248-1.289.173-1.413-.074-.124-.272-.198-.57-.347m-5.421 7.403h-.004a9.87 9.87 0 01-5.031-1.378l-.361-.214-3.741.982.998-3.648-.235-.374a9.86 9.86 0 01-1.51-5.26c.001-5.45 4.436-9.884 9.888-9.884 2.64 0 5.122 1.03 6.988 2.898a9.825 9.825 0 012.893 6.994c-.003 5.45-4.437 9.884-9.885 9.884m8.413-18.297A11.815 11.815 0 0012.05 0C5.495 0 .16 5.335.157 11.892c0 2.096.547 4.134 1.585 5.94L.057 24l6.305-1.654a11.882 11.882 0 005.683 1.448h.005c6.554 0 11.89-5.335 11.893-11.893a11.821 11.821 0 00-3.48-8.413z"/></svg>`;
  document.body.appendChild(link);
})();

// ═══════════════════════════════════════════════════════════════════════════════
// PULL-TO-REFRESH INDICATOR (mobile only, on logged-in pages)
// ═══════════════════════════════════════════════════════════════════════════════
(function () {
  const isMobile = /Android|webOS|iPhone|iPad|iPod|BlackBerry|IEMobile|Opera Mini/i.test(navigator.userAgent);
  if (!isMobile) return;
  if (!location.pathname.match(/(student|executive|admin|library|attachment|industrial-secretary)\.html/)) return;

  const indicator = document.createElement("div");
  indicator.className = "ptr-indicator";
  indicator.innerHTML = '<div class="ptr-spinner"></div>';
  document.body.prepend(indicator);

  let startY = 0;
  let isPulling = false;
  const threshold = 80;

  document.addEventListener("touchstart", (e) => {
    if (window.scrollY === 0) { startY = e.touches[0].clientY; isPulling = true; }
  }, { passive: true });
  document.addEventListener("touchmove", (e) => {
    if (!isPulling) return;
    const diff = e.touches[0].clientY - startY;
    if (diff > 0 && diff < threshold * 2) indicator.style.height = Math.min(diff / 1.5, 48) + "px";
  }, { passive: true });
  document.addEventListener("touchend", () => {
    if (!isPulling) return;
    isPulling = false;
    const h = parseFloat(indicator.style.height || "0");
    if (h >= 40) { indicator.classList.add("active"); window.location.reload(); }
    else { indicator.style.height = "0"; }
  });
})();
