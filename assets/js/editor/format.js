// Contenteditable formatting commands + the normaliser that turns the editor DOM into the
// site's canonical HTML (one <p>/<hr class="sb"> per line, <strong>/<em>, source entities).
import { state } from "./state.js";
import { updateStatus } from "./ui.js";
import { cleanInline, dominantFamily } from "./gdocs.js";

function restoreRange() {
  if (state.lastEditorRange) {
    const sel = window.getSelection();
    sel.removeAllRanges();
    sel.addRange(state.lastEditorRange);
  }
}

export function runCommand(cmd) {
  state.editor.focus();
  restoreRange();
  switch (cmd) {
    case "bold":
      document.execCommand("bold");
      break;
    case "italic":
      document.execCommand("italic");
      break;
    case "clearColor":
      document.execCommand("removeFormat");
      break;
    case "left":
      setBlockAlign(null);
      break;
    case "center":
      setBlockAlign("center");
      break;
    case "right":
      setBlockAlign("right");
      break;
    case "sceneBreak":
      insertSceneBreak();
      break;
  }
  markChanged();
  updateToolbarState();
}

export function applyColor(hex) {
  state.editor.focus();
  restoreRange();
  try {
    document.execCommand("styleWithCSS", false, true);
  } catch (e) {}
  document.execCommand("foreColor", false, hex);
  try {
    document.execCommand("styleWithCSS", false, false);
  } catch (e) {}
  markChanged();
}

export function applyFontSize(size) {
  state.editor.focus();
  restoreRange();
  const sel = window.getSelection();
  if (!sel.rangeCount || sel.isCollapsed) return;
  const range = sel.getRangeAt(0);
  const span = document.createElement("span");
  span.style.fontSize = size;
  try {
    span.appendChild(range.extractContents());
    range.insertNode(span);
    sel.removeAllRanges();
    const r = document.createRange();
    r.selectNodeContents(span);
    sel.addRange(r);
  } catch (e) {
    /* selection crossed elements; ignore */
  }
  markChanged();
}

// Set/remove alignment class on the paragraph(s) in the selection
function setBlockAlign(align) {
  const sel = window.getSelection();
  if (!sel.rangeCount) return;
  let node = sel.getRangeAt(0).startContainer;
  // Walk up to the block-level <p> (or other top-level child of #editor)
  while (node && node !== state.editor) {
    if (node.nodeType === 1 && node.parentNode === state.editor) break;
    node = node.parentNode;
  }
  if (!node || node === state.editor) return;
  node.classList.remove("center", "right");
  if (align) node.classList.add(align);
}

function insertSceneBreak() {
  const hr = document.createElement("hr");
  hr.className = "sb";
  const sel = window.getSelection();
  if (sel.rangeCount) {
    const range = sel.getRangeAt(0);
    range.collapse(false);
    range.insertNode(hr);
    // move cursor after the hr
    range.setStartAfter(hr);
    range.collapse(true);
    sel.removeAllRanges();
    sel.addRange(range);
  } else {
    state.editor.appendChild(hr);
  }
}

export function updateToolbarState() {
  try {
    setActive("bold", document.queryCommandState("bold"));
    setActive("italic", document.queryCommandState("italic"));
  } catch (e) {}
}
function setActive(cmd, on) {
  const btn = document.querySelector(`.toolbar button[data-cmd="${cmd}"]`);
  if (btn) btn.classList.toggle("active", !!on);
}

function markChanged() {
  if (!state.isLoadingChapter) {
    state.unsavedChanges = true;
    updateStatus();
  }
}

// Re-encode typographic characters back to the entities the source uses
function reencodeEntities(html) {
  // Named entities the source uses — keep these so those lines stay byte-identical to git
  const NAMED = {
    0x0022: "quot",
    0x0027: "#39",
    0x00a0: "nbsp",
    0x00b7: "middot",
    0x00e0: "agrave",
    0x00e8: "egrave",
    0x00e9: "eacute",
    0x2013: "ndash",
    0x2014: "mdash",
    0x2018: "lsquo",
    0x2019: "rsquo",
    0x201c: "ldquo",
    0x201d: "rdquo",
    0x2022: "bull",
    0x2026: "hellip",
    0x2190: "larr",
    0x2191: "uarr",
    0x2192: "rarr",
    0x2193: "darr",
  };
  const parts = html.split(/(<[^>]*>)/);
  return parts
    .map((part, i) => {
      if (i % 2 === 1) return part; // inside a tag — leave attributes alone
      let out = "";
      for (const ch of part) {
        // iterates by code point (handles emoji)
        const cp = ch.codePointAt(0);
        if (NAMED[cp]) out += "&" + NAMED[cp] + ";";
        else if (cp > 127)
          out += "&#" + cp + ";"; // catch-all: any other non-ASCII
        else out += ch;
      }
      return out;
    })
    .join("");
}

// Turn the contenteditable DOM into the site's canonical HTML:
// one <p> (or <hr class="sb">) per line, <strong>/<em> tags, source entities.
export function normalizeOutput(rawHtml) {
  const temp = document.createElement("div");
  temp.innerHTML = rawHtml
    .replace(/<b>/g, "<strong>")
    .replace(/<\/b>/g, "</strong>")
    .replace(/<i>/g, "<em>")
    .replace(/<\/i>/g, "</em>");

  // Chapters never use <br>; strip the ones contenteditable injects
  temp.querySelectorAll("br").forEach((br) => br.remove());

  // Trim only ASCII whitespace — NEVER nbsp ( ), which is meaningful
  // content here (413 source paragraphs are <p>&nbsp;</p> spacers, 1313 lead with it).
  const asciiTrim = (s) => s.replace(/^[ \t\r\n]+/, "").replace(/[ \t\r\n]+$/, "");
  // "Empty" = no content once ASCII whitespace is removed; nbsp counts as content.
  const isEmpty = (s) => s.replace(/[ \t\r\n]+/g, "").length === 0;

  // Body font over the WHOLE fragment so a deliberate display font is kept while the document
  // body font is dropped — computed once, not per block (a block that is entirely one display
  // font would otherwise look like its own "body" font and be stripped).
  const bodyFont = dominantFamily(temp.innerHTML);

  const out = [];
  for (const node of temp.childNodes) {
    if (node.nodeType === Node.ELEMENT_NODE) {
      if (node.tagName === "HR") {
        out.push('<hr class="sb">');
        continue;
      }
      if (isEmpty(node.textContent)) continue; // drop only truly-empty blocks
      // cleanInline strips pasted Google Docs noise (the body font, 12pt sizes, #000000,
      // docs-internal-guid <b> wrappers) down to the same canonical inline markup the importer
      // produces, while keeping real color/em-size/bold/italic/underline/display-font emphasis.
      const inner = asciiTrim(cleanInline(node.innerHTML, bodyFont));
      // Alignment lives in a class for editor-made paragraphs; a paste may carry it as an
      // inline text-align style instead, so fall back to that.
      const ta = (node.style && node.style.textAlign) || "";
      let cls = "";
      if (node.classList.contains("center") || ta === "center") cls = ' class="center"';
      else if (node.classList.contains("right") || ta === "right") cls = ' class="right"';
      out.push(`<p${cls}>${inner}</p>`);
    } else if (node.nodeType === Node.TEXT_NODE) {
      if (!isEmpty(node.textContent)) out.push(`<p>${asciiTrim(node.textContent)}</p>`);
    }
  }
  return reencodeEntities(out.join("\n"));
}
