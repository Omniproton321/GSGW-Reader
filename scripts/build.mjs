#!/usr/bin/env node
// Build the GSGW static site from /chapters into /website.
// All HTML markup lives in templates/ (rendered with Eta). This script only loads data,
// renders the templates, and writes files — no markup here. See CONTRIBUTING.md.
import { readFileSync, writeFileSync, mkdirSync, rmSync, cpSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { dirname, join } from "node:path";
import { Eta } from "eta";
import { esc } from "./lib/markdown.mjs";
import { loadChapters, addParaIds } from "./lib/chapters.mjs";
import { enhance, footnotes, validateChapter } from "./lib/enhance.mjs";
import { buildEpubs } from "./epub.mjs";

const ROOT = dirname(dirname(fileURLToPath(import.meta.url)));
const OUT = join(ROOT, "website");
const CHAPTERS_OUT = join(OUT, "chapters");
const ASSETS_SRC = join(ROOT, "assets"); // hand-authored css/js/img (source of truth)
const ASSETS_OUT = join(OUT, "assets");
const SITE = JSON.parse(readFileSync(join(ROOT, "site.json"), "utf8"));
// Special-block markup config (employee ID cards, etc.), keyed by chapter number. Optional.
let ENHANCEMENTS = {};
try {
  ENHANCEMENTS = JSON.parse(readFileSync(join(ROOT, "scripts", "enhancements.json"), "utf8"));
} catch {} // no file / bad JSON -> auto-detected lore boxes still apply

// autoEscape:false — templates emit pre-escaped HTML (escaping stays the build's job via esc()).
// autoTrim:false — preserve template whitespace literally; use `-%>` to slurp newlines where needed.
const eta = new Eta({ views: join(ROOT, "templates"), autoEscape: false, autoTrim: false });

// Render a page-body template, then wrap it in the base layout. `title`/`description` are
// escaped here (templates raw-insert them), matching the old page() helper. `headExtra` is
// raw <head> markup (e.g. per-chapter font preloads); empty for pages that don't need it.
function page(bodyTemplate, data, { title, description, headExtra }) {
  const content = eta.render(bodyTemplate, data);
  return eta.render("layouts/base", {
    title: esc(title),
    description: esc(description),
    content,
    headExtra: headExtra || "",
    links: SITE.links,
  });
}

// Self-hosted woff2 to <link rel=preload> when a chapter uses its f-* role, so only the faces a
// chapter actually references are preloaded (unrelated chapters get nothing). f-chat (Comic Sans)
// is a system font with no file, so it has no preload — the @font-face/.f-* rules live in main.css.
const FONT_PRELOAD = {
  script: "/assets/fonts/caveat.woff2",
  display: "/assets/fonts/lobster.woff2",
  hand: "/assets/fonts/gloria-hallelujah.woff2",
  notice: "/assets/fonts/merriweather.woff2",
  title: "/assets/fonts/spectral.woff2",
};
function fontPreloads(bodyHtml) {
  const roles = new Set([...bodyHtml.matchAll(/class="[^"]*\bf-([a-z]+)\b/g)].map((m) => m[1]));
  return [...roles]
    .map((r) => FONT_PRELOAD[r])
    .filter(Boolean)
    .map((href) => `<link rel="preload" href="${href}" as="font" type="font/woff2" crossorigin>`)
    .join("\n    ");
}

// True once giscus is configured with real values (not missing / placeholder).
function commentsOn() {
  const g = SITE.giscus;
  return !!(g && g.repo && g.repoId && !g.repo.includes("YOUR_") && !g.repoId.includes("REPLACE"));
}

// Parts split the book into acts (see site.json `parts`). A part is "live" once it has a
// `start`; one without is a "coming soon" placeholder (no TOC, matches no chapters).
const PARTS = SITE.parts || [];
// The part a chapter number belongs to (inclusive start..end), or null if none.
function partOf(num) {
  const n = parseFloat(num);
  return PARTS.find((p) => p.start != null && n >= p.start && n <= (p.end ?? Infinity)) || null;
}
// Per-part TOC URL (also used as the chapter "Menu" target); falls back to the Parts page.
function tocHref(part) {
  return part ? `/toc-${part.slug}.html` : "/parts.html";
}

// recursive removes can intermittently hit ENOTEMPTY/EBUSY when another process (the dev
// server, an editor, an indexer) briefly holds a handle in the dir — retry rather than fail.
const RM = { recursive: true, force: true, maxRetries: 10, retryDelay: 50 };

