const IMG_EXTS = ["png","jpg","jpeg","gif","webp"];
// Google Docs Viewer supports these types on all browsers including mobile
const DOCS_EXTS = ["pdf","doc","docx","xls","xlsx","ppt","pptx","odt","ods","odp","txt","csv"];

const p = new URLSearchParams(location.search);
const k = p.get("k"), n = p.get("n") || "file";
if (!k) {
  document.body.innerHTML = '<div id="err">No file specified.</div>';
} else {
  try {
    const rawUrl = atob(k);
    // ?v=inline creates a new Cloudflare cache key so old immutable-cached
    // responses (without Content-Disposition: inline) are bypassed.
    const url = rawUrl + (rawUrl.includes("?") ? "&" : "?") + "v=inline";
    const rawFname = decodeURIComponent(n);
    const fname = /^[\w.\-() ]{1,200}$/.test(rawFname) ? rawFname : "file";
    const ext = (fname.split(".").pop() || "").toLowerCase();
    document.title = fname + " — UZES";

    if (IMG_EXTS.includes(ext)) {
      // Images: direct <img> works everywhere
      const div = document.createElement("div");
      div.id = "img-wrap";
      const img = document.createElement("img");
      img.src = url;
      img.alt = fname;
      div.appendChild(img);
      document.body.appendChild(div);
    } else if (DOCS_EXTS.includes(ext)) {
      // PDFs and office docs: Google Docs Viewer renders on all browsers,
      // including iOS Safari and Android Chrome where native PDF iframes fail.
      const gdUrl = "https://docs.google.com/viewer?url="
        + encodeURIComponent(rawUrl) + "&embedded=true";
      const fr = document.createElement("iframe");
      fr.id = "viewer";
      fr.src = gdUrl;
      fr.allow = "autoplay";
      document.body.appendChild(fr);
    } else {
      // Other files (ZIP, etc.): offer a download link
      const wrap = document.createElement("div");
      wrap.id = "dl-wrap";
      const p1 = document.createElement("p"); p1.textContent = fname;
      const p2 = document.createElement("p"); p2.textContent = "This file type cannot be previewed in the browser.";
      const a = document.createElement("a");
      a.id = "dl-link"; a.href = url; a.download = fname; a.textContent = "Download file";
      wrap.appendChild(p1); wrap.appendChild(p2); wrap.appendChild(a);
      document.body.appendChild(wrap);
    }
  } catch(e) {
    document.body.innerHTML = '<div id="err">Invalid file link.</div>';
  }
}
