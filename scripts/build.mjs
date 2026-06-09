#!/usr/bin/env node
// Build the GSGW static site from /chapters into /website.
import { readFileSync, writeFileSync, readdirSync, mkdirSync, rmSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { dirname, join } from "node:path";

const ROOT = dirname(dirname(fileURLToPath(import.meta.url)));
const OUT = join(ROOT, "website");
const CHAPTERS_OUT = join(OUT, "chapters");
const SITE = JSON.parse(readFileSync(join(ROOT, "site.json"), "utf8"));
const BASE = readFileSync(join(ROOT, "templates", "base.html"), "utf8");

const THEMES = [["ghost", "Ghost Story"], ["office", "Office Hours"],
  ["after-dark", "After Dark"], ["daydream", "Daydream"]];

function esc(s, quote = true) {
  s = String(s).replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;");
  return quote ? s.replace(/"/g, "&quot;") : s;
}

function page(title, description, content) {
  return BASE.replaceAll("{{title}}", esc(title))
    .replaceAll("{{description}}", esc(description))
    .replaceAll("{{content}}", content);
}

function inline(t) {
  return esc(t, false)
    .replace(/\*\*(.+?)\*\*/g, "<strong>$1</strong>")
    .replace(/\*(.+?)\*/g, "<em>$1</em>");
}

function md(text) {
  const out = [];
  for (const block of text.trim().split(/\n\s*\n/)) {
    const b = block.trim();
    if (!b) continue;
    if (b === "---" || b === "***" || b === "* * *") {
      out.push('<hr class="sb">');
    } else if (b.startsWith("## ")) {
      out.push(`<h2>${inline(b.slice(3))}</h2>`);
    } else if (b.split("\n").every((l) => l.trimStart().startsWith(">"))) {
      const q = b.split("\n").map((l) => l.replace(/^\s*>\s?/, "").trimEnd()).join(" ");
      out.push(`<blockquote>${inline(q)}</blockquote>`);
    } else {
      const p = b.split("\n").map((l) => l.trim()).join(" ");
      out.push(`<p>${inline(p)}</p>`);
    }
  }
  return out.join("\n");
}

function parse(text) {
  const meta = {};
  let body = text;
  if (text.startsWith("---")) {
    const parts = text.split("---");
    const fm = parts[1];
    body = parts.slice(2).join("---");
    for (const line of fm.trim().split("\n")) {
      const i = line.indexOf(":");
      if (i > -1) meta[line.slice(0, i).trim()] = line.slice(i + 1).trim();
    }
  }
  return { meta, body: body.trim() };
}

const ICONS = {
  home: '<svg viewBox="0 0 24 24"><path d="M3 11l9-8 9 8"/><path d="M5 10v10h14V10"/></svg>',
  list: '<svg viewBox="0 0 24 24"><path d="M4 6h16M4 12h16M4 18h16"/></svg>',
  settings: '<svg viewBox="0 0 24 24"><path d="M4 21v-7M4 10V3M12 21v-9M12 8V3M20 21v-5M20 12V3M1 14h6M9 8h6M17 16h6"/></svg>',
  comment: '<svg viewBox="0 0 24 24"><path d="M21 15a2 2 0 0 1-2 2H7l-4 4V5a2 2 0 0 1 2-2h14a2 2 0 0 1 2 2z"/></svg>',
  up: '<svg viewBox="0 0 24 24"><path d="M12 19V5M5 12l7-7 7 7"/></svg>',
};

// Floating action bar + settings panel. `comments`/`chapters` toggle those buttons.
function actionbar({ comments = false, chapters = false } = {}) {
  const opts = THEMES.map(([v, n]) => `<option value="${v}">${n}</option>`).join("");
  const link = (href, label, svg) =>
    `<a class="ab-btn" href="${href}" title="${label}" aria-label="${label}">${svg}</a>`;
  const btn = (id, label, svg) =>
    `<button class="ab-btn" id="${id}" title="${label}" aria-label="${label}">${svg}</button>`;
  return `<div class="actionbar">
${link("/", "Home", ICONS.home)}
${chapters ? link("/toc.html", "Chapter list", ICONS.list) : ""}
${btn("ab-settings", "Settings", ICONS.settings)}
${comments ? btn("ab-comments", "Comments", ICONS.comment) : ""}
${btn("ab-top", "Back to top", ICONS.up)}
</div>
<div class="settings-panel" id="settings-panel" hidden>
<div class="sp-head"><span>Settings</span><button class="sp-close" id="sp-close" aria-label="Close">×</button></div>
<label class="sp-row">Theme <select id="theme">${opts}</select></label>
<div class="sp-row">Font size <span class="sp-grp"><button data-font="-1">A−</button><button data-font="1">A+</button></span></div>
<div class="sp-row">Line height <span class="sp-grp"><button data-lh="-1">−</button><button data-lh="1">+</button></span></div>
<button class="sp-reset" id="sp-reset">Reset to defaults</button>
</div>`;
}

// True once giscus is configured with real values (not missing / placeholder).
function commentsOn() {
  const g = SITE.giscus;
  return !!(g && g.repo && g.repoId && !g.repo.includes("YOUR_") && !g.repoId.includes("REPLACE"));
}

function giscusBlock() {
  if (!commentsOn()) return ""; // skip the section until giscus is configured
  const g = SITE.giscus;
  return `<section class="comments"><h2>Discussion</h2>
<script src="https://giscus.app/client.js"
 data-repo="${g.repo}" data-repo-id="${g.repoId}"
 data-category="${g.category}" data-category-id="${g.categoryId}"
 data-mapping="pathname" data-strict="1" data-reactions-enabled="1"
 data-emit-metadata="0" data-input-position="top" data-theme="dark"
 data-lang="en" crossorigin="anonymous" async></script></section>`;
}

function build() {
  rmSync(CHAPTERS_OUT, { recursive: true, force: true }); // clear stale pages
  mkdirSync(CHAPTERS_OUT, { recursive: true });

  const files = readdirSync(join(ROOT, "chapters"))
    .filter((f) => f.endsWith(".md") || f.endsWith(".html")).sort();
  const chapters = files.map((f) => {
    const { meta, body } = parse(readFileSync(join(ROOT, "chapters", f), "utf8"));
    const stem = f.replace(/\.(md|html)$/, "");
    const num = String(meta.number ?? stem).replace(/^0+(?=\d)/, ""); // strip leading zeros
    return {
      num,
      title: meta.title ?? "Untitled",
      arc: meta.arc ?? "",
      slug: `ch${num}`,
      // .html chapters are pre-rendered fragments (e.g. imported from Google Docs);
      // .md chapters go through the lightweight markdown converter.
      html: f.endsWith(".html") ? body : md(body),
    };
  });
  chapters.sort((a, b) => (parseFloat(a.num) || 0) - (parseFloat(b.num) || 0)); // numeric order

  chapters.forEach((c, i) => {
    const prev = i > 0 ? chapters[i - 1] : null;
    const nxt = i < chapters.length - 1 ? chapters[i + 1] : null;
    const nav = `<nav class="chnav">
${prev ? `<a href="/chapters/${prev.slug}.html">← Prev</a>` : "<span></span>"}
<a href="/toc.html">Menu</a>
${nxt ? `<a href="/chapters/${nxt.slug}.html">Next →</a>` : "<span></span>"}
</nav>`;
    const content = `<main class="chapter">
<div class="page">
<header class="chead"><h1>${esc(c.title)}</h1></header>
<article class="cbody" id="cbody">${c.html}</article>
</div>
${nav}
${giscusBlock()}
</main>
${actionbar({ comments: commentsOn(), chapters: true })}`;
    writeFileSync(join(CHAPTERS_OUT, `${c.slug}.html`),
      page(`${c.title} · ${SITE.site_name}`, SITE.description, content));
  });

  const rows = chapters.map((c) =>
    `<li data-num="${esc(String(c.num))}" data-title="${esc(c.title.toLowerCase())}">` +
    `<a href="/chapters/${c.slug}.html">${esc(c.title)}</a></li>`).join("");
  const toc = `<main class="toc"><header class="chead"><p class="kicker">⟨Darkness⟩ · Recorded Incidents</p><h1>Contents</h1></header>
<div class="toc-controls">
<input type="search" id="toc-search" placeholder="Search chapters…" autocomplete="off">
<button id="toc-sort" data-dir="asc">Sort: Oldest first</button>
</div>
<ul class="chlist">${rows}</ul>
<p class="back"><a href="/">← Back to the records</a></p></main>
${actionbar({ comments: false, chapters: false })}`;
  writeFileSync(join(OUT, "toc.html"),
    page(`Contents · ${SITE.site_name}`, SITE.description, toc));

  const splash = `<main class="splash">
<div class="card">
<img class="cover" src="/assets/img/logo.png" alt="${esc(SITE.brand)}">
<h1>${esc(SITE.brand)}</h1>
<blockquote class="disc">“${esc(SITE.tagline)}”</blockquote>
<a class="cta" href="/toc.html">Open the Records →</a>
</div>
<div class="scan" aria-hidden="true"></div>
</main>`;
  writeFileSync(join(OUT, "index.html"), page(SITE.site_name, SITE.description, splash));

  const nf = '<main class="splash"><div class="card"><h1>404</h1>' +
    '<p class="kicker">This case file is missing from the archive.</p>' +
    '<a class="cta" href="/">Return to the records</a></div></main>';
  writeFileSync(join(OUT, "404.html"), page(`404 · ${SITE.site_name}`, "Not found", nf));

  console.log(`Built ${chapters.length} chapters + splash + toc + 404 -> ${OUT}`);
}

build();
