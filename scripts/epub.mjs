#!/usr/bin/env node
// Build a downloadable EPUB per live Part (see site.json `parts`) from /chapters into /website.
// Zero-dependency: the EPUB is a ZIP, written by hand here using Node's zlib (deflate + crc32).
// Reuses the same chapter loader + part ranges as the site build (scripts/build.mjs) so the
// books stay in sync with the site. The Part image is embedded as the cover / first page.
import { readFileSync, writeFileSync, mkdirSync } from "node:fs";
import { fileURLToPath, pathToFileURL } from "node:url";
import { dirname, join, extname } from "node:path";
import { deflateRawSync, crc32 } from "node:zlib";
import { loadChapters } from "./lib/chapters.mjs";
import { esc } from "./lib/markdown.mjs";

const ROOT = dirname(dirname(fileURLToPath(import.meta.url)));
const OUT = join(ROOT, "website");
const SITE = JSON.parse(readFileSync(join(ROOT, "site.json"), "utf8"));

// --- Minimal ZIP writer ---------------------------------------------------
// An EPUB is a ZIP whose first entry must be an uncompressed `mimetype`. We deflate
// everything else. Times are fixed (1980-01-01) so rebuilds are byte-stable.
function zip(entries) {
  const chunks = [];
  const central = [];
  let offset = 0;
  for (const e of entries) {
    const data = e.data;
    const crc = crc32(data) >>> 0;
    const comp = e.store ? data : deflateRawSync(data);
    const method = e.store ? 0 : 8;
    const name = Buffer.from(e.name, "utf8");

    const local = Buffer.alloc(30);
    local.writeUInt32LE(0x04034b50, 0); // local file header signature
    local.writeUInt16LE(20, 4); // version needed
    local.writeUInt16LE(0, 6); // flags
    local.writeUInt16LE(method, 8);
    local.writeUInt16LE(0, 10); // mod time
    local.writeUInt16LE(0x21, 12); // mod date (1980-01-01)
    local.writeUInt32LE(crc, 14);
    local.writeUInt32LE(comp.length, 18);
    local.writeUInt32LE(data.length, 22);
    local.writeUInt16LE(name.length, 26);
    local.writeUInt16LE(0, 28); // extra len
    chunks.push(local, name, comp);

    const cen = Buffer.alloc(46);
    cen.writeUInt32LE(0x02014b50, 0); // central dir header signature
    cen.writeUInt16LE(20, 4); // version made by
    cen.writeUInt16LE(20, 6); // version needed
    cen.writeUInt16LE(0, 8); // flags
    cen.writeUInt16LE(method, 10);
    cen.writeUInt16LE(0, 12); // mod time
    cen.writeUInt16LE(0x21, 14); // mod date
    cen.writeUInt32LE(crc, 16);
    cen.writeUInt32LE(comp.length, 20);
    cen.writeUInt32LE(data.length, 24);
    cen.writeUInt16LE(name.length, 28);
    cen.writeUInt16LE(0, 30); // extra len
    cen.writeUInt16LE(0, 32); // comment len
    cen.writeUInt16LE(0, 34); // disk number start
    cen.writeUInt16LE(0, 36); // internal attrs
    cen.writeUInt32LE(0, 38); // external attrs
    cen.writeUInt32LE(offset, 42); // local header offset
    central.push(cen, name);

    offset += local.length + name.length + comp.length;
  }
  const cd = Buffer.concat(central);
  const eocd = Buffer.alloc(22);
  eocd.writeUInt32LE(0x06054b50, 0); // end of central dir signature
  eocd.writeUInt16LE(entries.length, 8); // entries on this disk
  eocd.writeUInt16LE(entries.length, 10); // total entries
  eocd.writeUInt32LE(cd.length, 12); // cd size
  eocd.writeUInt32LE(offset, 16); // cd offset
  return Buffer.concat([...chunks, cd, eocd]);
}

