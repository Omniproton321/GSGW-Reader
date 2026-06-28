// In-chapter navigation: the "jump to chapter" dropdown + Left/Right arrow keys for prev/next.
// Prev/Next targets are read straight off the existing .chnav links (rel="prev"/"next").
(function () {
  var nav = document.querySelector(".chnav");
  if (!nav) return;

  // Three navs share the page (floating pill + in-flow top/bottom); wire up every dropdown.
  document.querySelectorAll(".chnav-sel").forEach(function (sel) {
    sel.addEventListener("change", function () {
      if (sel.value) window.location.href = sel.value;
    });
  });

  var prev = document.querySelector('.chnav a[rel="prev"]');
  var next = document.querySelector('.chnav a[rel="next"]');
  document.addEventListener("keydown", function (e) {
    if (e.defaultPrevented || e.altKey || e.ctrlKey || e.metaKey) return;
    var t = e.target;
    // don't hijack arrows while typing or in a focused control (search box, the dropdown, etc.)
    if (
      t &&
      (t.tagName === "INPUT" ||
        t.tagName === "TEXTAREA" ||
        t.tagName === "SELECT" ||
        t.isContentEditable)
    )
      return;
    if (e.key === "ArrowLeft" && prev) window.location.href = prev.href;
    else if (e.key === "ArrowRight" && next) window.location.href = next.href;
  });

  // Reconcile the floating pill with the in-flow navs: hide the pill whenever an in-flow nav
  // is on screen (chapter start/end), so the reader never sees two navs at once. (Desktop CSS
  // acts on .chnav-hidden; on mobile the pill is FAB-gated so this is a harmless no-op.)
  var floatNav = document.querySelector(".chnav-float");
  var edges = document.querySelectorAll(".chnav-inline-top, .chnav-inline-bot");
  if (floatNav && edges.length && "IntersectionObserver" in window) {
    var onScreen = new Set();
    var io = new IntersectionObserver(
      function (entries) {
        entries.forEach(function (en) {
          if (en.isIntersecting) onScreen.add(en.target);
          else onScreen.delete(en.target);
        });
        floatNav.classList.toggle("chnav-hidden", onScreen.size > 0);
      },
      { rootMargin: "-8px 0px -8px 0px" },
    );
    edges.forEach(function (el) {
      io.observe(el);
    });
  }
})();
