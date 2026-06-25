// Canonical inline-emphasis rules for chapter HTML, shared by:
//   - the web editor's paste + save-normalize path (assets/js/editor/format.js, main.js)
//   - the bulk importer (devScripts/import-gdoc.mjs)
// so content pasted from Google Docs into the editor ends up byte-identical to content
// pulled by the importer. Pure string/regex (no DOM) so it runs in the browser AND in Node.
//
// What we KEEP from a run of text: italic -> <em>, bold -> <strong>, strikethrough -> <s>, a
// recognised text colour / highlight (mapped to a theme-aware role class — see colorRole), and a
// *large* font size (emphasis headings) expressed as relative em. Everything else Google Docs
// emits — font-family, font-weight:400, underline, white-space, vertical-align, the
// docs-internal-guid <b> wrappers, and any unmapped colour (incl. the default body black that
// would be invisible in dark themes) — is dropped so the reader's theme wins.

export const SIZE_EMPHASIS_PT = 16; // only sizes >= this are kept (as relative em); body 12pt is dropped

// Normalise a CSS colour to a comparable lowercase form; rgb(r,g,b) -> #rrggbb.
function normColor(c) {
  c = c.trim().toLowerCase();
  const m = c.match(/^rgb\(\s*(\d+)\s*,\s*(\d+)\s*,\s*(\d+)\s*\)$/);
  if (m)
    return (
      "#" +
      m
        .slice(1, 4)
        .map((n) => (+n).toString(16).padStart(2, "0"))
        .join("")
    );
  return c;
}

// Google Docs palette colours we keep, mapped to theme-aware semantic roles (palette in
// themes.css, applied in main.css). Text colour -> <span class="c-ROLE">; a highlight
// (background-colour) -> <mark class="c-ROLE">. Any colour not listed here is dropped — the
// importer surfaces unmapped colours in its excluded-formatting report so they can be added.
const COLOR_ROLES = {
  "#ff0000": "danger",
  "#e06666": "danger",
  "#4a86e8": "info",
  "#1155cc": "info",
  "#666666": "muted",
  "#999999": "muted",
  "#bf9000": "warn",
};
export function colorRole(color) {
  return color ? COLOR_ROLES[normColor(color)] || null : null;
}

// Pull the emphasis we preserve out of a style="" attribute value.
function emphasisFromStyle(style) {
  const out = {
    bold: false,
    italic: false,
    strike: false,
    color: null,
    highlight: null,
    sizeEm: null,
  };
  if (!style) return out;
  const decls = {};
  for (const d of style.split(";")) {
    const i = d.indexOf(":");
    if (i < 0) continue;
    decls[d.slice(0, i).trim().toLowerCase()] = d.slice(i + 1).trim();
  }
  if (decls["font-weight"]) {
    const w = decls["font-weight"].toLowerCase();
    out.bold = w === "bold" || parseInt(w, 10) >= 600;
  }
  if (decls["font-style"]) out.italic = /italic|oblique/.test(decls["font-style"]);
  // Strikethrough only (underline is intentionally dropped). Docs may combine decorations
  // (e.g. "underline line-through"), so match the token anywhere in the value.
  if (/line-through/.test(decls["text-decoration-line"] || decls["text-decoration"] || "")) {
    out.strike = true;
  }
  if (decls["color"]) out.color = colorRole(decls["color"]);
  if (decls["background-color"]) out.highlight = colorRole(decls["background-color"]);
  const fs = decls["font-size"];
  if (fs) {
    let m;
    if ((m = fs.match(/^([\d.]+)\s*pt$/i))) {
      const pt = parseFloat(m[1]);
      if (pt >= SIZE_EMPHASIS_PT) out.sizeEm = (pt / 12).toFixed(2) + "em";
    } else if ((m = fs.match(/^([\d.]+)\s*r?em$/i))) {
      // Keep the digits verbatim (1.50em must not become 1.5em) so editor output is byte-stable.
      out.sizeEm = m[1] + "em";
    }
    // px / % / unitless are dropped — the editor only ever emits em.
  }
  return out;
}

// Wrap inner HTML in the canonical emphasis tags. Order (innermost out): font-size span,
// colour-role span, <mark> highlight, <s>, <em>, <strong>. Shared so the editor paste path and
// the importer emit byte-identical markup.
export function wrapEmphasis({ bold, italic, strike, color, highlight, sizeEm }, inner) {
  let out = inner;
  if (sizeEm) out = `<span style="font-size:${sizeEm}">${out}</span>`;
  if (color) out = `<span class="c-${color}">${out}</span>`;
  if (highlight) out = `<mark class="c-${highlight}">${out}</mark>`;
  if (strike) out = `<s>${out}</s>`;
  if (italic) out = `<em>${out}</em>`;
  if (bold) out = `<strong>${out}</strong>`;
  return out;
}

// Combine the emphasis from a build {bold,italic,color,sizeEm} object — used by the importer,
// which derives its values from Google Docs <style> classes rather than inline styles.
export function renderRun(emphasis, text) {
  return wrapEmphasis(emphasis, text);
}

const VOID_TAGS = new Set(["br", "img", "hr", "wbr"]);
const TAG_RE = /<\/?([a-zA-Z][a-zA-Z0-9]*)\b([^>]*)>/g;