// --- Content (XHTML / OPF / NAV) ------------------------------------------
// EPUB content docs are strict XHTML: only XML's five predefined named entities
// (amp/lt/gt/quot/apos) are valid, and void tags must self-close. The chapters (a gdoc
// import) use HTML4 named entities, so rewrite those to numeric. Full HTML4 set, so a
// new entity in a future chapter doesn't silently corrupt a book; any unmapped one
// throws (see guard below) rather than reaching a reader.
const ENT = {
  // Latin-1 supplement
  nbsp: 160,
  iexcl: 161,
  cent: 162,
  pound: 163,
  curren: 164,
  yen: 165,
  brvbar: 166,
  sect: 167,
  uml: 168,
  copy: 169,
  ordf: 170,
  laquo: 171,
  not: 172,
  shy: 173,
  reg: 174,
  macr: 175,
  deg: 176,
  plusmn: 177,
  sup2: 178,
  sup3: 179,
  acute: 180,
  micro: 181,
  para: 182,
  middot: 183,
  cedil: 184,
  sup1: 185,
  ordm: 186,
  raquo: 187,
  frac14: 188,
  frac12: 189,
  frac34: 190,
  iquest: 191,
  Agrave: 192,
  Aacute: 193,
  Acirc: 194,
  Atilde: 195,
  Auml: 196,
  Aring: 197,
  AElig: 198,
  Ccedil: 199,
  Egrave: 200,
  Eacute: 201,
  Ecirc: 202,
  Euml: 203,
  Igrave: 204,
  Iacute: 205,
  Icirc: 206,
  Iuml: 207,
  ETH: 208,
  Ntilde: 209,
  Ograve: 210,
  Oacute: 211,
  Ocirc: 212,
  Otilde: 213,
  Ouml: 214,
  times: 215,
  Oslash: 216,
  Ugrave: 217,
  Uacute: 218,
  Ucirc: 219,
  Uuml: 220,
  Yacute: 221,
  THORN: 222,
  szlig: 223,
  agrave: 224,
  aacute: 225,
  acirc: 226,
  atilde: 227,
  auml: 228,
  aring: 229,
  aelig: 230,
  ccedil: 231,
  egrave: 232,
  eacute: 233,
  ecirc: 234,
  euml: 235,
  igrave: 236,
  iacute: 237,
  icirc: 238,
  iuml: 239,
  eth: 240,
  ntilde: 241,
  ograve: 242,
  oacute: 243,
  ocirc: 244,
  otilde: 245,
  ouml: 246,
  divide: 247,
  oslash: 248,
  ugrave: 249,
  uacute: 250,
  ucirc: 251,
  uuml: 252,
  yacute: 253,
  thorn: 254,
  yuml: 255,
  // Latin extended / punctuation / symbols
  OElig: 338,
  oelig: 339,
  Scaron: 352,
  scaron: 353,
  Yuml: 376,
  fnof: 402,
  circ: 710,
  tilde: 732,
  ensp: 8194,
  emsp: 8195,
  thinsp: 8201,
  zwnj: 8204,
  zwj: 8205,
  lrm: 8206,
  rlm: 8207,
  ndash: 8211,
  mdash: 8212,
  lsquo: 8216,
  rsquo: 8217,
  sbquo: 8218,
  ldquo: 8220,
  rdquo: 8221,
  bdquo: 8222,
  dagger: 8224,
  Dagger: 8225,
  bull: 8226,
  hellip: 8230,
  permil: 8240,
  prime: 8242,
  Prime: 8243,
  lsaquo: 8249,
  rsaquo: 8250,
  oline: 8254,
  frasl: 8260,
  euro: 8364,
  trade: 8482,
  larr: 8592,
  uarr: 8593,
  rarr: 8594,
  darr: 8595,
  harr: 8596,
  infin: 8734,
  ne: 8800,
  le: 8804,
  ge: 8805,
  // Greek
  Alpha: 913,
  Beta: 914,
  Gamma: 915,
  Delta: 916,
  Epsilon: 917,
  Zeta: 918,
  Eta: 919,
  Theta: 920,
  Iota: 921,
  Kappa: 922,
  Lambda: 923,
  Mu: 924,
  Nu: 925,
  Xi: 926,
  Omicron: 927,
  Pi: 928,
  Rho: 929,
  Sigma: 931,
  Tau: 932,
  Upsilon: 933,
  Phi: 934,
  Chi: 935,
  Psi: 936,
  Omega: 937,
  alpha: 945,
  beta: 946,
  gamma: 947,
  delta: 948,
  epsilon: 949,
  zeta: 950,
  eta: 951,
  theta: 952,
  iota: 953,
  kappa: 954,
  lambda: 955,
  mu: 956,
  nu: 957,
  xi: 958,
  omicron: 959,
  pi: 960,
  rho: 961,
  sigmaf: 962,
  sigma: 963,
  tau: 964,
  upsilon: 965,
  phi: 966,
  chi: 967,
  psi: 968,
  omega: 969,
};
const XML_ENT = new Set(["amp", "lt", "gt", "quot", "apos"]);
function xhtmlBody(html, label) {
  const out = html
    .replace(/&([a-zA-Z][a-zA-Z0-9]*);/g, (m, n) =>
      ENT[n] ? `&#${ENT[n]};` : XML_ENT.has(n) ? m : `\0${n}\0`,
    )
    .replace(/<(br|hr|img)((?:\s[^>]*)?)\s*\/?>/g, "<$1$2/>");
  // Guard: any named entity we couldn't map would be invalid XHTML and break the reader.
  // Fail the build loudly with the offender(s) instead, so it gets added to ENT above.
  const bad = out.match(/\0([a-zA-Z0-9]+)\0/g);
  if (bad) {
    const names = [...new Set(bad.map((b) => b.replace(/\0/g, "")))];
    throw new Error(
      `${label}: unmapped HTML entity ${names.map((n) => `&${n};`).join(", ")} — add to ENT in scripts/epub.mjs`,
    );
  }
  return out;
}

