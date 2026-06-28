// Reader entry point — loaded as a native ES module via <script type="module">.
// Importing each feature module runs it; there is no bundler.
//
// localStorage keys used across these modules:
//   gsgw-theme / gsgw-fs / gsgw-lh   reader preferences            (prefs.js)
//   gsgw-cmap:<chapterSlug>          cached paragraph comment counts (paragraph-comments.js)
//   gsgw-ctotals                     cached per-chapter comment totals  (toc-comments.js)
//   gsgw-progress                    per-chapter reading-progress map (progress.js)
//   gsgw-last                        slug of the most recently read chapter (progress.js)
import "./prefs.js";
import "./settings-panel.js";
import "./paragraph-comments.js";
import "./progress.js";
import "./toc.js";
import "./toc-comments.js";
import "./chapter-nav.js";

// Mobile menu toggle: the actionbar + floating chapter-nav are hidden until the FAB is tapped
// (CSS handles the breakpoint; this just flips `body.nav-open`). Tap-away / Escape closes it.
var navToggle = document.getElementById("ab-toggle");
function setNavOpen(open) {
  document.body.classList.toggle("nav-open", open);
  if (navToggle) navToggle.setAttribute("aria-expanded", open ? "true" : "false");
}
if (navToggle) {
  navToggle.addEventListener("click", function (e) {
    e.stopPropagation();
    setNavOpen(!document.body.classList.contains("nav-open"));
  });
  document.addEventListener("click", function (e) {
    if (!document.body.classList.contains("nav-open")) return;
    if (e.target.closest(".actionbar, .ab-toggle, .chnav, .settings-panel, .cp-panel")) return;
    setNavOpen(false);
  });
  document.addEventListener("keydown", function (e) {
    if (e.key === "Escape") setNavOpen(false);
  });
}

// Floating action bar: jump to the comments section + back to top.
var cBtn = document.getElementById("ab-comments");
if (cBtn)
  cBtn.addEventListener("click", function () {
    var c = document.querySelector(".comments");
    if (c) c.scrollIntoView({ behavior: "smooth" });
  });
var topBtn = document.getElementById("ab-top");
if (topBtn)
  topBtn.addEventListener("click", function () {
    window.scrollTo({ top: 0, behavior: "smooth" });
  });
