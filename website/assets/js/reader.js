(function () {
  var root = document.documentElement;
  var DEF = { theme: "ghost", fs: 1.125, lh: 1.7 };
  function get(k, d) { try { return localStorage.getItem(k) || d; } catch (e) { return d; } }
  function set(k, v) { try { localStorage.setItem(k, v); } catch (e) {} }
  function del(k) { try { localStorage.removeItem(k); } catch (e) {} }

  // ---- giscus theme sync (comment box follows the active site theme) ----
  var GISCUS_THEME = { ghost: "dark", "after-dark": "dark", office: "light", daydream: "light" };
  var giscusApplied = null;
  function syncGiscus() {
    var target = GISCUS_THEME[root.getAttribute("data-theme")] || "dark";
    if (target === giscusApplied) return;            // already in sync (prevents resize loop)
    var f = document.querySelector("iframe.giscus-frame");
    if (!f || !f.contentWindow) return;              // giscus not loaded / no comments on page
    f.contentWindow.postMessage({ giscus: { setConfig: { theme: target } } }, "https://giscus.app");
    giscusApplied = target;
  }
  // giscus posts a message once its iframe is ready (and on resize) — sync the theme then
  window.addEventListener("message", function (e) {
    if (e.origin === "https://giscus.app") syncGiscus();
  });

  // ---- theme + reading preferences ----
  var sel = document.getElementById("theme");
  var fs, lh;
  function applyText() {
    root.style.setProperty("--read-size", fs + "rem");
    root.style.setProperty("--read-lh", lh);
  }
  function loadPrefs() {
    var t = get("gsgw-theme", DEF.theme);
    root.setAttribute("data-theme", t);
    if (sel) sel.value = t;
    fs = parseFloat(get("gsgw-fs", DEF.fs));
    lh = parseFloat(get("gsgw-lh", DEF.lh));
    applyText();
  }
  loadPrefs();

  if (sel) sel.addEventListener("change", function () {
    root.setAttribute("data-theme", sel.value);
    set("gsgw-theme", sel.value);
  });
  document.querySelectorAll("[data-font]").forEach(function (b) {
    b.addEventListener("click", function () {
      fs = Math.min(1.8, Math.max(0.85, fs + 0.0625 * parseInt(b.dataset.font, 10)));
      set("gsgw-fs", fs); applyText();
    });
  });
  document.querySelectorAll("[data-lh]").forEach(function (b) {
    b.addEventListener("click", function () {
      lh = Math.min(2.4, Math.max(1.3, lh + 0.1 * parseInt(b.dataset.lh, 10)));
      set("gsgw-lh", lh); applyText();
    });
  });
  var reset = document.getElementById("sp-reset");
  if (reset) reset.addEventListener("click", function () {
    del("gsgw-theme"); del("gsgw-fs"); del("gsgw-lh");
    root.setAttribute("data-theme", DEF.theme);
    if (sel) sel.value = DEF.theme;
    fs = DEF.fs; lh = DEF.lh; applyText();
  });

  // ---- settings panel ----
  var panel = document.getElementById("settings-panel");
  var openBtn = document.getElementById("ab-settings");
  function setPanel(open) { if (panel) panel.hidden = !open; }
  if (openBtn) openBtn.addEventListener("click", function (e) {
    e.stopPropagation(); setPanel(panel.hidden);
  });
  var closeBtn = document.getElementById("sp-close");
  if (closeBtn) closeBtn.addEventListener("click", function () { setPanel(false); });
  document.addEventListener("click", function (e) {
    if (panel && !panel.hidden && !panel.contains(e.target) &&
        openBtn && e.target !== openBtn && !openBtn.contains(e.target)) setPanel(false);
  });
  document.addEventListener("keydown", function (e) { if (e.key === "Escape") setPanel(false); });

  // ---- comments + back to top ----
  var cBtn = document.getElementById("ab-comments");
  if (cBtn) cBtn.addEventListener("click", function () {
    var c = document.querySelector(".comments");
    if (c) c.scrollIntoView({ behavior: "smooth" });
  });
  var topBtn = document.getElementById("ab-top");
  if (topBtn) topBtn.addEventListener("click", function () {
    window.scrollTo({ top: 0, behavior: "smooth" });
  });

  // ---- chapter list: search + sort ----
  var list = document.querySelector(".chlist");
  var search = document.getElementById("toc-search");
  var sort = document.getElementById("toc-sort");
  if (list && (search || sort)) {
    var items = [].slice.call(list.querySelectorAll("li"));
    function filter() {
      var q = (search ? search.value : "").trim().toLowerCase();
      var shown = 0;
      items.forEach(function (li) {
        var hit = !q ||
          (li.dataset.title && li.dataset.title.indexOf(q) > -1) ||
          (li.dataset.num && li.dataset.num.indexOf(q) > -1);
        li.style.display = hit ? "" : "none";
        if (hit) shown++;
      });
      var empty = list.querySelector(".empty");
      if (shown === 0) {
        if (!empty) {
          empty = document.createElement("li");
          empty.className = "empty";
          empty.textContent = "No chapters found.";
          list.appendChild(empty);
        }
      } else if (empty) empty.remove();
    }
    if (search) search.addEventListener("input", filter);
    if (sort) sort.addEventListener("click", function () {
      var dir = sort.dataset.dir === "asc" ? "desc" : "asc";
      sort.dataset.dir = dir;
      sort.textContent = dir === "asc" ? "Sort: Oldest first" : "Sort: Newest first";
      items.slice()
        .sort(function (a, b) { return (dir === "asc" ? 1 : -1) * (+a.dataset.num - +b.dataset.num); })
        .forEach(function (li) { list.appendChild(li); });
    });
  }
})();