const CONTAINER = `<?xml version="1.0" encoding="utf-8"?>
<container version="1.0" xmlns="urn:oasis:names:tc:opendocument:xmlns:container">
  <rootfiles>
    <rootfile full-path="OEBPS/content.opf" media-type="application/oebps-package+xml"/>
  </rootfiles>
</container>`;

const CSS = `body { margin: 1em; line-height: 1.5; }
body.cover { margin: 0; text-align: center; }
body.cover img { max-width: 100%; max-height: 100%; }
h1.chapter-title { font-size: 1.4em; text-align: center; margin: 1em 0 1.5em; }
p { margin: 0 0 0.8em; }
p.center { text-align: center; }
p.right { text-align: right; }
em { font-style: italic; }
strong { font-weight: bold; }
hr.sb { border: 0; margin: 1.5em 0; }
hr.sb::after { content: "* * *"; display: block; text-align: center; }
blockquote { margin: 1em 1.5em; font-style: italic; }
body.info { text-align: center; margin: 3em 1em; }
body.info h1.book-title { font-size: 1.6em; margin-bottom: 0.5em; }
body.info p.book-part { font-size: 1.2em; margin: 0.5em 0 2em; }
body.info p.book-read { font-size: 0.9em; }`;

function chapterDoc(title, body) {
  return `<?xml version="1.0" encoding="utf-8"?>
<!DOCTYPE html>
<html xmlns="http://www.w3.org/1999/xhtml" xml:lang="en" lang="en">
<head><meta charset="utf-8"/><title>${esc(title)}</title>
<link rel="stylesheet" type="text/css" href="style.css"/></head>
<body><h1 class="chapter-title">${esc(title)}</h1>
${xhtmlBody(body, title)}
</body></html>`;
}

// Title / part / where-to-read page, shown right after the cover.
function infoDoc(partName) {
  return `<?xml version="1.0" encoding="utf-8"?>
<!DOCTYPE html>
<html xmlns="http://www.w3.org/1999/xhtml" xml:lang="en" lang="en">
<head><meta charset="utf-8"/><title>${esc(SITE.title)}</title>
<link rel="stylesheet" type="text/css" href="style.css"/></head>
<body class="info">
<h1 class="book-title">${esc(SITE.title)}</h1>
<p class="book-part">${esc(partName)}</p>
<p class="book-read">Read at <a href="${esc(SITE.site_url)}">${esc(SITE.site_url)}</a></p>
</body></html>`;
}

function coverDoc(imgFile) {
  return `<?xml version="1.0" encoding="utf-8"?>
<!DOCTYPE html>
<html xmlns="http://www.w3.org/1999/xhtml">
<head><meta charset="utf-8"/><title>Cover</title>
<link rel="stylesheet" type="text/css" href="style.css"/></head>
<body class="cover"><img src="${imgFile}" alt="Cover"/></body></html>`;
}

function navDoc(title, items) {
  const lis = items.map((i) => `      <li><a href="${i.href}">${esc(i.label)}</a></li>`).join("\n");
  return `<?xml version="1.0" encoding="utf-8"?>
<!DOCTYPE html>
<html xmlns="http://www.w3.org/1999/xhtml" xmlns:epub="http://www.idpf.org/2007/ops" lang="en">
<head><meta charset="utf-8"/><title>${esc(title)}</title></head>
<body><nav epub:type="toc" id="toc"><h1>Contents</h1>
    <ol>
${lis}
    </ol></nav></body></html>`;
}

function ncxDoc(uid, title, items) {
  const pts = items
    .map(
      (i, n) =>
        `    <navPoint id="np${n + 1}" playOrder="${n + 1}"><navLabel><text>${esc(i.label)}</text></navLabel><content src="${i.href}"/></navPoint>`,
    )
    .join("\n");
  return `<?xml version="1.0" encoding="utf-8"?>
<ncx xmlns="http://www.daisy.org/z3986/2005/ncx/" version="2005-1">
  <head><meta name="dtb:uid" content="${uid}"/></head>
  <docTitle><text>${esc(title)}</text></docTitle>
  <navMap>
${pts}
  </navMap></ncx>`;
}

