// Build-time chapter "enhancements": detect special blocks (employee ID cards, lore/wiki
// boxes) in the imported chapter HTML and tag their paragraphs with CSS classes. The CSS
// (assets/css/main.css) does the visual work; this file only decides WHICH paragraphs get
// which class.
//
// Hard rule: this NEVER adds, removes, reorders, or wraps a paragraph — it only appends a
// class to existing `<p>` lines. That keeps every paragraph a direct `.cbody > p` child with
// a stable build-time id (see addParaIds in chapters.mjs), so the per-paragraph comment
// system (`.cbody > p[id]` in reader/paragraph-comments.js) keeps working untouched.
//
// Two detection sources:
//   1. Auto: a run delimited by dashed lines (------ … ------) -> `lore` box. Self-marking
//      in the source text, so no config needed.
//   2. Listed: blocks declared in enhancements.json, anchored by the plain text of their
//      first (`from`) and last (`to`) paragraph -> `<type>` box (e.g. idcard). Used for
//      blocks that have no natural delimiter in the prose.

// Minimal entity decode so config anchors can be written with literal characters while the
// chapter HTML stores them as entities (the gdoc importer emits &rsquo; &amp; etc.).
const ENT = {
  "&amp;": "&",
  "&lt;": "<",
  "&gt;": ">",
  "&quot;": '"',
  "&#39;": "'",
  "&nbsp;": " ",
  "&rsquo;": "’",
  "&lsquo;": "‘",
  "&ldquo;": "“",
  "&rdquo;": "”",
  "&mdash;": "—",
  "&ndash;": "–",
  "&hellip;": "…",
  // Accented Latin letters the gdoc export emits as named entities (e.g. "Bon app&eacute;tit",
  // "d&eacute;j&agrave; vu") — decode so config anchors can be written with the real glyph.
  "&eacute;": "é",
  "&egrave;": "è",
  "&ecirc;": "ê",
  "&euml;": "ë",
  "&aacute;": "á",
  "&agrave;": "à",
  "&acirc;": "â",
  "&auml;": "ä",
  "&atilde;": "ã",
  "&aring;": "å",
  "&iacute;": "í",
  "&icirc;": "î",
  "&iuml;": "ï",
  "&oacute;": "ó",
  "&ocirc;": "ô",
  "&ouml;": "ö",
  "&otilde;": "õ",
  "&uacute;": "ú",
  "&ucirc;": "û",
  "&uuml;": "ü",
  "&ccedil;": "ç",
  "&ntilde;": "ñ",
};

const isP = (line) => /^<p[\s>]/.test(line);

// Indices of paragraph lines whose plain text exactly equals `text`.
function paraIdxsWithText(lines, text) {
  const out = [];
  for (let i = 0; i < lines.length; i++)
    if (isP(lines[i]) && plainText(lines[i]) === text) out.push(i);
  return out;
}

