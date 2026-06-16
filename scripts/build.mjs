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

const ROOT = dirname(dirname(fileURLToPath(import.meta.url)));
const OUT = join(ROOT, "website");
const CHAPTERS_OUT = join(OUT, "chapters");
const ASSETS_SRC = join(ROOT, "assets"); // hand-authored css/js/img (source of truth)
const ASSETS_OUT = join(OUT, "assets");
const SITE = JSON.parse(readFileSync(join(ROOT, "site.json"), "utf8"));

// autoEscape:false — templates emit pre-escaped HTML (escaping stays the build's job via esc()).
// autoTrim:false — preserve template whitespace literally; use `-%>` to slurp newlines where needed.
const eta = new Eta({ views: join(ROOT, "templates"), autoEscape: false, autoTrim: false });

// Render a page-body template, then wrap it in the base layout. `title`/`description` are
// escaped here (templates raw-insert them), matching the old page() helper.
function page(bodyTemplate, data, { title, description }) {
  const content = eta.render(bodyTemplate, data);
  return eta.render("layouts/base", { title: esc(title), description: esc(description), content });
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

function build() {
  rmSync(CHAPTERS_OUT, { recursive: true, force: true }); // clear stale pages
  mkdirSync(CHAPTERS_OUT, { recursive: true });

  rmSync(ASSETS_OUT, { recursive: true, force: true }); // copy css/js/img into the output
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

  chapters.forEach((c, i) => {
    const prev = i > 0 ? chapters[i - 1] : null;
    const nxt = i < chapters.length - 1 ? chapters[i + 1] : null;
    const html = page(
      "pages/chapter",
      {
        slug: c.slug,
        numEsc: esc(String(c.num)),
        titleEsc: esc(c.title),
        bodyHtml: addParaIds(c.html, c.slug),
        prev: prev ? prev.slug : null,
        next: nxt ? nxt.slug : null,
        tocHref: tocHref(partOf(c.num)),
        comments,
        themes,
        giscus: g,
        giscusJson,
      },
      { title: `${c.title} · ${SITE.site_name}`, description: SITE.description },
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
        { chapters: tocChapters, partNameEsc: esc(part.name), themes },
        { title: `${part.name} · ${SITE.site_name}`, description: SITE.description },
      ),
    );
  });

  // Parts landing page: a block per part (image, label, chapter range; "coming soon" when
  // a part has no start). Links live parts to their TOC.
  const partBlocks = PARTS.map((p) => ({
    nameEsc: esc(p.name),
    image: p.image || "",
    href: p.start != null ? tocHref(p) : "",
    rangeEsc: esc(p.start != null ? `Chapters ${p.start}–${p.end ?? "…"}` : "Coming soon"),
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

  // The chapter editor is a standalone full-document page (its own <head>/JS, not the base
  // layout), so it's rendered directly rather than wrapped by page().
  writeFileSync(join(OUT, "editor.html"), eta.render("pages/editor", { themes }));

  console.log(
    `Built ${chapters.length} chapters + splash + parts + ${liveParts.length} part TOCs + 404 + editor + assets -> ${OUT}`,
  );
}

build();