function buildPart(part, chapters) {
  const uid = `urn:uuid:gsgw-${part.slug}`;
  const bookTitle = `${SITE.title} — ${part.name}`;
  const coverFile = `cover${extname(part.image) || ".jpg"}`;
  const coverData = readFileSync(join(ROOT, part.image.replace(/^\//, "")));
  const coverMime = extname(part.image) === ".png" ? "image/png" : "image/jpeg";

  const docs = chapters.map((c) => ({
    id: c.slug,
    file: `${c.slug}.xhtml`,
    label: c.title,
    data: Buffer.from(chapterDoc(c.title, c.html), "utf8"),
  }));
  const navItems = docs.map((d) => ({ href: d.file, label: d.label }));

  const manifest = [
    `<item id="nav" href="nav.xhtml" media-type="application/xhtml+xml" properties="nav"/>`,
    `<item id="ncx" href="toc.ncx" media-type="application/x-dtbncx+xml"/>`,
    `<item id="css" href="style.css" media-type="text/css"/>`,
    `<item id="cover-img" href="${coverFile}" media-type="${coverMime}" properties="cover-image"/>`,
    `<item id="cover" href="cover.xhtml" media-type="application/xhtml+xml"/>`,
    `<item id="info" href="info.xhtml" media-type="application/xhtml+xml"/>`,
    ...docs.map((d) => `<item id="${d.id}" href="${d.file}" media-type="application/xhtml+xml"/>`),
  ].join("\n    ");
  const spine = [
    `<itemref idref="cover"/>`,
    `<itemref idref="info"/>`,
    ...docs.map((d) => `<itemref idref="${d.id}"/>`),
  ].join("\n    ");

  const opf = `<?xml version="1.0" encoding="utf-8"?>
<package xmlns="http://www.idpf.org/2007/opf" version="3.0" unique-identifier="bookid">
  <metadata xmlns:dc="http://purl.org/dc/elements/1.1/">
    <dc:identifier id="bookid">${uid}</dc:identifier>
    <dc:title>${esc(bookTitle)}</dc:title>
    <dc:language>en</dc:language>
    <dc:creator>${esc(SITE.brand)}</dc:creator>
    <meta property="dcterms:modified">${new Date().toISOString().replace(/\.\d+Z$/, "Z")}</meta>
    <meta name="cover" content="cover-img"/>
  </metadata>
  <manifest>
    ${manifest}
  </manifest>
  <spine toc="ncx">
    ${spine}
  </spine>
</package>`;

  const entries = [
    { name: "mimetype", data: Buffer.from("application/epub+zip"), store: true },
    { name: "META-INF/container.xml", data: Buffer.from(CONTAINER) },
    { name: "OEBPS/content.opf", data: Buffer.from(opf) },
    { name: "OEBPS/nav.xhtml", data: Buffer.from(navDoc(bookTitle, navItems)) },
    { name: "OEBPS/toc.ncx", data: Buffer.from(ncxDoc(uid, bookTitle, navItems)) },
    { name: "OEBPS/style.css", data: Buffer.from(CSS) },
    { name: "OEBPS/cover.xhtml", data: Buffer.from(coverDoc(coverFile)) },
    { name: "OEBPS/info.xhtml", data: Buffer.from(infoDoc(part.name)) },
    { name: `OEBPS/${coverFile}`, data: coverData },
    ...docs.map((d) => ({ name: `OEBPS/${d.file}`, data: d.data })),
  ];

  const out = join(OUT, `gsgw-${part.slug}.epub`);
  writeFileSync(out, zip(entries));
  return { out, count: chapters.length };
}

// Build every live Part with an image into website/gsgw-<slug>.epub. Returns the slugs
// built so the site build knows which Parts get a download link. Called from build.mjs
// (so deploys ship the books) and runnable standalone via `npm run epub`.
export function buildEpubs() {
  mkdirSync(OUT, { recursive: true });
  const all = loadChapters(join(ROOT, "chapters"));
  const liveParts = (SITE.parts || []).filter((p) => p.start != null && p.image);
  const built = [];
  for (const part of liveParts) {
    const chs = all.filter((c) => {
      const n = parseFloat(c.num);
      return n >= part.start && n <= (part.end ?? Infinity);
    });
    if (!chs.length) {
      console.log(`Skipped ${part.name}: no chapters in range`);
      continue;
    }
    const { out, count } = buildPart(part, chs);
    built.push(part.slug);
    console.log(`Built ${out} (${count} chapters)`);
  }
  return built;
}

// Run directly (`node scripts/epub.mjs` / `npm run epub`), but not when imported by build.mjs.
if (import.meta.url === pathToFileURL(process.argv[1]).href) buildEpubs();