function build() {
  rmSync(CHAPTERS_OUT, RM); // clear stale pages
  mkdirSync(CHAPTERS_OUT, { recursive: true });

  rmSync(ASSETS_OUT, RM); // copy css/js/img into the output
  cpSync(ASSETS_SRC, ASSETS_OUT, { recursive: true });

  const comments = commentsOn();
  const themes = SITE.themes;
  const g = SITE.giscus;
  // Config handed to reader.js (per-paragraph giscus embeds) via an inline JSON <script>.
  const giscusJson = comments
    ? JSON.stringify({
        repo: g.repo,
        repoId: g.repoId,
        category: g.category,
        categoryId: g.categoryId,
        countsApi: SITE.counts_api || "",
      })
    : "";

  const chapters = loadChapters(join(ROOT, "chapters"));

  // Surface any enhancements.json anchors that no longer resolve (e.g. wording changed in
  // the gdoc). Warn, don't fail — the chapter just renders without that special block.
  for (const c of chapters) {
    for (const e of validateChapter(c.html, ENHANCEMENTS[c.num])) {
      console.warn(`  ! enhancement ch${c.num}: ${e}`);
    }
  }

  // Generate the per-Part EPUBs into website/ and note which Parts got one (for download links).
  const epubSlugs = new Set(buildEpubs());
  const epubHref = (slug) => (epubSlugs.has(slug) ? `/gsgw-${slug}.epub` : "");

  // Chapters grouped by part, for the in-chapter "jump to chapter" dropdown.
  const jumpByPart = new Map();
  for (const c of chapters) {
    const p = partOf(c.num);
    const key = p ? p.slug : "_";
    if (!jumpByPart.has(key)) jumpByPart.set(key, []);
    jumpByPart.get(key).push({ slug: c.slug, labelEsc: esc(c.title) });
  }

  chapters.forEach((c, i) => {
    const prev = i > 0 ? chapters[i - 1] : null;
    const nxt = i < chapters.length - 1 ? chapters[i + 1] : null;
    const part = partOf(c.num);
    const bodyHtml = addParaIds(footnotes(enhance(c.html, ENHANCEMENTS[c.num])), c.slug);
    const html = page(
      "pages/chapter",
      {
        slug: c.slug,
        numEsc: esc(String(c.num)),
        titleEsc: esc(c.title),
        bodyHtml,
        prev: prev ? prev.slug : null,
        next: nxt ? nxt.slug : null,
        tocHref: tocHref(part),
        jump: jumpByPart.get(part ? part.slug : "_"),
        comments,
        themes,
        giscus: g,
        giscusJson,
      },
      {
        title: `${c.title} · ${SITE.site_name}`,
        description: SITE.description,
        headExtra: fontPreloads(bodyHtml),
      },
    );
    writeFileSync(join(CHAPTERS_OUT, `${c.slug}.html`), html);
  });

  // One TOC per live part, each listing only that part's chapters.
  const liveParts = PARTS.filter((p) => p.start != null);
  liveParts.forEach((part) => {
    const tocChapters = chapters
      .filter((c) => partOf(c.num) === part)
      .map((c) => ({
        slug: c.slug,
        numEsc: esc(String(c.num)),
        titleEsc: esc(c.title),
        titleLowerEsc: esc(c.title.toLowerCase()),
      }));
    writeFileSync(
      join(OUT, `toc-${part.slug}.html`),
      page(
        "pages/toc",
        {
          chapters: tocChapters,
          partNameEsc: esc(part.name),
          epubHref: epubHref(part.slug),
          countsApi: comments ? SITE.counts_api || "" : "",
          themes,
        },
        { title: `${part.name} · ${SITE.site_name}`, description: SITE.description },
      ),
    );
  });

  // Parts landing page: a block per part (image, label, chapter range; "coming soon" when
  // a part has no start, or a release date when one is set). Links live parts to their TOC.
  const fmtRelease = (iso) =>
    new Date(`${iso}T00:00:00Z`).toLocaleDateString("en-US", {
      year: "numeric",
      month: "long",
      day: "numeric",
      timeZone: "UTC",
    });
  const partBlocks = PARTS.map((p) => ({
    nameEsc: esc(p.name),
    image: p.image || "",
    href: p.start != null ? tocHref(p) : "",
    rangeEsc: esc(
      p.start != null
        ? `Chapters ${p.start}–${p.end ?? "…"}`
        : p.release
          ? `Releases ${fmtRelease(p.release)}`
          : "Coming soon",
    ),
    epub: epubHref(p.slug),
  }));
  writeFileSync(
    join(OUT, "parts.html"),
    page(
      "pages/parts",
      { parts: partBlocks, brandEsc: esc(SITE.brand), themes },
      { title: `Parts · ${SITE.site_name}`, description: SITE.description },
    ),
  );

  writeFileSync(
    join(OUT, "index.html"),
    page(
      "pages/splash",
      { brandEsc: esc(SITE.brand), taglineEsc: esc(SITE.tagline) },
      { title: SITE.site_name, description: SITE.description },
    ),
  );

  writeFileSync(
    join(OUT, "404.html"),
    page("pages/404", {}, { title: `404 · ${SITE.site_name}`, description: "Not found" }),
  );

  writeFileSync(
    join(OUT, "about.html"),
    page(
      "pages/about",
      { brandEsc: esc(SITE.brand), titleEsc: esc(SITE.title), shortEsc: esc(SITE.short) },
      { title: `About · ${SITE.site_name}`, description: SITE.description },
    ),
  );

  // The chapter editor is a standalone full-document page (its own <head>/JS, not the base
  // layout), so it's rendered directly rather than wrapped by page().
  writeFileSync(join(OUT, "editor.html"), eta.render("pages/editor", { themes }));

  console.log(
    `Built ${chapters.length} chapters + splash + parts + ${liveParts.length} part TOCs + 404 + about + editor + assets -> ${OUT}`,
  );
}

export { build };

// Run a one-shot build when invoked directly (`node scripts/build.mjs`), but not
// when imported by the watcher (scripts/watch.mjs), which drives build() itself.
if (process.argv[1] === fileURLToPath(import.meta.url)) {
  build();
}
