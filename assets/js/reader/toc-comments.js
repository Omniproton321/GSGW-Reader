// Comment-count badges on the Contents (TOC) page. One number per chapter = the sum of that
// chapter's per-paragraph counts (comments incl. replies + reactions) — same source as the
// in-chapter badges. Totals come from the counts Worker (edge-cached) and are mirrored to
// localStorage so the list paints instantly on revisit and only re-fetches when stale.

(function () {
  var list = document.querySelector(".chlist[data-counts-api]");
  if (!list) return;
  var base = list.getAttribute("data-counts-api");
  if (!base) return;
  var url = base.replace(/\/counts$/, "/totals"); // /counts and /totals share the snapshot
  var CKEY = "gsgw-ctotals"; // localStorage mirror of ALL chapter totals (one shared map)
  var BUBBLE =
    '<svg viewBox="0 0 24 24"><path d="M21 11.5a8.38 8.38 0 0 1-.9 3.8 8.5 8.5 0 0 1-7.6 4.7 8.38 8.38 0 0 1-3.8-.9L3 21l1.9-5.7a8.38 8.38 0 0 1-.9-3.8 8.5 8.5 0 0 1 4.7-7.6 8.38 8.38 0 0 1 3.8-.9h.5a8.48 8.48 0 0 1 8 8v.5z"/></svg>';

  var badgeBySlug = {};
  [].forEach.call(list.querySelectorAll("li[data-slug]"), function (li) {
    var b = document.createElement("span");
    b.className = "toc-cc";
    b.setAttribute("aria-label", "comments");
    b.innerHTML = BUBBLE + '<span class="toc-cc-n"></span>';
    // Sit before the read/unread pill (added earlier by progress.js); fall back to appending.
    var toggle = li.querySelector(".ch-toggle");
    if (toggle) li.insertBefore(b, toggle);
    else li.appendChild(b);
    badgeBySlug[li.getAttribute("data-slug")] = b;
  });

  function paint(map) {
    Object.keys(badgeBySlug).forEach(function (slug) {
      var n = +map[slug] || 0;
      var b = badgeBySlug[slug];
      b.querySelector(".toc-cc-n").textContent = n > 0 ? n : "";
      b.classList.toggle("has", n > 0);
    });
  }

  var totals = {},
    age = Infinity;
  try {
    var cache = JSON.parse(localStorage.getItem(CKEY));
    if (cache && cache.m) {
      totals = cache.m;
      age = Date.now() - (cache.t || 0);
    }
  } catch (e) {}
  paint(totals); // paint from cache instantly

  // Only hit the Worker if our local mirror is stale, so quick back-and-forth doesn't refetch.
  if (age > 60000) {
    fetch(url)
      .then(function (r) {
        return r.ok ? r.json() : null;
      })
      .then(function (map) {
        if (!map || map.error) return;
        paint(map);
        try {
          localStorage.setItem(CKEY, JSON.stringify({ m: map, t: Date.now() }));
        } catch (e) {}
      })
      .catch(function () {});
  }
})();
