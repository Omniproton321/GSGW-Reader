// In-chapter navigation: the "jump to chapter" dropdown + Left/Right arrow keys for prev/next.
// Prev/Next targets are read straight off the existing .chnav links (rel="prev"/"next").
(function () {
  var nav = document.querySelector(".chnav");
  if (!nav) return;

  // There are two navs (top + bottom); wire up every jump dropdown.
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
    if (t && (t.tagName === "INPUT" || t.tagName === "TEXTAREA" || t.tagName === "SELECT" || t.isContentEditable))
      return;
    if (e.key === "ArrowLeft" && prev) window.location.href = prev.href;
    else if (e.key === "ArrowRight" && next) window.location.href = next.href;
  });
})();