// A paragraph's visible text: strip tags, decode entities, collapse whitespace. Numeric
// entities are decoded generically (the source uses e.g. &#9472;=━, &#8361;=₩, &#9650;=▲,
// &#8741;=‖, &#8251;=※), which both the signature matchers and config anchors rely on.
export function plainText(line) {
  return line
    .replace(/<[^>]+>/g, "")
    .replace(/&#(\d+);/g, (_m, n) => String.fromCodePoint(+n))
    .replace(/&[a-zA-Z]+;/g, (m) => ENT[m] ?? m)
    .replace(/\s+/g, " ")
    .trim();
}

// Append a class to a single `<p ...>` line, merging with an existing class="" if present.
function addClass(line, cls) {
  if (/^<p[^>]*\sclass="/.test(line)) {
    return line.replace(/^(<p[^>]*\sclass=")([^"]*)"/, (_m, pre, cur) => `${pre}${cur} ${cls}"`);
  }
  return line.replace(/^<p/, `<p class="${cls}"`);
}

// Tag paragraphs index `start`..`end` (inclusive) with `type`, plus `-top`/`-bot` on the ends.
function tagRange(lines, start, end, type) {
  for (let i = start; i <= end; i++) {
    if (!isP(lines[i])) continue;
    lines[i] = addClass(lines[i], type);
    if (i === start) lines[i] = addClass(lines[i], `${type}-top`);
    if (i === end) lines[i] = addClass(lines[i], `${type}-bot`);
  }
}

// Every class this module assigns — used to stop two detectors fighting over one paragraph.
const TAGGED =
  /\sclass="[^"]*\b(?:idcard|lore|chat|sysmsg|card|terminal|options|panel|note|voice|scroll|record|verticaltext)\b/;
const isTagged = (line) => TAGGED.test(line);

// Tag each maximal run of >=minLen consecutive, not-already-tagged paragraphs that satisfy
// `matchFn` with `type` (and -top/-bot on the run's ends).
function tagRuns(lines, matchFn, type, minLen = 2) {
  let i = 0;
  while (i < lines.length) {
    if (!isP(lines[i]) || isTagged(lines[i]) || !matchFn(lines[i])) {
      i++;
      continue;
    }
    let j = i;
    while (
      j + 1 < lines.length &&
      isP(lines[j + 1]) &&
      !isTagged(lines[j + 1]) &&
      matchFn(lines[j + 1])
    )
      j++;
    if (j - i + 1 >= minLen) tagRange(lines, i, j, type);
    i = j + 1;
  }
}

// A lore-box delimiter line: a run of dashes/equals (the source uses both `==========` and
// `-------------------------`, sometimes OCR-mangled like `---------------------=`). Asterisk
// runs (`*****`) are deliberately excluded — in this source they appear as lone scene-break
// marks, not paired box delimiters, so treating them as delimiters would mis-bracket text.
const isDelimLine = (line) => /^[-–—=]{5,}$/.test(plainText(line));

// Business card: the whited-out card is wrapped in box-drawing rules (─── = &#9472; U+2500,
// light or heavy variant). Explicit codepoints avoid confusing the many dash lookalikes.
const isCardRule = (line) => /^[─━]{2,}$/.test(plainText(line));
// Alien-shop "terminal": catalog / cart lines carry ₩ prices or ※banner※ marks.
const isShopLine = (line) => {
  const t = plainText(line);
  return t.includes("₩") || t.includes("※");
};
// Numbered choice / enumeration options ("1. Water", "2. Iron", …).
const isOptionLine = (line) => /^\d+\.\s/.test(plainText(line));
// Control-panel gauge: a lever bar (‖----‖) or a lone position marker (▲ ▼ ◀ ▶), used only
// as the continuation of a "MIN MAX" label so it can't match stray dashes elsewhere.
const isGaugeLine = (line) => {
  const t = plainText(line);
  // bar chars: ∥ U+2225, ‖ U+2016, │ U+2502, | ; markers: ▲▼◀▶◆●○ ; plus dashes/equals.
  return /^[∥‖│|▲▼◀▶◆●○─━\-=\s]+$/.test(t) && /[∥‖│▲▼◀▶─━=-]/.test(t);
};
// Spaced-out "voice": the mascot/system speaking one letter at a time ("G O O D  B O Y",
// "Y o u", "T h e m e P a r k", "I t ’ s  o k a y"). Signature: the whole paragraph is mostly
// SINGLE-LETTER tokens. Counting only single-char ALPHANUMERIC tokens (≥2 of them, ≥70% of all
// tokens) catches even short cries while excluding ordinary prose (real sentences always have
// multi-char words), initialisms ("J. R. R."), and symbol runs like a "■ ■ ■" redaction.
const isVoiceLine = (line) => {
  const toks = plainText(line).split(" ").filter(Boolean);
  if (toks.length < 2) return false;
  const singleAlpha = toks.filter((w) => w.length === 1 && /[A-Za-z0-9]/.test(w)).length;
  return singleAlpha >= 2 && singleAlpha >= toks.length * 0.7;
};
// Vertical text: a word spelled ONE letter per paragraph going down the page (ch118's
// "B / U / R / N / I / N / G …"). Signature: a whole paragraph that is a single alphanumeric
// character; tagged only in runs of 4+ so a stray one-letter line isn't swept up.
const isVertChar = (line) => /^[A-Za-z0-9]$/.test(plainText(line));

// Return the html with enhancement classes applied. `blocks` is enhancements.json[chapterNum]
// (an array of { type, from, to }) or undefined. Unresolved anchors are skipped silently here;
// validateChapter() is the channel that surfaces them (at build and gdoc-import time).
export function enhance(html, blocks = []) {
  const lines = html.split("\n");

  // 1. Listed blocks, anchored by first/last paragraph plain text. Anchors needn't be unique
  //    (e.g. "[Daydream Inc.]" also appears in prose) — we pick the SMALLEST valid `from`→`to`
  //    span, which reliably selects the tight intended block over an accidental wide match.
  //    Paragraphs already claimed by an earlier block are skipped, so a line that legitimately
  //    repeats (e.g. the same one-line voice cry twice) can be tagged once per listed entry:
  //    list the block N times to tag N occurrences, each taking the next unclaimed match.
  const claimed = new Set();
  for (const blk of blocks || []) {
    const froms = paraIdxsWithText(lines, blk.from);
    const tos = paraIdxsWithText(lines, blk.to);
    let best = null;
    for (const f of froms) {
      if (claimed.has(f)) continue;
      const t = tos.find((x) => x >= f && !claimed.has(x));
      if (t != null && (!best || t - f < best.end - best.start)) best = { start: f, end: t };
    }
    if (best) {
      tagRange(lines, best.start, best.end, blk.type);
      for (let i = best.start; i <= best.end; i++) claimed.add(i);
    }
  }

  // 2. Auto lore boxes: paragraphs bracketed by a PAIR of delimiter lines. The delimiter
  //    lines become the box's top/bottom edge (CSS hides the run of dashes/equals). Pairing
  //    consecutive delimiters (rather than a running toggle) means a lone, unpaired delimiter
  //    can't run styling off to the end of the chapter — it's simply ignored.
  const delims = lines.map((l, i) => (isP(l) && isDelimLine(l) ? i : -1)).filter((i) => i >= 0);
  for (let d = 0; d + 1 < delims.length; d += 2) {
    const open = delims[d];
    const close = delims[d + 1];
    lines[open] = addClass(lines[open], "lore lore-top");
    lines[close] = addClass(lines[close], "lore lore-bot");
    for (let i = open + 1; i < close; i++) {
      if (isP(lines[i])) lines[i] = addClass(lines[i], "lore");
    }
  }

  // 3. Auto system-message boxes: the book's pervasive "[ ... ]" screen/voice markup — a whole
  //    paragraph whose visible text is bracket-enclosed. (Bold/italic decoration is applied
  //    inconsistently across chapters, so the bracket envelope alone is the reliable signal.)
  //    A bracket line PLUS any following ":"-continuation lines (e.g. "[1st Place]" then
  //    ": Dark Exploration Record Merch Box") form ONE box via -top/-bot; a lone bracket line
  //    gets both and renders as a self-contained box. Consecutive bracket lines stay SEPARATE
  //    (each starts its own group). Italic header = the `announce` variant (subway-PA). Skip
  //    lines a listed block or lore box already claimed (e.g. an idcard's bracketed header).
  for (let i = 0; i < lines.length; i++) {
    if (!isP(lines[i]) || isTagged(lines[i])) continue;
    if (!/^\[.*\]$/.test(plainText(lines[i]))) continue;
    let end = i; // extend over consecutive ":"-prefixed continuation paragraphs
    for (let j = i + 1; j < lines.length && isP(lines[j]); j++) {
      if (!/^:/.test(plainText(lines[j]))) break;
      end = j;
    }
    const variant = /<em>/.test(lines[i]) ? " announce" : "";
    for (let k = i; k <= end; k++) {
      if (!isP(lines[k])) continue;
      lines[k] = addClass(lines[k], "sysmsg" + variant);
      if (k === i) lines[k] = addClass(lines[k], "sysmsg-top");
      if (k === end) lines[k] = addClass(lines[k], "sysmsg-bot");
    }
    i = end; // don't re-scan the continuation lines
  }

  // 4. Business cards: lines wrapped in box-drawing rules (━━━ … ━━━), paired like the lore
  //    boxes but styled as a card; the rule lines become the card's top/bottom edge.
  const cardRules = lines.map((l, i) => (isP(l) && isCardRule(l) ? i : -1)).filter((i) => i >= 0);
  for (let d = 0; d + 1 < cardRules.length; d += 2) {
    const open = cardRules[d];
    const close = cardRules[d + 1];
    lines[open] = addClass(lines[open], "card card-top");
    lines[close] = addClass(lines[close], "card card-bot");
    for (let i = open + 1; i < close; i++) if (isP(lines[i])) lines[i] = addClass(lines[i], "card");
  }

  // 5. Alien-shop "terminal" screens: a run of catalog / cart lines (₩ prices, ※banners※).
  tagRuns(lines, isShopLine, "terminal", 2);

  // 6. Choice / enumeration option lists ("1. … / 2. … / …").
  tagRuns(lines, isOptionLine, "options", 2);

  // 7. Control-panel gauges: a "MIN MAX" label followed by the lever bar + position marker.
  for (let i = 0; i < lines.length; i++) {
    if (!isP(lines[i]) || isTagged(lines[i]) || plainText(lines[i]) !== "MIN MAX") continue;
    let end = i;
    for (let j = i + 1; j < lines.length && isP(lines[j]) && isGaugeLine(lines[j]); j++) end = j;
    if (end > i) tagRange(lines, i, end, "panel");
  }

  // 8. Auto "voice": spaced-out mascot/system speech, one letter per token. Pervasive and
  //    repetitive across the mascot arcs (ch177 alone has ~70 lines), so detecting the shape
  //    beats hand-listing. minLen 1 — a lone spaced cry is still voice; consecutive lines group.
  tagRuns(lines, isVoiceLine, "voice", 1);

  // 9. Auto "verticaltext": a word spelled one letter per paragraph (≥4 consecutive single-char
  //    paragraphs). Tight, centered styling makes the letters read as a vertical column.
  tagRuns(lines, isVertChar, "verticaltext", 4);

  // 10. Hide the box-edge glyph lines that FRAME a styled box. A listed `scroll`/`lore` block is
  //    anchored by its CONTENT, so the source's `+++` / `===` framing glyphs (below the 5+
  //    auto-lore threshold, or using `+`) survive as visible noise. Hide such a glyph line ONLY
  //    when it sits directly next to a box-tagged paragraph — so a stray, unrelated delimiter
  //    elsewhere is left untouched rather than silently removed.
  const adjP = (i, step) => {
    for (let k = i + step; k >= 0 && k < lines.length; k += step) if (isP(lines[k])) return k;
    return -1;
  };
  for (let i = 0; i < lines.length; i++) {
    if (!isP(lines[i]) || isTagged(lines[i])) continue;
    if (!/^(?:\+{3,}|={3,})$/.test(plainText(lines[i]))) continue;
    const prev = adjP(i, -1);
    const next = adjP(i, 1);
    if ((prev >= 0 && isTagged(lines[prev])) || (next >= 0 && isTagged(lines[next]))) {
      lines[i] = addClass(lines[i], "boxedge");
    }
  }

  return lines.join("\n");
}

// Footnotes / TL notes. The source marks a reference inline as "[N]" and defines it at the
// chapter bottom in a paragraph starting "[N]: …". Neither is a real hyperlink in the gdoc (the
// editor just colours the "[N]" by hand), so we synthesise the jump links here at build time:
// each inline marker becomes an anchor to its definition, the definition gets the matching target
// id plus a ↩ back-link, and any bare URL in the definition (e.g. a "Source (https://…)") is made
// clickable. Like enhance(), this only rewrites inline content — every paragraph stays a direct
// `.cbody > p` child (the hard rule above), and the per-paragraph id stays on the <p> (the
// footnote ids ride on inner <a> elements), so paragraph ids / comments are untouched.
export function footnotes(html) {
  const lines = html.split("\n");

  // Definition paragraphs by footnote number: a <p> whose visible text starts "[N]:".
  const defLine = new Map();
  for (let i = 0; i < lines.length; i++) {
    if (!isP(lines[i])) continue;
    const m = plainText(lines[i]).match(/^\[(\d+)\]\s*:/);
    if (m && !defLine.has(m[1])) defLine.set(m[1], i);
  }
  if (!defLine.size) return html;

  for (const [num, di] of defLine) {
    // The inline marker: the first OTHER paragraph whose visible text contains "[N]". A
    // definition with no reference is left as plain text (no dangling links).
    let mi = -1;
    for (let i = 0; i < lines.length; i++) {
      if (i === di || !isP(lines[i])) continue;
      if (plainText(lines[i]).includes(`[${num}]`)) {
        mi = i;
        break;
      }
    }
    if (mi < 0) continue;

    // Marker -> link to the definition; drop the gdoc colour <span> wrapping it if present.
    const marker = new RegExp(`(?:<span\\b[^>]*>)?\\[${num}\\](?:</span>)?`);
    lines[mi] = lines[mi].replace(
      marker,
      `<a class="fnref" id="fnref-${num}" href="#fn-${num}">[${num}]</a>`,
    );

    // Definition: leading "[N]" -> jump target; linkify a bare URL; append a ↩ back-link.
    lines[di] = lines[di]
      .replace(`[${num}]`, `<a class="fn-num" id="fn-${num}" href="#fnref-${num}">[${num}]</a>`)
      .replace(
        /(https?:\/\/[^\s<"]+)/,
        `<a class="fn-src" href="$1" target="_blank" rel="noopener noreferrer">$1</a>`,
      )
      .replace(
        /<\/p>\s*$/,
        ` <a class="fn-back" href="#fnref-${num}" aria-label="Back to text">↩</a></p>`,
      );
  }

  return lines.join("\n");
}

// Check that every listed block's anchors still resolve to exactly one paragraph, in order.
// Returns an array of human-readable problem strings (empty = all good). Called by the build
// (warns, doesn't fail) and by the gdoc importer (so wording drift is caught at import time).
export function validateChapter(html, blocks = []) {
  const lines = html.split("\n");
  const errs = [];
  for (const blk of blocks || []) {
    const froms = paraIdxsWithText(lines, blk.from);
    const tos = paraIdxsWithText(lines, blk.to);
    // Non-unique anchors are fine (enhance() picks the smallest valid span); only an anchor
    // that no longer matches ANY paragraph — or a `to` that never follows a `from` — is breakage.
    if (froms.length === 0) errs.push(`${blk.type}: 'from' anchor not found: "${blk.from}"`);
    if (tos.length === 0) errs.push(`${blk.type}: 'to' anchor not found: "${blk.to}"`);
    else if (froms.length && !froms.some((f) => tos.some((t) => t >= f))) {
      errs.push(`${blk.type}: 'to' anchor "${blk.to}" never appears at/after 'from' "${blk.from}"`);
    }
  }
  return errs;
}
