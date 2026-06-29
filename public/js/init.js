// Page-level boilerplate: footer year, nav toggle, dialog close.
const _yr = document.getElementById("footerYear");
if (_yr) _yr.textContent = new Date().getFullYear();

const _nav = document.getElementById("navToggle");
if (_nav) _nav.addEventListener("click", () => {
  document.getElementById("navLinks")?.classList.toggle("open");
});

const _dlg = document.getElementById("dialogClose");
if (_dlg) _dlg.addEventListener("click", () => {
  (_dlg.closest("dialog") || document.querySelector("dialog"))?.close();
});