// Parse inline HTML into a shallow node tree, tolerating Google Docs' (mostly well-nested) markup.
function parseInline(html) {
  const tokens = [];
  let last = 0,
    m;
  TAG_RE.lastIndex = 0;
  while ((m = TAG_RE.exec(html))) {
    if (m.index > last) tokens.push({ t: "text", v: html.slice(last, m.index) });
    tokens.push({
      t: m[0][1] === "/" ? "close" : "open",
      name: m[1].toLowerCase(),
      attrs: m[2],
      self: /\/\s*$/.test(m[2]),
    });
    last = TAG_RE.lastIndex;
  }
  if (last < html.length) tokens.push({ t: "text", v: html.slice(last) });

  let i = 0;
  function children() {
    const nodes = [];
    while (i < tokens.length) {
      const tk = tokens[i];
      if (tk.t === "text") {
        nodes.push({ text: tk.v });
        i++;
      } else if (tk.t === "close") {
        i++; // a close ends the current element regardless of name (tolerant of mismatch)
        return nodes;
      } else {
        // open
        i++;
        if (tk.self || VOID_TAGS.has(tk.name)) continue; // drop <br> etc.
        nodes.push({ name: tk.name, attrs: tk.attrs, children: children() });
      }
    }
    return nodes;
  }
  return children();
}

function serialize(nodes) {
  let out = "";
  for (const n of nodes) {
    if (n.text != null) {
      out += n.text; // text slices keep their source entities verbatim
      continue;
    }
    const inner = serialize(n.children);
    if (!inner) continue; // drop empty wrappers
    const style = (n.attrs.match(/style\s*=\s*"([^"]*)"/i) || [])[1] || "";
    const emp = emphasisFromStyle(style);
    // A <b>/<strong> is bold unless it explicitly carries font-weight:normal (Docs' wrapper trick).
    if (n.name === "b" || n.name === "strong") emp.bold = !/font-weight\s*:\s*normal/i.test(style);
    if (n.name === "i" || n.name === "em") emp.italic = true;
    if (n.name === "s" || n.name === "strike" || n.name === "del") emp.strike = true;
    // span / a / font / unknown inline tags contribute only their style-based emphasis,
    // so links and Docs noise spans get unwrapped to their text.
    out += wrapEmphasis(emp, inner);
  }
  return out;
}

// Clean a single block's inner HTML down to canonical inline markup.
export function cleanInline(html) {
  return serialize(parseInline(html));
}

const asciiTrim = (s) => s.replace(/^[ \t\r\n]+/, "").replace(/[ \t\r\n]+$/, "");
// "Empty" = nothing left once ASCII whitespace is removed; &nbsp; (spacer paragraphs) counts as content.
const isBlockEmpty = (s) => s.replace(/[ \t\r\n]+/g, "").length === 0;

function alignClass(attrs) {
  const cls = (attrs.match(/class\s*=\s*"([^"]*)"/i) || [])[1] || "";
  if (/\bcenter\b/.test(cls)) return "center";
  if (/\bright\b/.test(cls)) return "right";
  const style = (attrs.match(/style\s*=\s*"([^"]*)"/i) || [])[1] || "";
  const ta = (style.match(/text-align\s*:\s*(center|right)/i) || [])[1];
  return ta ? ta.toLowerCase() : null;
}

// Clean a whole chapter body (a run of <p>…</p> / <hr> blocks, possibly wrapped in a Docs
// docs-internal-guid <b>) into the site's canonical one-block-per-line HTML. Used by the
// Node cleanup of pasted chapters; the in-browser save path reuses cleanInline per block.
export function cleanChapterBody(body) {
  const out = [];
  const re = /<hr\b[^>]*>|<(p|h[1-6])\b([^>]*)>([\s\S]*?)<\/\1>/gi;
  let m;
  while ((m = re.exec(body))) {
    if (m[0].toLowerCase().startsWith("<hr")) {
      out.push('<hr class="sb">');
      continue;
    }
    const inner = asciiTrim(cleanInline(m[3]));
    if (isBlockEmpty(inner)) continue;
    const cls = alignClass(m[2]);
    out.push(`<p${cls ? ` class="${cls}"` : ""}>${inner}</p>`);
  }
  return out.join("\n");
}

// Clean a clipboard text/html payload (e.g. a Google Docs paste) into canonical HTML ready
// to drop into the editor at the cursor. Block-structured pastes become one <p>/<hr> per
// block; a single inline selection is cleaned without wrapping.
export function cleanPaste(html) {
  html = html
    .replace(/<!--[\s\S]*?-->/g, "")
    .replace(/<style[\s\S]*?<\/style>/gi, "")
    .replace(/<\/?(?:html|head|body|meta|title|link)\b[^>]*>/gi, "")
    .replace(/<(?:div|li)\b([^>]*)>/gi, "<p$1>")
    .replace(/<\/(?:div|li)>/gi, "</p>");
  if (/<(p|h[1-6]|hr)\b/i.test(html)) {
    const blocks = cleanChapterBody(html);
    if (blocks) return blocks;
  }
  return cleanInline(html).trim();
}
