// SPDX-License-Identifier: AGPL-3.0-or-later
// Copyright (C) 2026 大松雄斗

import { useEffect, useMemo, useRef, useState } from "react";
import { getCurrentWindow } from "@tauri-apps/api/window";
import { t, setLocaleDict, useLocaleVersion } from "./i18n";
import { ja } from "./locales/ja";
import changelogText from "../CHANGELOG.md?raw";
import {
  buildHtml,
  createNode,
  deleteClassFile,
  deleteNode,
  importModuleFile,
  pickModuleFile,
  readModules,
  writeModuleFile,
  initProject,
  exportHtml,
  importHtml,
  openInBrowser,
  pickBrowserExecutable,
  pickHtmlFile,
  pickHtmlSaveTarget,
  pickProjectFolder,
  pickSaveTarget,
  pollSelection,
  previewUrl,
  readClassFiles,
  readImageFolders,
  readPluginScript,
  readPlugins,
  writeTextFile,
  readNode,
  readProjectConfig,
  readTree,
  renameNode,
  restoreSubtree,
  snapshotSubtree,
  writeClassFile,
  writeNode,
  writeProjectConfig,
} from "./api";
import { runExporter } from "./pluginRunner";
import {
  FlatRow,
  ParsedNode,
  basenameOf,
  findSubtreeRange,
  getVisibleRows,
  lineNumPad,
  nnOf,
  rowMetaFromConfig,
  rowsToParsedTree,
} from "./treeModel";
import { highlight } from "./syntax";
import {
  ClassFile,
  ExporterDef,
  ImageFolder,
  LoadedPlugin,
  ModuleDef,
  ModuleFile,
  SnippetEntry,
  emptyConfig,
  HeadConfig,
  NodeConfig,
  NodeSnapshot,
  ProjectConfig,
  TreeNode,
  UndoAction,
} from "./types";

type TabKey = "css" | "js" | "classes";

const LAST_PROJECT_KEY = "foling.lastProject";
const BROWSER_KEY = "foling.previewBrowser";
const PLUGIN_CONSENT_KEY = "foling.pluginConsent";
const LOCALE_KEY = "foling.locale";
const EDITOR_THEME_KEY = "foling.editorTheme";
type EditorTheme = "dark" | "light" | "monokai";
const DEFAULT_DOCTYPE = "<!DOCTYPE html>";
// Keep in sync with package.json / tauri.conf.json on release.
const APP_VERSION = "0.10.0";
// Set to the public repository URL once published (shown in the About dialog).
const REPO_URL = "";

// Apply the saved UI language as early as possible so the first render is
// already localized. English is the default (no pack).
if (localStorage.getItem(LOCALE_KEY) === "ja") {
  setLocaleDict(ja);
}
// Apply the saved editor theme to <html data-editor-theme> on first paint.
const _savedEditorTheme = localStorage.getItem(EDITOR_THEME_KEY);
if (_savedEditorTheme) {
  document.documentElement.setAttribute("data-editor-theme", _savedEditorTheme);
}

// Common CSS properties for autocomplete (alphabetical, not exhaustive).
const CSS_PROPERTIES = [
  "align-content", "align-items", "align-self",
  "animation", "animation-delay", "animation-direction", "animation-duration",
  "animation-fill-mode", "animation-iteration-count", "animation-name",
  "animation-play-state", "animation-timing-function",
  "background", "background-attachment", "background-clip", "background-color",
  "background-image", "background-origin", "background-position",
  "background-repeat", "background-size",
  "border", "border-bottom", "border-bottom-color", "border-bottom-left-radius",
  "border-bottom-right-radius", "border-bottom-style", "border-bottom-width",
  "border-collapse", "border-color", "border-image", "border-left",
  "border-left-color", "border-left-style", "border-left-width", "border-radius",
  "border-right", "border-right-color", "border-right-style", "border-right-width",
  "border-spacing", "border-style", "border-top", "border-top-color",
  "border-top-left-radius", "border-top-right-radius", "border-top-style",
  "border-top-width", "border-width",
  "bottom", "box-shadow", "box-sizing",
  "clear", "clip-path", "color", "column-gap", "content", "cursor",
  "direction", "display",
  "fill", "filter",
  "flex", "flex-basis", "flex-direction", "flex-flow", "flex-grow", "flex-shrink", "flex-wrap",
  "float",
  "font", "font-family", "font-size", "font-stretch", "font-style", "font-variant", "font-weight",
  "gap", "grid", "grid-area", "grid-auto-columns", "grid-auto-flow", "grid-auto-rows",
  "grid-column", "grid-column-end", "grid-column-gap", "grid-column-start",
  "grid-gap", "grid-row", "grid-row-end", "grid-row-gap", "grid-row-start",
  "grid-template", "grid-template-areas", "grid-template-columns", "grid-template-rows",
  "height",
  "justify-content", "justify-items", "justify-self",
  "left", "letter-spacing", "line-height",
  "list-style", "list-style-image", "list-style-position", "list-style-type",
  "margin", "margin-bottom", "margin-left", "margin-right", "margin-top",
  "max-height", "max-width", "min-height", "min-width",
  "opacity", "order", "outline", "outline-color", "outline-offset", "outline-style",
  "outline-width", "overflow", "overflow-wrap", "overflow-x", "overflow-y",
  "padding", "padding-bottom", "padding-left", "padding-right", "padding-top",
  "place-content", "place-items", "place-self", "pointer-events", "position",
  "resize", "right", "row-gap",
  "scroll-behavior",
  "stroke",
  "tab-size", "table-layout",
  "text-align", "text-decoration", "text-indent", "text-overflow", "text-shadow", "text-transform",
  "top", "transform", "transform-origin", "transition", "transition-delay",
  "transition-duration", "transition-property", "transition-timing-function",
  "user-select",
  "vertical-align", "visibility",
  "white-space", "width", "will-change", "word-break", "word-spacing", "word-wrap",
  "writing-mode",
  "z-index",
];

// Per-property value suggestions. Only common enums — colors / lengths are too open-ended.
const VALUE_SUGGESTIONS: Record<string, string[]> = {
  display: ["flex", "grid", "block", "inline", "inline-block", "inline-flex", "inline-grid", "none", "contents", "table", "table-cell", "table-row", "list-item"],
  position: ["relative", "absolute", "fixed", "sticky", "static"],
  "flex-direction": ["row", "row-reverse", "column", "column-reverse"],
  "flex-wrap": ["nowrap", "wrap", "wrap-reverse"],
  "justify-content": ["flex-start", "flex-end", "center", "space-between", "space-around", "space-evenly", "start", "end"],
  "align-items": ["flex-start", "flex-end", "center", "baseline", "stretch", "start", "end"],
  "align-content": ["flex-start", "flex-end", "center", "space-between", "space-around", "stretch"],
  "align-self": ["auto", "flex-start", "flex-end", "center", "baseline", "stretch"],
  "text-align": ["left", "right", "center", "justify", "start", "end"],
  "text-transform": ["none", "uppercase", "lowercase", "capitalize"],
  "text-decoration": ["none", "underline", "overline", "line-through"],
  "font-weight": ["normal", "bold", "bolder", "lighter", "100", "200", "300", "400", "500", "600", "700", "800", "900"],
  "font-style": ["normal", "italic", "oblique"],
  "white-space": ["normal", "nowrap", "pre", "pre-wrap", "pre-line", "break-spaces"],
  "word-break": ["normal", "break-all", "keep-all", "break-word"],
  cursor: ["pointer", "default", "text", "wait", "move", "not-allowed", "grab", "grabbing", "crosshair", "help", "progress"],
  overflow: ["visible", "hidden", "scroll", "auto", "clip"],
  "overflow-x": ["visible", "hidden", "scroll", "auto", "clip"],
  "overflow-y": ["visible", "hidden", "scroll", "auto", "clip"],
  "box-sizing": ["content-box", "border-box"],
  visibility: ["visible", "hidden", "collapse"],
  float: ["none", "left", "right"],
  clear: ["none", "left", "right", "both"],
  "user-select": ["auto", "none", "text", "all"],
  "pointer-events": ["auto", "none"],
  resize: ["none", "both", "horizontal", "vertical"],
  "writing-mode": ["horizontal-tb", "vertical-rl", "vertical-lr"],
  direction: ["ltr", "rtl"],
};

// CSS named colors (full spec list).
const COLOR_NAMES = [
  "aliceblue", "antiquewhite", "aqua", "aquamarine", "azure",
  "beige", "bisque", "black", "blanchedalmond", "blue", "blueviolet", "brown", "burlywood",
  "cadetblue", "chartreuse", "chocolate", "coral", "cornflowerblue", "cornsilk", "crimson", "cyan",
  "darkblue", "darkcyan", "darkgoldenrod", "darkgray", "darkgreen", "darkgrey", "darkkhaki",
  "darkmagenta", "darkolivegreen", "darkorange", "darkorchid", "darkred", "darksalmon", "darkseagreen",
  "darkslateblue", "darkslategray", "darkslategrey", "darkturquoise", "darkviolet", "deeppink", "deepskyblue",
  "dimgray", "dimgrey", "dodgerblue",
  "firebrick", "floralwhite", "forestgreen", "fuchsia",
  "gainsboro", "ghostwhite", "gold", "goldenrod", "gray", "green", "greenyellow", "grey",
  "honeydew", "hotpink",
  "indianred", "indigo", "ivory",
  "khaki",
  "lavender", "lavenderblush", "lawngreen", "lemonchiffon",
  "lightblue", "lightcoral", "lightcyan", "lightgoldenrodyellow", "lightgray", "lightgreen", "lightgrey",
  "lightpink", "lightsalmon", "lightseagreen", "lightskyblue", "lightslategray", "lightslategrey",
  "lightsteelblue", "lightyellow", "lime", "limegreen", "linen",
  "magenta", "maroon", "mediumaquamarine", "mediumblue", "mediumorchid", "mediumpurple", "mediumseagreen",
  "mediumslateblue", "mediumspringgreen", "mediumturquoise", "mediumvioletred", "midnightblue", "mintcream",
  "mistyrose", "moccasin",
  "navajowhite", "navy",
  "oldlace", "olive", "olivedrab", "orange", "orangered", "orchid",
  "palegoldenrod", "palegreen", "paleturquoise", "palevioletred", "papayawhip", "peachpuff", "peru",
  "pink", "plum", "powderblue", "purple",
  "rebeccapurple", "red", "rosybrown", "royalblue",
  "saddlebrown", "salmon", "sandybrown", "seagreen", "seashell", "sienna", "silver", "skyblue",
  "slateblue", "slategray", "slategrey", "snow", "springgreen", "steelblue",
  "tan", "teal", "thistle", "tomato", "turquoise",
  "violet",
  "wheat", "white", "whitesmoke",
  "yellow", "yellowgreen",
  "transparent", "currentColor", "inherit", "initial", "unset", "revert",
];

const COLOR_PROPERTIES = new Set([
  "color", "background", "background-color",
  "border-color", "border-top-color", "border-right-color", "border-bottom-color", "border-left-color",
  "outline-color", "text-decoration-color", "caret-color",
  "fill", "stroke",
]);

function getValueSuggestionsForProp(prop: string): string[] {
  const direct = VALUE_SUGGESTIONS[prop] ?? [];
  if (COLOR_PROPERTIES.has(prop)) {
    return [...direct, ...COLOR_NAMES];
  }
  return direct;
}

// VSCode-like fuzzy match scoring.
// Higher score = better match. Returns 0 for no match.
function fuzzyScore(query: string, candidate: string): number {
  const q = query.toLowerCase();
  const c = candidate.toLowerCase();
  if (!q) return 1; // empty query matches everything weakly
  if (c === q) return 100000;
  if (c.startsWith(q)) return 50000 - (c.length - q.length);
  if (c.includes(q)) return 20000 - (c.length - q.length);
  // Subsequence (fzf-style): query chars appear in order in candidate
  const subScore = subsequenceScore(q, c);
  if (subScore > 0) return 10000 + subScore - c.length;
  // Typo tolerance via Damerau-Levenshtein (handles transposed letters)
  const ed = damerauLevenshtein(q, c);
  const maxAllowed = Math.max(2, Math.floor(q.length / 2));
  if (ed <= maxAllowed) return 5000 - ed * 200 - c.length;
  return 0;
}

function subsequenceScore(q: string, c: string): number {
  let qi = 0;
  let score = 0;
  let lastIdx = -1;
  for (let ci = 0; ci < c.length && qi < q.length; ci++) {
    if (c[ci] === q[qi]) {
      // Adjacent characters score higher
      if (lastIdx === ci - 1) score += 12;
      else score += 5;
      lastIdx = ci;
      qi++;
    }
  }
  return qi === q.length ? score : 0;
}

// Damerau-Levenshtein with adjacent transposition.
function damerauLevenshtein(a: string, b: string): number {
  const m = a.length;
  const n = b.length;
  if (m === 0) return n;
  if (n === 0) return m;
  const d: number[][] = Array.from({ length: m + 1 }, () =>
    new Array(n + 1).fill(0)
  );
  for (let i = 0; i <= m; i++) d[i][0] = i;
  for (let j = 0; j <= n; j++) d[0][j] = j;
  for (let i = 1; i <= m; i++) {
    for (let j = 1; j <= n; j++) {
      const cost = a[i - 1] === b[j - 1] ? 0 : 1;
      d[i][j] = Math.min(
        d[i - 1][j] + 1,
        d[i][j - 1] + 1,
        d[i - 1][j - 1] + cost
      );
      if (i > 1 && j > 1 && a[i - 1] === b[j - 2] && a[i - 2] === b[j - 1]) {
        d[i][j] = Math.min(d[i][j], d[i - 2][j - 2] + cost);
      }
    }
  }
  return d[m][n];
}

// CSS properties that propagate to descendants by default.
// Used for the "Inherited" panel above the CSS editor.
const INHERITABLE_PROPS = new Set([
  "color",
  "font",
  "font-family",
  "font-size",
  "font-style",
  "font-variant",
  "font-weight",
  "font-stretch",
  "line-height",
  "letter-spacing",
  "word-spacing",
  "text-align",
  "text-indent",
  "text-transform",
  "text-rendering",
  "white-space",
  "word-break",
  "word-wrap",
  "overflow-wrap",
  "writing-mode",
  "direction",
  "visibility",
  "cursor",
  "list-style",
  "list-style-type",
  "list-style-image",
  "list-style-position",
  "border-collapse",
  "border-spacing",
  "caption-side",
  "empty-cells",
  "quotes",
  "tab-size",
  "hyphens",
]);

interface CssDecl {
  prop: string;
  value: string;
}

// Split raw CSS text into individual declarations on ';', then "prop: value".
// We scan char-by-char so that ';' inside parens (e.g. url("data:...;base64"))
// or quotes, ',' inside rgba(), and comments don't break a declaration apart.
// This also lets several declarations share one physical line
// (e.g. `width: 100%; max-width: 960px;`) and still resolve to separate props.
function parseCssDeclarations(css: string | undefined | null): CssDecl[] {
  if (!css) return [];
  const chunks: string[] = [];
  let buf = "";
  let depth = 0; // () / [] nesting
  let quote: string | null = null;
  for (let i = 0; i < css.length; i++) {
    const c = css[i];
    const n = css[i + 1];
    if (quote) {
      buf += c;
      if (c === "\\") {
        buf += n ?? "";
        i++;
      } else if (c === quote) {
        quote = null;
      }
      continue;
    }
    if (c === "/" && n === "*") {
      // Block comment — skip to the closing */ (may span lines).
      i += 2;
      while (i < css.length && !(css[i] === "*" && css[i + 1] === "/")) i++;
      i++;
      continue;
    }
    if (c === "/" && n === "/" && depth === 0) {
      // Line comment — skip to EOL. Restricted to depth 0 so the // in
      // url(http://…) is preserved.
      while (i < css.length && css[i] !== "\n") i++;
      continue;
    }
    if (c === '"' || c === "'") {
      quote = c;
      buf += c;
    } else if (c === "(" || c === "[") {
      depth++;
      buf += c;
    } else if (c === ")" || c === "]") {
      if (depth > 0) depth--;
      buf += c;
    } else if (c === ";" && depth === 0) {
      chunks.push(buf);
      buf = "";
    } else {
      buf += c;
    }
  }
  chunks.push(buf);

  const out: CssDecl[] = [];
  for (const chunk of chunks) {
    const line = chunk.trim();
    if (!line) continue;
    const ci = line.indexOf(":");
    if (ci <= 0) continue;
    const prop = line.slice(0, ci).trim().toLowerCase();
    const value = line.slice(ci + 1).trim();
    if (!prop || !value) continue;
    out.push({ prop, value });
  }
  return out;
}

interface InheritedDecl {
  source: TreeNode;
  prop: string;
  value: string;
}

// Walk from immediate parent up to the root and collect inheritable
// declarations. The closest ancestor wins for each property (CSS rules).
function gatherInherited(
  tree: TreeNode | null,
  selectedPath: string | null
): InheritedDecl[] {
  if (!tree || !selectedPath) return [];
  const path = findPath(tree, selectedPath);
  if (!path || path.length < 2) return [];
  const result: InheritedDecl[] = [];
  const seen = new Set<string>();
  for (let i = path.length - 2; i >= 0; i--) {
    const node = path[i];
    const decls = parseCssDeclarations(node.config?.css);
    for (const { prop, value } of decls) {
      if (INHERITABLE_PROPS.has(prop) && !seen.has(prop)) {
        seen.add(prop);
        result.push({ source: node, prop, value });
      }
    }
  }
  return result;
}

// Common HTML elements — used to autocomplete tag names in the tree editor.
const HTML_TAGS = [
  "a", "abbr", "address", "area", "article", "aside", "audio",
  "b", "base", "blockquote", "body", "br", "button",
  "canvas", "caption", "cite", "code", "col", "colgroup",
  "data", "datalist", "dd", "del", "details", "dfn", "dialog", "div", "dl", "dt",
  "em", "embed",
  "fieldset", "figcaption", "figure", "footer", "form",
  "h1", "h2", "h3", "h4", "h5", "h6", "head", "header", "hgroup", "hr", "html",
  "i", "iframe", "img", "input", "ins",
  "kbd",
  "label", "legend", "li", "link",
  "main", "map", "mark", "menu", "meta", "meter",
  "nav", "noscript",
  "object", "ol", "optgroup", "option", "output",
  "p", "picture", "pre", "progress",
  "q",
  "ruby",
  "s", "samp", "script", "section", "select", "slot", "small", "source",
  "span", "strong", "style", "sub", "summary", "sup", "svg",
  "table", "tbody", "td", "template", "textarea", "tfoot", "th", "thead",
  "time", "title", "tr", "track",
  "u", "ul",
  "var", "video",
  "wbr",
];

const HTML_TAG_SET = new Set(HTML_TAGS);

// A tag is "known" if it's a standard HTML element or a valid custom element
// (per spec, custom elements must contain a hyphen). Anything else is a typo /
// invalid name — the build falls back to <div>, and the tree flags it so the
// user notices. Empty / in-progress names are not treated as unknown.
function isKnownTag(name: string): boolean {
  const t = name.trim().toLowerCase();
  if (!t) return true;
  if (t.includes("-")) return true;
  return HTML_TAG_SET.has(t);
}

// ---------- Row-based tree editor ----------

let _nextRowId = 0;
function newRowId(prefix = "row"): string {
  _nextRowId++;
  return `${prefix}-${_nextRowId}-${Math.random().toString(36).slice(2, 6)}`;
}

// Build a synthetic tree whose only child is the requested top-level
// container (body or head). Used to scope the DOM tree UI to just that
// container — `<html>` and the *other* container stay invisible but on disk.
function getViewRoot(
  tree: TreeNode | null,
  view: "body" | "head"
): TreeNode | null {
  if (!tree) return null;
  const target = tree.children.find((c) => c.display_name === view);
  if (!target) return null;
  return { ...tree, children: [target] };
}

// Find the parent of the node whose path equals `target` inside `root`.
// Returns null if `target` is not in the tree or is the root itself.
function parentNode(root: TreeNode, target: string): TreeNode | null {
  for (const c of root.children) {
    if (c.path === target) return root;
    const inner = parentNode(c, target);
    if (inner) return inner;
  }
  return null;
}

// Find the node whose path equals `target`, including the root itself.
function findNodeByPath(root: TreeNode, target: string): TreeNode | null {
  if (root.path === target) return root;
  for (const c of root.children) {
    const found = findNodeByPath(c, target);
    if (found) return found;
  }
  return null;
}

// Collect every class name referenced anywhere in a snapshot subtree,
// normalized to ".name" — so a module can bundle those definitions.
function collectSnapshotClasses(snap: NodeSnapshot, out: Set<string>): void {
  for (const cn of snap.config.classes ?? []) {
    out.add(cn.startsWith(".") ? cn : "." + cn);
  }
  for (const child of snap.children) collectSnapshotClasses(child, out);
}

// Flatten the actual disk tree into a row list. Preserves collapse state
// keyed by actualPath when oldRows are passed (so re-syncs after apply
// don't blow away which subtrees the user had folded).
//
// `pathToId` lets a freshly-applied node inherit the editing row's id even
// though its on-disk path is brand new — so the caller can re-select the row
// it was editing right after `applyRows`.
function syncRowsFromTree(
  tree: TreeNode | null,
  oldRows: FlatRow[] = [],
  pathToId?: Map<string, string>
): FlatRow[] {
  if (!tree) return [];
  const oldByPath = new Map<string, FlatRow>();
  for (const r of oldRows) {
    if (r.actualPath) oldByPath.set(r.actualPath, r);
  }
  const out: FlatRow[] = [];
  function walk(n: TreeNode, depth: number) {
    const old = oldByPath.get(n.path);
    const meta = rowMetaFromConfig(n.display_name || n.name, n.config ?? {});
    out.push({
      id: pathToId?.get(n.path) ?? old?.id ?? n.path,
      depth,
      name: n.display_name || n.name,
      actualPath: n.path,
      collapsed: old?.collapsed ?? false,
      content: meta.content,
      imageLabel: meta.imageLabel,
      badges: meta.badges,
    });
    for (const c of n.children) walk(c, depth + 1);
  }
  for (const c of tree.children) walk(c, 0);
  return out;
}

// Find the previous sibling row (same depth, no ancestor crossed)
function findPrevSiblingIndex(rows: FlatRow[], i: number): number {
  const d = rows[i].depth;
  for (let j = i - 1; j >= 0; j--) {
    if (rows[j].depth < d) return -1;
    if (rows[j].depth === d) return j;
  }
  return -1;
}

function findNextSiblingIndex(rows: FlatRow[], i: number): number {
  const [, end] = findSubtreeRange(rows, i);
  const d = rows[i].depth;
  for (let j = end; j < rows.length; j++) {
    if (rows[j].depth < d) return -1;
    if (rows[j].depth === d) return j;
  }
  return -1;
}

// Alt+Up — swap the row (with subtree) and its previous sibling (with subtree)
function moveRowUp(rows: FlatRow[], idx: number): FlatRow[] | null {
  const ps = findPrevSiblingIndex(rows, idx);
  if (ps < 0) return null;
  const [s, e] = findSubtreeRange(rows, idx);
  const [pStart, pEnd] = findSubtreeRange(rows, ps);
  return [
    ...rows.slice(0, pStart),
    ...rows.slice(s, e),
    ...rows.slice(pStart, pEnd),
    ...rows.slice(e),
  ];
}

function moveRowDown(rows: FlatRow[], idx: number): FlatRow[] | null {
  const ns = findNextSiblingIndex(rows, idx);
  if (ns < 0) return null;
  const [s, e] = findSubtreeRange(rows, idx);
  const [nStart, nEnd] = findSubtreeRange(rows, ns);
  return [
    ...rows.slice(0, s),
    ...rows.slice(nStart, nEnd),
    ...rows.slice(s, e),
    ...rows.slice(nEnd),
  ];
}

// Alt+Left — outdent the row + its descendants by 1 (if depth > 0)
function outdentRowInList(rows: FlatRow[], idx: number): FlatRow[] | null {
  if (rows[idx].depth <= 0) return null;
  const [s, e] = findSubtreeRange(rows, idx);
  return rows.map((r, i) =>
    i >= s && i < e ? { ...r, depth: r.depth - 1 } : r
  );
}

// Alt+Right — indent the row + its descendants by 1 (only if a previous
// sibling exists, so the indented row becomes its child)
function indentRowInList(rows: FlatRow[], idx: number): FlatRow[] | null {
  if (findPrevSiblingIndex(rows, idx) < 0) return null;
  const [s, e] = findSubtreeRange(rows, idx);
  return rows.map((r, i) =>
    i >= s && i < e ? { ...r, depth: r.depth + 1 } : r
  );
}

// ---------- BASIN (final cascade) computation ----------

interface BasinDecl {
  prop: string;
  value: string;
  /** "stacked" is used for z-index, which accumulates additively through
   *  ancestors (Foling-specific behavior, not standard CSS). */
  layer: "inherited" | "class" | "own" | "stacked";
  sourceLabel: string;
  sourcePath?: string;
  classFile?: string;
  /** Other layers that also defined this property but were overridden by
   *  `layer`. When non-empty, the BASIN row is displayed as "MIX" so the
   *  developer notices that removing the winner reveals a fallback. */
  shadows?: Array<{
    layer: "inherited" | "class" | "own";
    value: string;
    sourceLabel: string;
  }>;
}

// Extract the local z-index for an element, looking at its own CSS first,
// then its applied classes. Returns null if no z-index is defined here.
function getLocalZIndex(
  config: NodeConfig,
  classDefs: ClassDef[]
): number | null {
  const ownDecls = parseCssDeclarations(config.css);
  for (const d of ownDecls) {
    if (d.prop === "z-index") {
      const n = parseInt(d.value, 10);
      if (!Number.isNaN(n)) return n;
    }
  }
  for (const cn of config.classes ?? []) {
    const dot = cn.startsWith(".") ? cn : "." + cn;
    for (const def of classDefs.filter((d) => d.name === dot)) {
      for (const d of parseCssDeclarations(def.properties)) {
        if (d.prop === "z-index") {
          const n = parseInt(d.value, 10);
          if (!Number.isNaN(n)) return n;
        }
      }
    }
  }
  return null;
}

function substituteVarsInString(
  s: string,
  vars: Record<string, string>
): string {
  return s.replace(/\$([a-zA-Z_][a-zA-Z0-9_-]*)/g, (_m, name) => {
    return vars[name] !== undefined ? vars[name] : `$${name}`;
  });
}

// Four-sided shorthand groups (padding, margin).
const FOUR_SIDED_GROUPS: Record<
  string,
  readonly [string, string, string, string]
> = {
  padding: [
    "padding-top",
    "padding-right",
    "padding-bottom",
    "padding-left",
  ],
  margin: ["margin-top", "margin-right", "margin-bottom", "margin-left"],
};

// CSS shorthand: 1 / 2 / 3 / 4 values → top, right, bottom, left.
function parseFourSidedShorthand(
  value: string
): [string, string, string, string] {
  const parts = value.trim().split(/\s+/);
  switch (parts.length) {
    case 0:
      return ["0", "0", "0", "0"];
    case 1:
      return [parts[0], parts[0], parts[0], parts[0]];
    case 2:
      return [parts[0], parts[1], parts[0], parts[1]];
    case 3:
      return [parts[0], parts[1], parts[2], parts[1]];
    default:
      return [parts[0], parts[1], parts[2], parts[3]];
  }
}

function combineFourSides(
  t: string,
  r: string,
  b: string,
  l: string
): string {
  if (t === r && r === b && b === l) return t;
  if (t === b && r === l) return `${t} ${r}`;
  if (r === l) return `${t} ${r} ${b}`;
  return `${t} ${r} ${b} ${l}`;
}

// Logical property order — positioning → box model → visuals → typography → effects.
const PROPERTY_ORDER = [
  // Position
  "position", "top", "right", "bottom", "left", "z-index",
  // Display / box
  "display", "visibility", "float", "clear", "box-sizing",
  // Flex
  "flex", "flex-direction", "flex-wrap", "flex-grow", "flex-shrink", "flex-basis",
  "justify-content", "justify-items", "justify-self",
  "align-items", "align-self", "align-content", "order",
  // Grid
  "grid", "grid-template", "grid-template-columns", "grid-template-rows",
  "grid-template-areas", "grid-area", "grid-column", "grid-row",
  "gap", "row-gap", "column-gap",
  "place-content", "place-items", "place-self",
  // Sizing
  "width", "min-width", "max-width", "height", "min-height", "max-height",
  // Spacing
  "margin", "margin-top", "margin-right", "margin-bottom", "margin-left",
  "padding", "padding-top", "padding-right", "padding-bottom", "padding-left",
  // Borders
  "border", "border-width", "border-style", "border-color",
  "border-top", "border-right", "border-bottom", "border-left",
  "border-radius",
  // Background
  "background", "background-color", "background-image", "background-position",
  "background-size", "background-repeat", "background-attachment",
  // Visual effects
  "opacity", "box-shadow", "filter", "backdrop-filter", "mix-blend-mode",
  // Typography
  "font", "font-family", "font-size", "font-weight", "font-style", "font-variant",
  "line-height", "letter-spacing", "word-spacing",
  "text-align", "text-indent", "text-transform", "text-decoration",
  "color",
  "white-space", "word-break", "overflow-wrap",
  // Interaction
  "cursor", "pointer-events", "user-select",
  // Overflow
  "overflow", "overflow-x", "overflow-y",
  // Effects
  "transform", "transform-origin",
  "transition", "transition-property", "transition-duration",
  "transition-delay", "transition-timing-function",
  "animation",
];

function propOrderIdx(prop: string): number {
  const i = PROPERTY_ORDER.indexOf(prop);
  return i === -1 ? PROPERTY_ORDER.length + 1 : i;
}

interface SideInfo {
  value: string;
  layer: BasinDecl["layer"];
  sourceLabel: string;
  sourcePath?: string;
  classFile?: string;
}

// Cascade: inherited (weakest) -> classes -> own (strongest).
// Within each layer, declarations are applied in source order — important
// for shorthand vs longhand resolution (`padding: 30; padding-left: 60` vs
// `padding-left: 60; padding: 30` produce different results).
// Special rules:
//   • z-index is *summed* across all ancestors + self (Foling-specific).
//   • padding / margin: longhand and shorthand are consolidated into a
//     single 4-value shorthand for display.
function computeBasin(
  inherited: { source: TreeNode; prop: string; value: string }[],
  ancestorPath: TreeNode[],
  selfConfig: NodeConfig,
  classNames: string[],
  classDefs: ClassDef[],
  ownCss: string | undefined,
  vars: Record<string, string>,
  disabledInherits: string[] = []
): BasinDecl[] {
  // Inherited props the user explicitly disabled don't enter the cascade.
  const disabled = new Set(disabledInherits);
  inherited = inherited.filter((d) => !disabled.has(d.prop));
  // Step 1: collect declarations in cascade order (inherited → class → own,
  // with source-order preserved inside each layer).
  type Entry = {
    prop: string;
    value: string;
    layer: BasinDecl["layer"];
    sourceLabel: string;
    sourcePath?: string;
    classFile?: string;
  };
  const all: Entry[] = [];
  for (const d of inherited) {
    all.push({
      prop: d.prop,
      value: substituteVarsInString(d.value, vars),
      layer: "inherited",
      sourceLabel: d.source.display_name || d.source.name,
      sourcePath: d.source.path,
    });
  }
  for (const cn of classNames) {
    const dot = cn.startsWith(".") ? cn : "." + cn;
    for (const def of classDefs.filter((c) => c.name === dot)) {
      for (const decl of parseCssDeclarations(def.properties)) {
        all.push({
          prop: decl.prop,
          value: substituteVarsInString(decl.value, vars),
          layer: "class",
          sourceLabel: def.name,
          classFile: def.source,
        });
      }
    }
  }
  for (const decl of parseCssDeclarations(ownCss ?? "")) {
    all.push({
      prop: decl.prop,
      value: substituteVarsInString(decl.value, vars),
      layer: "own",
      sourceLabel: "self",
    });
  }

  // Step 2: process declarations, with per-side resolution for shorthand groups.
  const out = new Map<string, BasinDecl>();
  const groups: Record<
    string,
    { top?: SideInfo; right?: SideInfo; bottom?: SideInfo; left?: SideInfo }
  > = {};
  for (const g of Object.keys(FOUR_SIDED_GROUPS)) groups[g] = {};
  const sideKey = ["top", "right", "bottom", "left"] as const;

  // Track every contributor per property (or shorthand group) so we can
  // surface "MIX" rows where more than one layer defined the same property.
  type Contrib = {
    layer: BasinDecl["layer"];
    value: string;
    sourceLabel: string;
  };
  const contributors = new Map<string, Contrib[]>();
  const propKeyFor = (prop: string): string => {
    for (const [group, sides] of Object.entries(FOUR_SIDED_GROUPS)) {
      if (sides.includes(prop)) return group;
    }
    return prop;
  };
  const recordContrib = (prop: string, c: Contrib) => {
    const key = propKeyFor(prop);
    if (!contributors.has(key)) contributors.set(key, []);
    contributors.get(key)!.push(c);
  };
  for (const item of all) {
    recordContrib(item.prop, {
      layer: item.layer,
      value: item.value,
      sourceLabel: item.sourceLabel,
    });
  }

  for (const item of all) {
    let handled = false;
    for (const [group, sides] of Object.entries(FOUR_SIDED_GROUPS)) {
      if (item.prop === group) {
        const [t, r, b, l] = parseFourSidedShorthand(item.value);
        const base = {
          layer: item.layer,
          sourceLabel: item.sourceLabel,
          sourcePath: item.sourcePath,
          classFile: item.classFile,
        };
        groups[group].top = { ...base, value: t };
        groups[group].right = { ...base, value: r };
        groups[group].bottom = { ...base, value: b };
        groups[group].left = { ...base, value: l };
        handled = true;
        break;
      }
      const sideIdx = sides.indexOf(item.prop);
      if (sideIdx >= 0) {
        groups[group][sideKey[sideIdx]] = {
          value: item.value,
          layer: item.layer,
          sourceLabel: item.sourceLabel,
          sourcePath: item.sourcePath,
          classFile: item.classFile,
        };
        handled = true;
        break;
      }
    }
    if (!handled) {
      out.set(item.prop, {
        prop: item.prop,
        value: item.value,
        layer: item.layer,
        sourceLabel: item.sourceLabel,
        sourcePath: item.sourcePath,
        classFile: item.classFile,
      });
    }
  }

  // Step 3: emit consolidated shorthand entries.
  const layerPri: Record<BasinDecl["layer"], number> = {
    inherited: 1,
    class: 2,
    own: 3,
    stacked: 4,
  };
  for (const [group, state] of Object.entries(groups)) {
    if (!state.top && !state.right && !state.bottom && !state.left) continue;
    const t = state.top?.value ?? "0";
    const r = state.right?.value ?? "0";
    const b = state.bottom?.value ?? "0";
    const l = state.left?.value ?? "0";
    const combined = combineFourSides(t, r, b, l);
    const sides = [state.top, state.right, state.bottom, state.left].filter(
      Boolean
    ) as SideInfo[];
    sides.sort((a, b) => layerPri[b.layer] - layerPri[a.layer]);
    const primary = sides[0];
    out.set(group, {
      prop: group,
      value: combined,
      layer: primary.layer,
      sourceLabel: primary.sourceLabel,
      sourcePath: primary.sourcePath,
      classFile: primary.classFile,
    });
  }

  // Step 4: z-index stacking.
  const parts: string[] = [];
  let sum = 0;
  let zFound = false;
  for (const ancestor of ancestorPath) {
    const z = getLocalZIndex(ancestor.config, classDefs);
    if (z !== null) {
      sum += z;
      zFound = true;
      parts.push(`${ancestor.display_name || ancestor.name}=${z}`);
    }
  }
  const selfZ = getLocalZIndex(selfConfig, classDefs);
  if (selfZ !== null) {
    sum += selfZ;
    zFound = true;
    parts.push(`self=${selfZ}`);
  }
  if (zFound) {
    out.set("z-index", {
      prop: "z-index",
      value: String(sum),
      layer: "stacked",
      sourceLabel: parts.join(" + "),
    });
  }

  // Step 5: attach shadows — any contributor from a layer other than the
  // winner's becomes a "shadowed" alternative. Stacked z-index has its
  // own breakdown in sourceLabel, so skip it here.
  for (const [key, decl] of out.entries()) {
    if (decl.layer === "stacked") continue;
    const entries = contributors.get(key) ?? [];
    const seen = new Set<string>();
    const shadows: NonNullable<BasinDecl["shadows"]> = [];
    for (const e of entries) {
      if (e.layer === decl.layer) continue;
      if (e.layer === "stacked") continue;
      const dedupKey = `${e.layer}:${e.sourceLabel}:${e.value}`;
      if (seen.has(dedupKey)) continue;
      seen.add(dedupKey);
      shadows.push({
        layer: e.layer as "inherited" | "class" | "own",
        value: e.value,
        sourceLabel: e.sourceLabel,
      });
    }
    if (shadows.length > 0) decl.shadows = shadows;
  }

  // Step 6: sort by logical property order, then alphabetically.
  return Array.from(out.values()).sort((a, b) => {
    const oA = propOrderIdx(a.prop);
    const oB = propOrderIdx(b.prop);
    if (oA !== oB) return oA - oB;
    return a.prop.localeCompare(b.prop);
  });
}

// Apply structural changes from a parsed tree to the actual disk tree.
// Identity-based: existing nodes are matched to desired rows by actualPath,
// so renumbering folder prefixes (NN_) never confuses one element for another.
// Folder names follow the per-sibling order, so inserts renumber only the
// following siblings — plain renames that preserve each node's YAML config.
//
// Returns a `rowId → final on-disk path` map so the caller can re-select the
// row it was editing even though new nodes only got a path just now.
async function applyTreeDiff(
  current: TreeNode,
  desired: ParsedNode[],
  pushUndo: (a: UndoAction) => void
): Promise<Map<string, string>> {
  const idToPath = new Map<string, string>();
  await syncChildren(current.path, current.children, desired, pushUndo, idToPath);
  return idToPath;
}

// After a folder is renamed on disk, its descendants' cached paths still
// reference the *old* parent prefix. Recursively rewrite them so subsequent
// rename / delete / create calls in the same applyTreeDiff pass don't hit
// "path not found" (os error 2).
function rewriteDescendantPaths(
  node: TreeNode,
  oldPrefix: string,
  newPrefix: string
): void {
  for (const child of node.children) {
    if (child.path.startsWith(oldPrefix)) {
      child.path = newPrefix + child.path.slice(oldPrefix.length);
    }
    rewriteDescendantPaths(child, oldPrefix, newPrefix);
  }
}

// The desired (ParsedNode) tree carries each node's pre-apply `actualPath`.
// When an ancestor folder is renamed mid-pass, those stored paths go stale —
// so the recursive syncChildren would fail to match children by identity and
// fall back to delete+recreate (data loss + heavy churn → OS error 5 on
// Windows). Rewrite them in lockstep with rewriteDescendantPaths.
function rewriteDesiredPaths(
  nodes: ParsedNode[],
  oldPrefix: string,
  newPrefix: string
): void {
  for (const n of nodes) {
    if (n.actualPath && n.actualPath.startsWith(oldPrefix)) {
      n.actualPath = newPrefix + n.actualPath.slice(oldPrefix.length);
    }
    rewriteDesiredPaths(n.children, oldPrefix, newPrefix);
  }
}

// Identity-based diff:
//   • Each desired node carries the actualPath of the existing on-disk node
//     it represents (or undefined if brand-new).
//   • We match existing nodes to desired by path, NOT by position. This
//     keeps a new <a> from accidentally stealing an old <a>'s config just
//     because they share a tag name.
//   • For matched nodes whose folder name needs to change (e.g. line number
//     shifted), a two-phase temp rename avoids collisions when several
//     siblings need to swap prefixes.
async function syncChildren(
  parentPath: string,
  existing: TreeNode[],
  desired: ParsedNode[],
  pushUndo: (a: UndoAction) => void,
  idToPath: Map<string, string>
): Promise<void> {
  // Index existing nodes by their absolute path
  const existingByPath = new Map<string, TreeNode>();
  for (const e of existing) existingByPath.set(e.path, e);

  // Resolve each desired node to its corresponding existing node (or null)
  const matches: (TreeNode | null)[] = desired.map((d) => {
    if (!d.actualPath) return null;
    return existingByPath.get(d.actualPath) ?? null;
  });
  const matchedPaths = new Set<string>();
  for (const m of matches) if (m) matchedPaths.add(m.path);

  // Phase 1 — delete any existing node that no desired row maps to.
  for (let i = existing.length - 1; i >= 0; i--) {
    const cur = existing[i];
    if (!matchedPaths.has(cur.path)) {
      const snapshot = await snapshotSubtree(cur.path);
      await deleteNode(cur.path);
      pushUndo({ type: "delete", parentPath, snapshot });
    }
  }

  // Phase 2 — rename matched nodes whose folder name is changing to a temp
  // name first. Avoids collisions when two siblings effectively swap names.
  const tempSuffix = Math.random().toString(36).slice(2, 8);
  for (let i = 0; i < desired.length; i++) {
    const matched = matches[i];
    const des = desired[i];
    if (!matched) continue;
    if (matched.name !== des.folderName) {
      const tempName = `__tmp_${tempSuffix}_${i}_${matched.name}`;
      const oldPath = matched.path;
      const tempPath = await renameNode(oldPath, tempName);
      pushUndo({ type: "rename", oldPath, newPath: tempPath });
      matched.path = tempPath;
      matched.name = tempName;
      rewriteDescendantPaths(matched, oldPath, tempPath);
      // Keep desired-tree child paths in sync so the recursive pass still
      // matches them by identity after this rename.
      rewriteDesiredPaths(des.children, oldPath, tempPath);
    }
  }

  // Phase 3 — rename matched nodes from temp to their final folder name,
  // create new nodes at the right position, and recurse into each.
  for (let i = 0; i < desired.length; i++) {
    const des = desired[i];
    const matched = matches[i];
    if (matched) {
      if (matched.name !== des.folderName) {
        const oldPath = matched.path;
        const newPath = await renameNode(oldPath, des.folderName);
        pushUndo({ type: "rename", oldPath, newPath });
        matched.path = newPath;
        matched.name = des.folderName;
        matched.display_name = des.name;
        matched.order = des.lineIndex + 1;
        rewriteDescendantPaths(matched, oldPath, newPath);
        rewriteDesiredPaths(des.children, oldPath, newPath);
      } else {
        // Already at the right folder name — just keep display in sync
        matched.display_name = des.name;
      }
      idToPath.set(des.rowId, matched.path);
      await syncChildren(
        matched.path,
        matched.children,
        des.children,
        pushUndo,
        idToPath
      );
    } else {
      // Brand-new node
      const newPath = await createNode(parentPath, des.folderName);
      pushUndo({ type: "create", path: newPath });
      idToPath.set(des.rowId, newPath);
      await createNestedChildren(newPath, des.children, pushUndo, idToPath);
    }
  }
}

async function createNestedChildren(
  parentPath: string,
  children: ParsedNode[],
  pushUndo: (a: UndoAction) => void,
  idToPath: Map<string, string>
): Promise<void> {
  for (const child of children) {
    const newPath = await createNode(parentPath, child.folderName);
    pushUndo({ type: "create", path: newPath });
    idToPath.set(child.rowId, newPath);
    await createNestedChildren(newPath, child.children, pushUndo, idToPath);
  }
}

// A single class rule extracted from a `classes/*.css` file.
interface ClassDef {
  name: string;       // ".button"
  properties: string; // "padding: 1rem;\nbackground: $colorMain;"
  source: string;     // "02_button.css"
}

// Parse `.classname { ... }` rules out of all class files.
// Manual brace-balancing — handles SCSS-style nesting like
// `.card { h1, h2 { margin: 0; } }` so the class is still discovered.
function parseClassDefs(files: ClassFile[]): ClassDef[] {
  const out: ClassDef[] = [];
  const nameRe = /^\.([a-zA-Z_][a-zA-Z0-9_-]*(?:[:.][a-zA-Z0-9_-]+)*)/;
  for (const file of files) {
    const text = file.content;
    let i = 0;
    while (i < text.length) {
      if (text[i] !== ".") {
        i++;
        continue;
      }
      const nameMatch = nameRe.exec(text.slice(i));
      if (!nameMatch) {
        i++;
        continue;
      }
      const className = nameMatch[1];
      let j = i + nameMatch[0].length;
      // Skip whitespace between selector and `{`
      while (j < text.length && /\s/.test(text[j])) j++;
      if (j >= text.length || text[j] !== "{") {
        i = j;
        continue;
      }
      // Find the matching `}` honoring nested braces
      let depth = 1;
      let k = j + 1;
      while (k < text.length && depth > 0) {
        const ch = text[k];
        if (ch === "{") depth++;
        else if (ch === "}") depth--;
        if (depth > 0) k++;
      }
      const body = text.slice(j + 1, k);
      out.push({
        name: "." + className,
        properties: body.trim(),
        source: file.name,
      });
      i = k + 1;
    }
  }
  return out;
}


function normEmpty(s?: string): string | undefined {
  return s == null || s === "" ? undefined : s;
}

// Strip fully-empty links / attributes / classes before persisting to YAML.
// Half-filled entries (e.g. {rel: "stylesheet", href: ""}) are kept so the user
// can finish typing them — only items that are entirely empty are dropped.
function cleanForSave(c: NodeConfig): NodeConfig {
  const cleaned: NodeConfig = {
    tag: normEmpty(c.tag),
    id: normEmpty(c.id),
    classes: c.classes.filter((x) => x.trim() !== ""),
    attributes: Object.fromEntries(
      Object.entries(c.attributes).filter(([k]) => k.trim() !== "")
    ),
    content: normEmpty(c.content),
    css: normEmpty(c.css),
    js: normEmpty(c.js),
    links: c.links.filter(
      (l) => (l.rel ?? "").trim() !== "" || (l.href ?? "").trim() !== ""
    ),
  };
  if (c.available_classes && c.available_classes.length > 0) {
    cleaned.available_classes = c.available_classes.filter(
      (x) => x.trim() !== ""
    );
  }
  if (c.disabled_inherits && c.disabled_inherits.length > 0) {
    cleaned.disabled_inherits = c.disabled_inherits.filter(
      (x) => x.trim() !== ""
    );
  }
  return cleaned;
}

function findPath(root: TreeNode, target: string): TreeNode[] | null {
  if (root.path === target) return [root];
  for (const c of root.children) {
    const sub = findPath(c, target);
    if (sub) return [root, ...sub];
  }
  return null;
}

function findNode(root: TreeNode, target: string): TreeNode | null {
  if (root.path === target) return root;
  for (const c of root.children) {
    const sub = findNode(c, target);
    if (sub) return sub;
  }
  return null;
}

function nextOrderPrefix(siblings: TreeNode[]): string {
  const orders = siblings.map((c) => c.order ?? 0);
  const max = orders.length ? Math.max(...orders) : 0;
  return String(max + 1).padStart(2, "0");
}

export default function App() {
  // Re-render the whole tree when the UI language changes so t() output updates.
  useLocaleVersion();
  const [projectRoot, setProjectRoot] = useState<string | null>(null);
  const [tree, setTree] = useState<TreeNode | null>(null);
  const [projectConfig, setProjectConfig] = useState<ProjectConfig>({
    variables: {},
  });
  const [selectedPath, setSelectedPath] = useState<string | null>(null);
  const [config, setConfig] = useState<NodeConfig>(emptyConfig());
  const [activeTab, setActiveTab] = useState<TabKey>("css");
  const [preview, setPreview] = useState<string | null>(null);
  const [menu, setMenu] = useState<
    "file" | "edit" | "view" | "window" | "plugins" | "help" | null
  >(null);
  const [showSettings, setShowSettings] = useState(false);
  const [showShortcuts, setShowShortcuts] = useState(false);
  const [showAbout, setShowAbout] = useState(false);
  const [showChangelog, setShowChangelog] = useState(false);
  const [locale, setLocale] = useState<"en" | "ja">(
    () => (localStorage.getItem(LOCALE_KEY) === "ja" ? "ja" : "en")
  );
  const [editorTheme, setEditorTheme] = useState<EditorTheme>(
    () => (localStorage.getItem(EDITOR_THEME_KEY) as EditorTheme) || "dark"
  );
  const [showSearch, setShowSearch] = useState(false);
  // Close the top menu when the user clicks anywhere outside it.
  useEffect(() => {
    if (!menu) return;
    const onDown = (e: MouseEvent) => {
      const t = e.target as HTMLElement | null;
      if (t && t.closest(".menubar")) return;
      setMenu(null);
    };
    document.addEventListener("mousedown", onDown, true);
    return () => document.removeEventListener("mousedown", onDown, true);
  }, [menu]);
  const [error, setError] = useState<string | null>(null);
  const [info, setInfo] = useState<string | null>(null);
  // Auto-dismiss transient info toasts after a few seconds. Errors are sticky
  // (user dismisses by clicking) since they may need action.
  useEffect(() => {
    if (!info) return;
    const t = window.setTimeout(() => setInfo(null), 3500);
    return () => window.clearTimeout(t);
  }, [info]);
  const [dirty, setDirty] = useState(false);
  const [undoStack, setUndoStack] = useState<UndoAction[]>([]);
  const [redoStack, setRedoStack] = useState<UndoAction[]>([]);
  // Tree editor state — flat row list edited in-memory; applied to disk
  // only on explicit RUN or Ctrl+S.
  const [rows, setRows] = useState<FlatRow[]>([]);
  const [treeDirty, setTreeDirty] = useState(false);
  // Row id queued for auto-commit: insertRow sets it, an effect picks it up
  // after rows actually update, runs applyRows, then selects the resulting
  // path so the user sees blue highlight immediately on add (no manual save).
  const [autoCommitId, setAutoCommitId] = useState<string | null>(null);
  // In-app clipboard for subtree copy/paste. We deliberately do NOT use the
  // OS clipboard for tree snapshots, so pasting into a text input never
  // dumps raw JSON into a row name.
  const [treeClipboard, setTreeClipboard] = useState<NodeSnapshot | null>(
    null
  );
  // Mirror of the clipboard in a ref so a Ctrl+C immediately followed by
  // Ctrl+V reads the just-copied snapshot synchronously. Reading the state
  // there would yield the *previous* clipboard until React re-renders, which
  // is exactly the "an old element shows up" symptom.
  const treeClipboardRef = useRef<NodeSnapshot | null>(null);
  // One-shot request to move keyboard focus onto a tree row (by path). Set
  // e.g. after undo so the cursor lands back on the restored selection.
  const [treeFocusPath, setTreeFocusPath] = useState<string | null>(null);
  // Element editor modal (opened by a tree row's ✎ button). Holds the row's
  // line number (= the element's id) for the title; null = closed.
  const [elementEdit, setElementEdit] = useState<{ lineNumber: number } | null>(
    null
  );
  // Which top-level container the DOM tree is showing. Default is body,
  // since head is metadata (title/meta/link) — a different editing concern.
  const [treeView, setTreeView] = useState<"body" | "head">("body");
  // Class files state (project-wide resource, edited via the menu-bar modal)
  const [classFiles, setClassFiles] = useState<ClassFile[]>([]);
  const [selectedClassFile, setSelectedClassFile] = useState<string | null>(
    null
  );
  const [classFileContent, setClassFileContent] = useState<string>("");
  const [classFileDirty, setClassFileDirty] = useState(false);
  // Module files (reusable components), loaded from modules/*.yaml. Flattened
  // into a single list since module names are looked up by name on expansion.
  const [moduleFiles, setModuleFiles] = useState<ModuleFile[]>([]);
  // Row pending "register as module" — drives the registration modal.
  const [moduleRegisterRow, setModuleRegisterRow] = useState<FlatRow | null>(
    null
  );
  // Kept for backward compatibility; the CLASSES tab supersedes it.
  const [showClassesModal] = useState(false);
  const [showVarsModal, setShowVarsModal] = useState(false);
  const [showHeadDefault, setShowHeadDefault] = useState(false);
  const [showHeadProjectTags, setShowHeadProjectTags] = useState(false);
  const [htmlLang, setHtmlLang] = useState("ja");
  const [browserPath, setBrowserPath] = useState<string | null>(() =>
    localStorage.getItem(BROWSER_KEY)
  );
  const [imageFolders, setImageFolders] = useState<ImageFolder[]>([]);
  const [selectedImageFolder, setSelectedImageFolder] = useState<string | null>(
    null
  );
  const [previewBaseUrl, setPreviewBaseUrl] = useState<string>("");
  // DEV mode: preview is instrumented so clicking an element jumps the editor
  // to it. Kept in a ref too so the debounced rebuild reads the latest value.
  const [devMode, setDevMode] = useState(false);
  const devModeRef = useRef(false);
  useEffect(() => {
    devModeRef.current = devMode;
  }, [devMode]);
  const [plugins, setPlugins] = useState<LoadedPlugin[]>([]);
  const [showPluginsModal, setShowPluginsModal] = useState(false);
  // Path of an ancestor whose CSS rule the user is currently inspecting
  // (clicked an inherited declaration). Replaces the old "highlight whole path"
  // behavior — we now only light up the actual *source* of a property.
  const [highlightSourcePath, setHighlightSourcePath] = useState<string | null>(
    null
  );

  // Clear source highlight when the selected element changes
  useEffect(() => {
    setHighlightSourcePath(null);
  }, [selectedPath]);

  const inherited = useMemo(
    () => gatherInherited(tree, selectedPath),
    [tree, selectedPath]
  );

  const classDefs = useMemo(() => parseClassDefs(classFiles), [classFiles]);

  // All modules across every module file, flattened for name lookup. The
  // names feed the `.module` tree autocomplete; the defs drive expansion.
  const modules = useMemo(
    () => moduleFiles.flatMap((f) => f.modules),
    [moduleFiles]
  );
  const moduleNames = useMemo(() => modules.map((m) => m.name), [modules]);

  // Ancestor path of the selected element (root → parent, excluding self)
  const ancestorPath = useMemo(() => {
    if (!tree || !selectedPath) return [];
    const p = findPath(tree, selectedPath);
    if (!p) return [];
    return p.slice(0, -1);
  }, [tree, selectedPath]);

  const basin = useMemo(
    () =>
      computeBasin(
        inherited,
        ancestorPath,
        config,
        config.classes ?? [],
        classDefs,
        config.css,
        projectConfig.variables ?? {},
        config.disabled_inherits ?? []
      ),
    [
      inherited,
      ancestorPath,
      config,
      classDefs,
      projectConfig.variables,
    ]
  );

  // Auto-dismiss info toast
  useEffect(() => {
    if (!info) return;
    const t = window.setTimeout(() => setInfo(null), 1800);
    return () => window.clearTimeout(t);
  }, [info]);

  // Restore last project on mount
  useEffect(() => {
    const last = localStorage.getItem(LAST_PROJECT_KEY);
    if (last) {
      openProject(last).catch(() => {});
    }
  }, []);

  // Ctrl+S to save / Ctrl+Z to undo
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if ((e.ctrlKey || e.metaKey) && e.key.toLowerCase() === "s") {
        e.preventDefault();
        // First, apply pending tree edits if any
        const treeFlush = treeDirty
          ? applyRows().then((r) => r.ok)
          : Promise.resolve(true);
        treeFlush.then((ok) => {
          if (!ok) return;
          if (activeTab === "classes" || showClassesModal) {
            if (selectedClassFile && projectRoot) {
              saveClassFile().catch((err) => setError(String(err)));
            } else if (treeDirty) {
              setInfo("Tree saved");
            } else {
              setInfo("Select a class file");
            }
          } else if (selectedPath) {
            const cleaned = cleanForSave(config);
            writeNode(selectedPath, cleaned)
              .then(() => {
                setConfig(cleaned);
                setDirty(false);
                setInfo("Saved");
              })
              .catch((err) => setError(String(err)));
          } else if (treeDirty) {
            setInfo("Tree saved");
          } else {
            setInfo("Nothing to save");
          }
        });
        return;
      }
      // Project-wide search: Ctrl+Shift+F.
      if (
        (e.ctrlKey || e.metaKey) &&
        e.shiftKey &&
        e.key.toLowerCase() === "f"
      ) {
        if (!projectRoot) return;
        e.preventDefault();
        setShowSearch(true);
        return;
      }
      // Redo: Ctrl+Y or Ctrl+Shift+Z. Check before the plain Ctrl+Z below.
      if (
        (e.ctrlKey || e.metaKey) &&
        (e.key.toLowerCase() === "y" ||
          (e.key.toLowerCase() === "z" && e.shiftKey))
      ) {
        const target = e.target as HTMLElement | null;
        const tag = target?.tagName ?? "";
        const isTreeInput = !!target?.classList?.contains("tree-row-input");
        if ((tag === "TEXTAREA" || tag === "INPUT") && !isTreeInput) return;
        e.preventDefault();
        runRedo();
        return;
      }
      if (
        (e.ctrlKey || e.metaKey) &&
        e.key.toLowerCase() === "z" &&
        !e.shiftKey
      ) {
        const target = e.target as HTMLElement | null;
        const tag = target?.tagName ?? "";
        const isTreeInput = !!target?.classList?.contains("tree-row-input");
        // Allow native undo in real text-editing fields (CSS / CONTENT / etc.).
        // But in the DOM tree the row inputs hold tag names — the meaningful
        // undo there is the structural one (e.g. undo a just-added tag), so we
        // run the app-level undo even though the focused element is an <input>.
        if ((tag === "TEXTAREA" || tag === "INPUT") && !isTreeInput) return;
        e.preventDefault();
        runUndo();
      }

      // Shift+Delete — delete the selected element (and its whole subtree).
      // Leaves native cut/delete intact when typing in a real text field.
      if (e.shiftKey && e.key === "Delete") {
        const target = e.target as HTMLElement | null;
        const tag = target?.tagName ?? "";
        const isTreeInput = !!target?.classList?.contains("tree-row-input");
        if ((tag === "TEXTAREA" || tag === "INPUT") && !isTreeInput) return;
        if (!selectedPath) return;
        e.preventDefault();
        deleteSelected();
        return;
      }

      // Alt+S / Alt+C / Alt+J — jump to the CSS / CLASSES / SCRIPT editor for
      // the selected element and focus it for immediate typing. Deliberately
      // avoids Ctrl/Cmd and Alt+digit so it won't clash with browser shortcuts
      // (tabs, address bar, etc.) in the planned web build.
      if (e.altKey && !e.ctrlKey && !e.metaKey && !e.shiftKey) {
        const k = e.key.toLowerCase();
        const focusSoon = (sel: string) =>
          window.setTimeout(() => {
            document.querySelector<HTMLTextAreaElement>(sel)?.focus();
          }, 0);
        if (k === "t") {
          // Toggle the element editor (text / image). Press again to close.
          e.preventDefault();
          if (elementEdit) {
            setElementEdit(null);
            return;
          }
          if (!selectedPath) return;
          const idx = rows.findIndex((r) => r.actualPath === selectedPath);
          if (idx >= 0) openElementEditor(rows[idx], idx + 1);
          return;
        }
        if (k === "s") {
          e.preventDefault();
          setActiveTab("css");
          focusSoon(".editor-area .css-textarea");
          return;
        }
        if (k === "c") {
          e.preventDefault();
          setActiveTab("classes");
          focusSoon(".editor-area .css-textarea");
          return;
        }
        if (k === "j") {
          e.preventDefault();
          setActiveTab("js");
          focusSoon(".editor-area .js-fullpane-textarea");
          return;
        }
        if (k === "r") {
          // RUN — open the normal preview in the browser.
          e.preventDefault();
          runBuild();
          return;
        }
      }

      // Alt+Shift+R — DEV preview (click-to-edit).
      if (
        e.altKey &&
        e.shiftKey &&
        !e.ctrlKey &&
        !e.metaKey &&
        e.key.toLowerCase() === "r"
      ) {
        e.preventDefault();
        runDev();
        return;
      }

      // Alt + arrows. From the tree:
      //   Alt+↑ / Alt+↓   → move the selection up / down a row
      //   Alt+←           → select the parent element
      //   Alt+→           → select the next sibling (wraps around)
      //   Alt+Shift+↑/↓   → reorder the row; Alt+Shift+←/→ → outdent / indent
      // From the CSS / SCRIPT editor:
      //   Alt+←           → jump back to the element's tree row
      if (e.altKey && !e.ctrlKey && !e.metaKey) {
        const target = e.target as HTMLElement | null;
        const isTreeInput = !!target?.classList?.contains("tree-row-input");
        const inEditor =
          !!target?.classList?.contains("css-textarea") ||
          !!target?.classList?.contains("js-fullpane-textarea");

        if (inEditor && !e.shiftKey && e.key === "ArrowLeft") {
          if (selectedPath) {
            e.preventDefault();
            setTreeFocusPath(selectedPath);
          }
          return;
        }
        if (!isTreeInput) return;
        if (!selectedPath) return;

        if (!e.shiftKey) {
          if (e.key === "ArrowUp") {
            e.preventDefault();
            navigateSelection(-1);
            return;
          }
          if (e.key === "ArrowDown") {
            e.preventDefault();
            navigateSelection(1);
            return;
          }
          if (e.key === "ArrowLeft") {
            e.preventDefault();
            navigateToParent();
            return;
          }
          if (e.key === "ArrowRight") {
            e.preventDefault();
            navigateToNextSibling();
            return;
          }
        }
        const idx = rows.findIndex((r) => r.actualPath === selectedPath);
        let mutated: FlatRow[] | null = null;
        if (idx >= 0 && e.shiftKey) {
          if (e.key === "ArrowUp") mutated = moveRowUp(rows, idx);
          else if (e.key === "ArrowDown") mutated = moveRowDown(rows, idx);
          else if (e.key === "ArrowLeft") mutated = outdentRowInList(rows, idx);
          else if (e.key === "ArrowRight") mutated = indentRowInList(rows, idx);
        }
        if (mutated) {
          e.preventDefault();
          setRows(mutated);
          setTreeDirty(true);
        }
      }
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [
    config,
    selectedPath,
    undoStack,
    redoStack,
    projectRoot,
    activeTab,
    selectedClassFile,
    classFileContent,
    showClassesModal,
    treeDirty,
    rows,
    tree,
    elementEdit,
  ]);

  // Tracks which path the in-memory `config` was loaded for. Guards the
  // autosave below against a race: right after the selection changes, `config`
  // still briefly holds the PREVIOUS element's data (until readNode resolves)
  // while `selectedPath` is already the new one — without this guard the
  // debounced autosave could write element A's config into element B's folder.
  const configPathRef = useRef<string | null>(null);

  // Load node config when selection changes
  useEffect(() => {
    if (!selectedPath) {
      setConfig(emptyConfig());
      setDirty(false);
      configPathRef.current = null;
      return;
    }
    readNode(selectedPath)
      .then((c) => {
        setConfig({
          ...emptyConfig(),
          ...c,
          classes: c.classes ?? [],
          attributes: c.attributes ?? {},
          links: c.links ?? [],
        });
        setDirty(false);
        configPathRef.current = selectedPath;
      })
      .catch((e) => setError(String(e)));
  }, [selectedPath]);

  // Auto-save on config change (debounced).
  // Note: auto-save preserves half-filled entries so the user can keep typing.
  // Full normalization (cleanForSave) happens on explicit Ctrl+S only.
  const saveTimer = useRef<number | null>(null);
  useEffect(() => {
    if (!selectedPath || !dirty) return;
    // Only autosave once `config` actually belongs to the selected path.
    if (configPathRef.current !== selectedPath) return;
    if (saveTimer.current) window.clearTimeout(saveTimer.current);
    const pathAtSchedule = selectedPath;
    saveTimer.current = window.setTimeout(() => {
      // Re-check at fire time in case the selection moved during the debounce.
      if (configPathRef.current !== pathAtSchedule) return;
      writeNode(pathAtSchedule, config)
        .then(() => {
          setDirty(false);
          scheduleRebuild();
        })
        .catch((e) => setError(String(e)));
    }, 500);
    return () => {
      if (saveTimer.current) window.clearTimeout(saveTimer.current);
    };
  }, [config, dirty, selectedPath]);

  // Flush every pending edit to disk. Kept in a ref (refreshed each render) so
  // the window close handler — registered once — always sees current state.
  const flushAllRef = useRef<() => Promise<void>>(async () => {});
  flushAllRef.current = async () => {
    if (treeDirty) await applyRows();
    if (dirty && selectedPath) {
      await writeNode(selectedPath, cleanForSave(config));
    }
    if (classFileDirty && selectedClassFile && projectRoot) {
      await writeClassFile(projectRoot, selectedClassFile, classFileContent);
    }
  };
  const hasUnsavedRef = useRef(false);
  hasUnsavedRef.current = dirty || treeDirty || classFileDirty;

  // Save-on-exit: intercept the window close, flush pending edits, then close.
  // Autosave already persists most edits within 500ms; this catches the last
  // sub-second of typing and un-applied tree reorders so nothing is lost.
  useEffect(() => {
    let unlisten: (() => void) | undefined;
    let cancelled = false;
    let closing = false;
    (async () => {
      try {
        const win = getCurrentWindow();
        const un = await win.onCloseRequested(async (event) => {
          if (closing) return; // our own destroy() — let it through
          if (!hasUnsavedRef.current) return; // nothing pending, allow close
          event.preventDefault();
          try {
            await flushAllRef.current();
            closing = true;
            await win.destroy();
          } catch (e) {
            // Saving failed — keep the window open so the user can react.
            setError(`Failed to save before exit: ${String(e)}`);
          }
        });
        if (cancelled) un();
        else unlisten = un;
      } catch {
        // Non-Tauri / unsupported context — skip silently.
      }
    })();
    return () => {
      cancelled = true;
      unlisten?.();
    };
  }, []);

  async function openProject(root: string) {
    try {
      // Always ensure baseline structure (classes/, images/, htfl.yaml, etc.)
      await initProject(root);
      const t = await readTree(root);
      const cfg = await readProjectConfig(root);
      const cf = await readClassFiles(root);
      const mf = await readModules(root).catch(() => []);
      const imgs = await readImageFolders(root);
      const plg = await readPlugins(root).catch(() => []);
      const htmlNode = await readNode(t.path).catch(() => null);
      setHtmlLang(htmlNode?.attributes?.lang ?? "ja");
      setProjectRoot(root);
      setPlugins(plg);
      setTree(t);
      setRows(syncRowsFromTree(getViewRoot(t, treeView)));
      setTreeDirty(false);
      setProjectConfig(cfg);
      setClassFiles(cf);
      setModuleFiles(mf);
      setSelectedClassFile(null);
      setClassFileContent("");
      setClassFileDirty(false);
      setImageFolders(imgs);
      setSelectedImageFolder(imgs[0]?.name ?? null);
      setSelectedPath(null);
      setUndoStack([]);
      // Lazily resolve the preview server URL so <img> thumbnails inside
      // the editor itself can be loaded via the same HTTP route the browser
      // uses for the actual preview.
      previewUrl()
        .then(setPreviewBaseUrl)
        .catch(() => {});
      localStorage.setItem(LAST_PROJECT_KEY, root);
    } catch (e) {
      setError(String(e));
    }
  }

  async function reloadClassFiles() {
    if (!projectRoot) return;
    const cf = await readClassFiles(projectRoot);
    setClassFiles(cf);
  }

  async function reloadModules() {
    if (!projectRoot) return;
    const mf = await readModules(projectRoot).catch(() => []);
    setModuleFiles(mf);
  }

  async function reloadImageFolders() {
    if (!projectRoot) return;
    const imgs = await readImageFolders(projectRoot);
    setImageFolders(imgs);
    if (selectedImageFolder && !imgs.some((f) => f.name === selectedImageFolder)) {
      setSelectedImageFolder(imgs[0]?.name ?? null);
    }
    setInfo("Image folders refreshed");
  }

  // Apply an image to the currently-selected element. If the element is an
  // <img>, set its src attribute. Otherwise, replace or append
  // `background-image` in its own CSS.
  function applyImageToElement(imageRelPath: string) {
    if (!selectedPath) {
      setError("Select a target element");
      return;
    }
    const url = `/images/${imageRelPath}`;
    const basename = selectedPath.split(/[\\/]/).pop() ?? "";
    // Derive tag from "01_a" → "a"
    const parts = basename.split("_");
    const derived =
      parts.length > 1 && /^\d+$/.test(parts[0])
        ? parts.slice(1).join("_")
        : basename;
    const effective = (config.tag ?? derived).toLowerCase();
    if (effective === "img") {
      setConfig((prev) => ({
        ...prev,
        attributes: { ...(prev.attributes ?? {}), src: url },
      }));
      setInfo(`Applied to <img src>: ${imageRelPath}`);
    } else {
      const existing = config.css ?? "";
      const kept = existing
        .split("\n")
        .filter((l) => !/^\s*background-image\s*:/.test(l));
      const sep = kept.some((l) => l.trim() !== "") ? "\n" : "";
      const next = (
        kept.join("\n").replace(/\n+$/, "") +
        sep +
        `background-image: url('${url}');`
      ).replace(/^\n+/, "");
      setConfig((prev) => ({ ...prev, css: next }));
      setInfo(`Applied as background-image: ${imageRelPath}`);
    }
    setDirty(true);
  }

  // Hydrate class-file editor when selection changes
  useEffect(() => {
    if (!selectedClassFile) {
      setClassFileContent("");
      setClassFileDirty(false);
      return;
    }
    const f = classFiles.find((x) => x.name === selectedClassFile);
    if (f) {
      setClassFileContent(f.content);
      setClassFileDirty(false);
    }
  }, [selectedClassFile, classFiles]);

  // Auto-save class file (500ms debounce)
  const classSaveTimer = useRef<number | null>(null);
  useEffect(() => {
    if (!projectRoot || !selectedClassFile || !classFileDirty) return;
    if (classSaveTimer.current) window.clearTimeout(classSaveTimer.current);
    classSaveTimer.current = window.setTimeout(() => {
      writeClassFile(projectRoot, selectedClassFile, classFileContent)
        .then(() => {
          setClassFiles((prev) =>
            prev.map((f) =>
              f.name === selectedClassFile
                ? { ...f, content: classFileContent }
                : f
            )
          );
          setClassFileDirty(false);
          scheduleRebuild();
        })
        .catch((e) => setError(String(e)));
    }, 500);
    return () => {
      if (classSaveTimer.current) window.clearTimeout(classSaveTimer.current);
    };
  }, [projectRoot, selectedClassFile, classFileContent, classFileDirty]);

  async function saveClassFile() {
    if (!projectRoot || !selectedClassFile) return;
    await writeClassFile(projectRoot, selectedClassFile, classFileContent);
    setClassFiles((prev) =>
      prev.map((f) =>
        f.name === selectedClassFile ? { ...f, content: classFileContent } : f
      )
    );
    setClassFileDirty(false);
    setInfo(`Saved: ${selectedClassFile}`);
    scheduleRebuild();
  }

  async function addClassFile() {
    if (!projectRoot) return;
    const base = window.prompt(
      "File name (e.g. 02_layout). .css is added automatically",
      `${String(classFiles.length + 1).padStart(2, "0")}_layer`
    );
    if (!base) return;
    const safe = base.trim().replace(/\.css$/i, "").replace(/[^a-zA-Z0-9_-]/g, "");
    if (!safe) return;
    const name = `${safe}.css`;
    try {
      await writeClassFile(
        projectRoot,
        name,
        `/* ${name} */\n\n.example {\n  /* style here */\n}\n`
      );
      await reloadClassFiles();
      setSelectedClassFile(name);
    } catch (e) {
      setError(String(e));
    }
  }

  async function removeClassFile() {
    if (!projectRoot || !selectedClassFile) return;
    if (!window.confirm(`Delete: ${selectedClassFile}`)) return;
    try {
      await deleteClassFile(projectRoot, selectedClassFile);
      const next = classFiles.filter((f) => f.name !== selectedClassFile);
      setClassFiles(next);
      setSelectedClassFile(next[0]?.name ?? null);
    } catch (e) {
      setError(String(e));
    }
  }

  // Select a row from the tree. If the row hasn't been committed to disk
  // yet (no actualPath), auto-flush pending tree edits first so the user
  // can immediately start editing its CSS / content.
  async function selectRow(row: FlatRow) {
    if (row.actualPath) {
      setSelectedPath(row.actualPath);
      setHighlightSourcePath(null);
      return;
    }
    // No actualPath → row was just inserted. The autoCommit effect (queued
    // by insertRowAt) will apply and select it; calling applyRows here would
    // race for the applyingRef and stomp the auto-commit's selection update.
    if (autoCommitId) return;
    if (row.name.trim() === "") return;
    const result = await applyRows();
    if (!result.ok || !result.rows) return;
    const updated = result.rows.find((r) => r.id === row.id);
    if (updated?.actualPath) {
      setSelectedPath(updated.actualPath);
      setHighlightSourcePath(null);
    }
  }

  // Open the element editor modal (content / image / attributes) for a row.
  // Selects the row first (flushing it to disk if it's a brand-new row) so the
  // config loads, then shows the modal titled with the line number (= id).
  async function openElementEditor(row: FlatRow, lineNumber: number) {
    if (row.actualPath) {
      setSelectedPath(row.actualPath);
      setHighlightSourcePath(null);
    } else {
      const result = await applyRows();
      const updated = result.rows?.find((r) => r.id === row.id);
      if (!updated?.actualPath) return;
      setSelectedPath(updated.actualPath);
      setHighlightSourcePath(null);
    }
    setElementEdit({ lineNumber });
  }

  // Move the selection up / down to the adjacent *visible* saved row, and put
  // the cursor on it. Used by Alt+↑ / Alt+↓.
  function navigateSelection(delta: 1 | -1) {
    const order = getVisibleRows(rows).filter((v) => v.row.actualPath);
    if (order.length === 0) return;
    const cur = order.findIndex((v) => v.row.actualPath === selectedPath);
    const next = cur < 0 ? (delta > 0 ? 0 : order.length - 1) : cur + delta;
    if (next < 0 || next >= order.length) return;
    const path = order[next].row.actualPath!;
    setSelectedPath(path);
    setHighlightSourcePath(null);
    setTreeFocusPath(path);
  }

  // Alt+← (in the tree): select the parent element. Stops at <body> (the
  // <html> root isn't editable in the tree).
  function navigateToParent() {
    if (!tree || !selectedPath) return;
    const parent = parentNode(tree, selectedPath);
    if (!parent || parent.path === tree.path) return;
    setSelectedPath(parent.path);
    setHighlightSourcePath(null);
    setTreeFocusPath(parent.path);
  }

  // Alt+→ (in the tree): select the next sibling, wrapping around.
  function navigateToNextSibling() {
    if (!tree || !selectedPath) return;
    const parent = parentNode(tree, selectedPath);
    if (!parent || parent.children.length === 0) return;
    const i = parent.children.findIndex((c) => c.path === selectedPath);
    if (i < 0) return;
    const next = parent.children[(i + 1) % parent.children.length];
    setSelectedPath(next.path);
    setHighlightSourcePath(null);
    setTreeFocusPath(next.path);
  }

  // Apply current rows to the disk tree (rename / create / delete).
  // Scoped to the current view (body or head) so the other container is not
  // touched. No debounce — caller invokes this explicitly (RUN / Ctrl+S /
  // selecting a not-yet-applied row).
  const applyingRef = useRef(false);
  async function applyRows(): Promise<{ ok: boolean; rows?: FlatRow[] }> {
    if (!projectRoot || !tree) return { ok: false };
    if (applyingRef.current) return { ok: false };
    const viewRoot = getViewRoot(tree, treeView);
    if (!viewRoot) return { ok: false };
    const desired = rowsToParsedTree(rows);
    applyingRef.current = true;
    try {
      const idToPath = await applyTreeDiff(viewRoot, desired, pushUndo);
      const t = await readTree(projectRoot);
      setTree(t);
      const nextView = getViewRoot(t, treeView);
      // Invert id→path so freshly-created/renamed nodes keep their row id.
      const pathToId = new Map<string, string>();
      for (const [id, p] of idToPath) pathToId.set(p, id);
      const nextRows = syncRowsFromTree(nextView, rows, pathToId);
      setRows(nextRows);
      setTreeDirty(false);
      scheduleRebuild();
      return { ok: true, rows: nextRows };
    } catch (e) {
      setError(String(e));
      return { ok: false };
    } finally {
      applyingRef.current = false;
    }
  }

  // Auto-commit: after insertRowAt queues a new row id, this effect runs once
  // the row state has actually settled, flushes the tree to disk, then selects
  // the freshly-created node so its CSS/CONTENT panel is immediately editable.
  useEffect(() => {
    if (!autoCommitId) return;
    const idToFind = autoCommitId;
    setAutoCommitId(null);
    (async () => {
      const result = await applyRows();
      if (!result.ok || !result.rows) return;
      const r = result.rows.find((x) => x.id === idToFind);
      if (r?.actualPath) {
        setSelectedPath(r.actualPath);
        setHighlightSourcePath(null);
      }
    })();
    // applyRows is intentionally not in deps — we want the version captured
    // *after* the row state update settles.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [autoCommitId]);

  // Commit a row's pending name change on blur. If the tree is dirty we flush
  // the rename to disk and re-sync the row's actualPath so blue highlight
  // stays accurate after the folder name changes.
  async function commitRowEdit(row: FlatRow) {
    if (!projectRoot || !tree || !treeDirty) return;
    // If a row insert just queued autoCommit, let that handler run — it
    // applies *everything* (this row's rename + the brand-new row's create)
    // in one shot, then selects the new row. Doing it here too would race
    // for applyingRef and the wrong one would win selectedPath.
    if (autoCommitId) return;
    const wasSelectedHere = selectedPath === row.actualPath;
    const result = await applyRows();
    if (!result.ok || !result.rows) return;
    if (wasSelectedHere) {
      const updated = result.rows.find((r) => r.id === row.id);
      if (updated?.actualPath) setSelectedPath(updated.actualPath);
    }
  }

  // Paste an in-app copied subtree as a sibling immediately after the target
  // row. We re-prefix the snapshot's top folder name with the next available
  // NN_ in the destination parent so it never collides with an existing
  // sibling. Disk write happens via restore_subtree, then we re-read the tree.
  //
  // Pastes are serialized through a promise CHAIN (not a boolean guard): rapid
  // Ctrl+V presses must run one-after-another so each reads the prior paste's
  // result and the NN keeps incrementing. A chain — unlike an "in-flight" flag
  // — can never get stuck: even if one paste rejects, `.catch` clears it so the
  // next still runs. The target path and clipboard are captured at enqueue time
  // so a later copy doesn't change what an already-queued paste will insert.
  const pasteChainRef = useRef<Promise<unknown>>(Promise.resolve());
  function pasteRowSubtree(row: FlatRow) {
    if (!projectRoot) return;
    const clip = treeClipboardRef.current;
    if (!clip) {
      setInfo("Clipboard is empty");
      return;
    }
    if (!row.actualPath) {
      setError("The paste target row is not saved yet");
      return;
    }
    const targetPath = row.actualPath;
    const root = projectRoot;
    pasteChainRef.current = pasteChainRef.current
      .catch(() => {})
      .then(async () => {
        const freshTree = await readTree(root);
        const parent = parentNode(freshTree, targetPath);
        if (!parent) {
          setError("Could not determine the parent folder");
          return;
        }
        const used = new Set<number>();
        for (const c of parent.children) {
          const n = nnOf(basenameOf(c.path));
          if (n != null) used.add(n);
        }
        let next = 1;
        for (const n of used) if (n >= next) next = n + 1;
        const tagPart = clip.name.replace(/^\d+_/, "");
        const reNamed: NodeSnapshot = {
          ...clip,
          name: `${String(next).padStart(2, "0")}_${tagPart}`,
        };
        const newPath = await restoreSubtree(parent.path, reNamed);
        // record so Ctrl+Z removes the pasted subtree
        pushUndo({ type: "create", path: newPath });
        const t = await readTree(root);
        setTree(t);
        const nextView = getViewRoot(t, treeView);
        setRows((cur) => syncRowsFromTree(nextView, cur));
        setTreeDirty(false);
        setSelectedPath(newPath);
        setHighlightSourcePath(null);
        scheduleRebuild();
      })
      .catch((e) => setError(String(e)));
  }

  // Snapshot a row's subtree (element + CSS/CONTENT + all descendants) into
  // the in-app tree clipboard. Used by both the context menu and Ctrl+C.
  async function copyRowToClipboard(row: FlatRow) {
    if (!row.actualPath) {
      setInfo("Cannot copy an unsaved row");
      return;
    }
    try {
      const snap = await snapshotSubtree(row.actualPath);
      treeClipboardRef.current = snap;
      setTreeClipboard(snap);
      const tag = row.name.trim() || "element";
      setInfo(`Copied <${tag}> (paste with Ctrl+V)`);
    } catch (e) {
      setError(String(e));
    }
  }

  // ----- Modules (reusable components) -----

  // Register a row's subtree (DOM + per-element css/js/classes/content) plus
  // the class definitions it references as a named module, appended to (or
  // replaced by name within) a module file. `actualPath` is captured up front
  // so a pending rename doesn't matter — the on-disk folder still exists.
  async function registerModule(
    actualPath: string,
    moduleName: string,
    fileBase: string
  ) {
    if (!projectRoot) return;
    const name = moduleName.trim();
    if (!name) {
      setError(t("Module name is required"));
      return;
    }
    const base = fileBase.trim() || "modules";
    const fileName = /\.ya?ml$/i.test(base) ? base : `${base}.yaml`;
    try {
      const snapshot = await snapshotSubtree(actualPath);
      // Bundle the class definitions the subtree references.
      const used = new Set<string>();
      collectSnapshotClasses(snapshot, used);
      let css = "";
      for (const cn of used) {
        for (const def of classDefs.filter((d) => d.name === cn)) {
          css += `${def.name} {\n${def.properties}\n}\n\n`;
        }
      }
      const existing = moduleFiles.find((f) => f.name === fileName);
      const mods: ModuleDef[] = existing ? [...existing.modules] : [];
      const idx = mods.findIndex((m) => m.name === name);
      const def: ModuleDef = { name, snapshot, css };
      if (idx >= 0) mods[idx] = def;
      else mods.push(def);
      await writeModuleFile(projectRoot, fileName, mods);
      await reloadModules();
      setInfo(`${t("Registered module:")} .${name} → ${fileName}`);
    } catch (e) {
      setError(String(e));
    }
  }

  // Add a module's bundled class definitions to the project. The raw CSS is
  // appended verbatim (so compound selectors like `.x.is-open .y` survive) to
  // a dedicated modules.css, wrapped in module-name markers so re-expanding the
  // same module — even many instances — never duplicates its styles.
  async function injectModuleClasses(moduleName: string, css: string) {
    if (!projectRoot || !css.trim()) return;
    const target = "99_modules.css";
    const existingFile = classFiles.find((f) => f.name === target);
    let content = existingFile?.content ?? "";
    const marker = `/* >>> module: ${moduleName} */`;
    if (content.includes(marker)) return; // already injected
    const block = `${marker}\n${css.trim()}\n/* <<< module: ${moduleName} */\n`;
    if (content && !content.endsWith("\n")) content += "\n";
    content += block;
    await writeClassFile(projectRoot, target, content);
    await reloadClassFiles();
  }

  // Expand a module into the tree at the placeholder row's position. The row
  // where the user typed `.module` becomes the module's root: we delete that
  // placeholder folder, restore the module subtree under the same parent, and
  // inject any missing class definitions. Serialized through the paste chain so
  // it can't race a concurrent paste/expand.
  function expandModuleIntoRow(row: FlatRow, moduleName: string) {
    if (!projectRoot) return;
    const mod = modules.find((m) => m.name === moduleName);
    if (!mod) {
      setInfo(`${t("Module not found:")} ${moduleName}`);
      return;
    }
    // Resolve the parent from the *current* rows: nearest preceding row one
    // level shallower. For a depth-1 placeholder that's the body root.
    const i = rows.findIndex((r) => r.id === row.id);
    let parentPath: string | null = null;
    if (i >= 0) {
      for (let j = i - 1; j >= 0; j--) {
        if (rows[j].depth < row.depth - 1) break;
        if (rows[j].depth === row.depth - 1) {
          parentPath = rows[j].actualPath ?? null;
          break;
        }
      }
    }
    if (!parentPath) {
      setError(t("Save the parent element before expanding a module"));
      return;
    }
    const placeholderPath = row.actualPath;
    const parent = parentPath;
    const root = projectRoot;
    pasteChainRef.current = pasteChainRef.current
      .catch(() => {})
      .then(async () => {
        // Drop the placeholder element folder (the `.module` row) if it was
        // already auto-committed to disk.
        if (placeholderPath) {
          try {
            await deleteNode(placeholderPath);
          } catch {
            /* folder may not exist yet — ignore */
          }
        }
        const fresh = await readTree(root);
        const parentNd = findNodeByPath(fresh, parent);
        if (!parentNd) {
          setError(t("Could not determine the parent folder"));
          return;
        }
        const used = new Set<number>();
        for (const c of parentNd.children) {
          const n = nnOf(basenameOf(c.path));
          if (n != null) used.add(n);
        }
        let next = 1;
        for (const n of used) if (n >= next) next = n + 1;
        const tagPart = mod.snapshot.name.replace(/^\d+_/, "");
        const renamed: NodeSnapshot = {
          ...mod.snapshot,
          name: `${String(next).padStart(2, "0")}_${tagPart}`,
        };
        const newPath = await restoreSubtree(parent, renamed);
        await injectModuleClasses(mod.name, mod.css);
        pushUndo({ type: "create", path: newPath });
        const tNext = await readTree(root);
        setTree(tNext);
        const nextView = getViewRoot(tNext, treeView);
        setRows((cur) => syncRowsFromTree(nextView, cur));
        setTreeDirty(false);
        setSelectedPath(newPath);
        setHighlightSourcePath(null);
        scheduleRebuild();
      })
      .catch((e) => setError(String(e)));
  }

  // FILE → import a module file from elsewhere into this project's modules/.
  async function importModuleFlow() {
    if (!projectRoot) return;
    try {
      const src = await pickModuleFile();
      if (!src) return;
      const name = await importModuleFile(projectRoot, src);
      await reloadModules();
      setInfo(`${t("Imported module file:")} ${name}`);
    } catch (e) {
      setError(String(e));
    }
  }

  // Document-level Ctrl+C / Ctrl+V for the DOM tree. We deliberately scope to
  // when a tree row input is focused (`.tree-rows`): inside the CSS / CONTENT
  // textareas the native text copy/paste must keep working, so we return early
  // there and never call preventDefault. When the tree IS focused we suppress
  // the native clipboard (copy/paste events) so the tag-name text isn't what
  // gets copied/pasted — the whole element subtree is.
  const treeKbdRef = useRef<{
    rows: FlatRow[];
    selectedPath: string | null;
    copy: (row: FlatRow) => void;
    paste: (row: FlatRow) => void;
  }>({ rows: [], selectedPath: null, copy: () => {}, paste: () => {} });
  treeKbdRef.current = {
    rows,
    selectedPath,
    copy: copyRowToClipboard,
    paste: pasteRowSubtree,
  };
  useEffect(() => {
    // Returns the tree row to act on, or null if focus isn't in the DOM tree.
    // Primary signal is the focused row input's data-row-index; if that can't
    // be resolved we fall back to the blue-highlighted (selectedPath) row, so
    // copy/paste still targets the element the user perceives as "selected".
    const focusedTreeRow = (): FlatRow | null => {
      const active = document.activeElement as HTMLElement | null;
      if (!active || !active.closest(".tree-rows")) return null;
      const { rows: curRows, selectedPath: sel } = treeKbdRef.current;
      const idxStr = active.getAttribute("data-row-index");
      if (idxStr != null) {
        const byIdx = curRows[Number(idxStr)];
        if (byIdx) return byIdx;
      }
      if (sel) return curRows.find((r) => r.actualPath === sel) ?? null;
      return null;
    };
    const inTree = () => {
      const active = document.activeElement as HTMLElement | null;
      return !!(active && active.closest(".tree-rows"));
    };
    const onKeyDown = (e: KeyboardEvent) => {
      if (!(e.ctrlKey || e.metaKey) || e.altKey) return;
      const k = e.key.toLowerCase();
      if (k !== "c" && k !== "v") return;
      const row = focusedTreeRow();
      if (!row) return; // focus is in CSS/CONTENT/etc. → native behavior
      if (k === "c") {
        e.preventDefault();
        treeKbdRef.current.copy(row);
      } else {
        e.preventDefault();
        // pasteRowSubtree no-ops with a friendly message if the clipboard
        // (the ref) is empty, so we can intercept unconditionally here.
        treeKbdRef.current.paste(row);
      }
    };
    // Block native clipboard text behavior only while the tree is focused.
    const onClip = (e: ClipboardEvent) => {
      if (inTree()) e.preventDefault();
    };
    document.addEventListener("keydown", onKeyDown, true);
    document.addEventListener("copy", onClip, true);
    document.addEventListener("paste", onClip, true);
    return () => {
      document.removeEventListener("keydown", onKeyDown, true);
      document.removeEventListener("copy", onClip, true);
      document.removeEventListener("paste", onClip, true);
    };
  }, []);

  // Toggle a class membership on the currently selected element.
  // Classes contribute their properties via the BASIN cascade — we never
  // copy them into the element's own CSS field.
  function toggleClassOnElement(rawName: string) {
    const name = rawName.replace(/^\./, "");
    const cur = config.classes ?? [];
    const has = cur.includes(name);
    const next = has ? cur.filter((c) => c !== name) : [...cur, name];
    // Always ensure it's in available_classes too (so it stays visible in the
    // per-element CLASSES section even after toggling off).
    const avail = config.available_classes ?? [];
    const nextAvail = avail.includes(name) ? avail : [...avail, name];
    setConfig((prev) => ({
      ...prev,
      classes: next,
      available_classes: nextAvail,
    }));
    setDirty(true);
    setInfo(has ? `Removed .${name}` : `Applied .${name}`);
  }

  // CLASSES tab: register/unregister a class for this element. Independent of
  // whether it's actually applied — appears as a card the user can later toggle.
  function toggleAvailableClass(rawName: string) {
    const name = rawName.replace(/^\./, "");
    const avail = config.available_classes ?? [];
    const has = avail.includes(name);
    const nextAvail = has ? avail.filter((c) => c !== name) : [...avail, name];
    // If we're removing from the pool, also drop from applied.
    const cur = config.classes ?? [];
    const nextClasses = has ? cur.filter((c) => c !== name) : cur;
    setConfig((prev) => ({
      ...prev,
      classes: nextClasses,
      available_classes: nextAvail,
    }));
    setDirty(true);
    setInfo(has ? `Removed .${name} from the list` : `Added .${name}`);
  }

  // CSS tab CLASSES section: full removal — drops from both available_classes
  // and the applied `classes`.
  function deleteClassFromElement(rawName: string) {
    const name = rawName.replace(/^\./, "");
    setConfig((prev) => ({
      ...prev,
      classes: (prev.classes ?? []).filter((c) => c !== name),
      available_classes: (prev.available_classes ?? []).filter(
        (c) => c !== name
      ),
    }));
    setDirty(true);
    setInfo(`Removed .${name} from the list`);
  }

  // Toggle whether an inherited property is allowed on this element.
  // Disabled props end up emitted as `propname: initial;` in inline style.
  function toggleInheritedProp(prop: string) {
    const cur = config.disabled_inherits ?? [];
    const has = cur.includes(prop);
    const next = has ? cur.filter((p) => p !== prop) : [...cur, prop];
    setConfig((prev) => ({ ...prev, disabled_inherits: next }));
    setDirty(true);
    setInfo(
      has ? `Enabled inheritance of ${prop}` : `Blocked inheritance of ${prop}`
    );
  }

  async function openProjectFlow() {
    const sel = await pickProjectFolder();
    if (sel) await openProject(sel);
  }

  async function newProjectFlow() {
    const sel = await pickProjectFolder();
    if (!sel) return;
    const doctype = window.prompt(
      "Enter the DOCTYPE declaration",
      DEFAULT_DOCTYPE
    );
    if (doctype == null) return;
    try {
      await initProject(sel, doctype || DEFAULT_DOCTYPE);
      await openProject(sel);
      setInfo(`Project created: ${sel}`);
    } catch (e) {
      setError(String(e));
    }
  }

  // Decode: write the current project out as a standalone .html file.
  async function exportHtmlFlow() {
    if (!projectRoot) return;
    try {
      if (treeDirty) {
        const result = await applyRows();
        if (!result.ok) return;
      }
      if (selectedPath && dirty) await saveNow();
      const dest = await pickHtmlSaveTarget();
      if (!dest) return;
      await exportHtml(projectRoot, dest);
      setInfo(`Exported HTML: ${dest}`);
    } catch (e) {
      setError(String(e));
    }
  }

  // Encode: parse an existing .html (+ local .css) into a new HTFL project.
  async function importHtmlFlow() {
    try {
      const htmlFile = await pickHtmlFile();
      if (!htmlFile) return;
      const dest = await pickProjectFolder();
      if (!dest) return;
      const created = await importHtml(htmlFile, dest);
      setInfo(`Imported to HTFL: ${created}`);
      await openProject(created);
    } catch (e) {
      setError(String(e));
    }
  }

  async function reloadPlugins() {
    if (!projectRoot) return;
    try {
      const plg = await readPlugins(projectRoot);
      setPlugins(plg);
      setInfo(`Plugins reloaded: ${plg.length}`);
    } catch (e) {
      setError(String(e));
    }
  }

  // Run a plugin exporter: load its JS, transform the HTFL doc in a worker,
  // save the result to a user-picked file.
  async function runPluginExporter(plugin: LoadedPlugin, exp: ExporterDef) {
    if (!projectRoot || !tree) return;
    if (!ensurePluginConsent()) return;
    try {
      if (treeDirty) {
        const result = await applyRows();
        if (!result.ok) return;
      }
      if (selectedPath && dirty) await saveNow();
      const code = await readPluginScript(plugin.dir, exp.script);
      // Re-read the freshest tree so the export reflects just-saved edits.
      const freshTree = await readTree(projectRoot);
      const doc = {
        tree: freshTree,
        projectConfig,
        classFiles,
      };
      setInfo(`Exporting: ${exp.label}...`);
      const out = await runExporter(code, doc);
      const ext = exp.extension ?? "txt";
      const dest = await pickSaveTarget(`export.${ext}`, ext);
      if (!dest) return;
      await writeTextFile(dest, out);
      setInfo(`Export complete: ${dest}`);
    } catch (e) {
      setError(`Export failed: ${String(e)}`);
    }
  }

  // Plugins execute arbitrary JavaScript (in a Web Worker — which limits DOM
  // access but is NOT a true security sandbox). Gate the first execution
  // behind an explicit, one-time consent so users understand the risk before
  // running third-party code.
  function ensurePluginConsent(): boolean {
    if (localStorage.getItem(PLUGIN_CONSENT_KEY) === "yes") return true;
    const ok = window.confirm(
      "Plugins run arbitrary JavaScript.\n" +
        "They run in a Web Worker, which is not a full sandbox.\n" +
        "Only run plugins from sources you trust.\n\n" +
        "Allow execution? (this confirmation will not be shown again)"
    );
    if (ok) localStorage.setItem(PLUGIN_CONSENT_KEY, "yes");
    return ok;
  }

  // Insert a plugin snippet into the active element's CSS / content.
  function insertSnippet(s: SnippetEntry) {
    if (!selectedPath) {
      setError("Select a target element to insert into");
      return;
    }
    if (s.kind === "content") {
      const cur = config.content ?? "";
      update("content", cur ? `${cur}\n${s.body}` : s.body);
    } else {
      const cur = config.css ?? "";
      const sep = cur.trim() ? "\n" : "";
      update("css", cur.replace(/\n+$/, "") + sep + s.body);
    }
    setInfo(`Snippet inserted: ${s.name}`);
    setShowPluginsModal(false);
  }

  // Apply a plugin class (framework utility) directly to the selected element.
  function applyPluginClass(name: string) {
    if (!selectedPath) {
      setError("Select a target element");
      return;
    }
    const cur = config.classes ?? [];
    const has = cur.includes(name);
    update("classes", has ? cur.filter((c) => c !== name) : [...cur, name]);
    setInfo(has ? `Remove .${name}` : `Apply .${name}`);
  }

  async function refreshTree() {
    if (!projectRoot) return;
    const t = await readTree(projectRoot);
    setTree(t);
    const viewRoot = getViewRoot(t, treeView);
    setRows((prev) => syncRowsFromTree(viewRoot, prev));
    setTreeDirty(false);
  }

  // Switch between BODY and HEAD scope. Flushes pending tree edits first
  // (with confirmation) so the user doesn't silently lose work.
  async function switchTreeView(next: "body" | "head") {
    if (next === treeView) return;
    if (treeDirty) {
      const apply = window.confirm(
        "You have unsaved tree changes. Save before switching? (Cancel = discard and switch)"
      );
      if (apply) {
        const result = await applyRows();
        if (!result.ok) return;
      }
    }
    setTreeView(next);
    setSelectedPath(null);
    if (tree) {
      const viewRoot = getViewRoot(tree, next);
      setRows(syncRowsFromTree(viewRoot));
      setTreeDirty(false);
    }
  }

  async function addChild() {
    const targetPath = selectedPath ?? tree?.path;
    if (!targetPath || !tree) {
      setError(t("Select a parent node"));
      return;
    }
    const tag = window.prompt(t("Tag name to add (e.g. div, section, p)"), "div");
    if (!tag) return;
    const safeTag = tag.trim().replace(/[^a-zA-Z0-9_-]/g, "");
    if (!safeTag) {
      setError(t("Invalid tag name"));
      return;
    }
    const target = findNode(tree, targetPath);
    if (!target) return;
    const prefix = nextOrderPrefix(target.children);
    const folderName = `${prefix}_${safeTag}`;
    try {
      const created = await createNode(targetPath, folderName);
      pushUndo({ type: "create", path: created });
      await refreshTree();
      setSelectedPath(created);
    } catch (e) {
      setError(String(e));
    }
  }

  async function deleteSelected() {
    if (!selectedPath) return;
    const segs = selectedPath.split(/[\\/]/);
    const dispName = segs[segs.length - 1] ?? "";
    if (!window.confirm(`${t("Delete?")}\n${dispName}`)) return;
    try {
      const snapshot = await snapshotSubtree(selectedPath);
      const parent = segs.slice(0, -1).join("\\");
      await deleteNode(selectedPath);
      pushUndo({ type: "delete", parentPath: parent, snapshot });
      setSelectedPath(null);
      await refreshTree();
    } catch (e) {
      setError(String(e));
    }
  }

  async function renameSelected() {
    if (!selectedPath) return;
    const cur = selectedPath.split(/[\\/]/).pop() ?? "";
    const next = window.prompt(t("New folder name"), cur);
    if (!next || next === cur) return;
    try {
      const newPath = await renameNode(selectedPath, next);
      pushUndo({ type: "rename", oldPath: selectedPath, newPath });
      setSelectedPath(newPath);
      await refreshTree();
    } catch (e) {
      setError(String(e));
    }
  }

  function pushUndo(action: UndoAction) {
    // For a "create", remember what was selected *before* the new node existed
    // (selection only moves onto the new node after this push), so undo can
    // restore the user's prior selection rather than clearing it.
    const enriched: UndoAction =
      action.type === "create"
        ? { ...action, prevSelected: action.prevSelected ?? selectedPath }
        : action;
    setUndoStack((prev) => [...prev.slice(-49), enriched]);
    // A brand-new action invalidates the redo history (standard semantics).
    setRedoStack([]);
  }

  async function runUndo() {
    if (undoStack.length === 0) return;
    const last = undoStack[undoStack.length - 1];
    setUndoStack((prev) => prev.slice(0, -1));
    try {
      const inverse = await performInverse(last);
      if (inverse) setRedoStack((prev) => [...prev.slice(-49), inverse]);
      setInfo("Undone");
    } catch (e) {
      setError(String(e));
    }
  }

  async function runRedo() {
    if (redoStack.length === 0) return;
    const last = redoStack[redoStack.length - 1];
    setRedoStack((prev) => prev.slice(0, -1));
    try {
      const inverse = await performInverse(last);
      if (inverse) setUndoStack((prev) => [...prev.slice(-49), inverse]);
      setInfo("Redone");
    } catch (e) {
      setError(String(e));
    }
  }

  // Apply the reversal of `action` to disk and return the action that would
  // reverse *this* operation (i.e. the inverse-of-the-inverse). Undo and redo
  // both funnel through here: runUndo pushes the result onto the redo stack,
  // runRedo pushes it back onto the undo stack. Returns null when the op can't
  // be made reversible (e.g. a subtree we failed to snapshot before deleting).
  async function performInverse(
    action: UndoAction
  ): Promise<UndoAction | null> {
    switch (action.type) {
      case "create": {
        // Reverse a creation by deleting it — but snapshot first so redo can
        // recreate the exact subtree (content + children).
        let snapshot: NodeSnapshot | null = null;
        try {
          snapshot = await snapshotSubtree(action.path);
        } catch {
          snapshot = null;
        }
        const parent = action.path.split(/[\\/]/).slice(0, -1).join("\\");
        await deleteNode(action.path);
        await refreshTree();
        setHighlightSourcePath(null);
        setSelectedPath(action.prevSelected ?? null);
        if (action.prevSelected) setTreeFocusPath(action.prevSelected);
        return snapshot ? { type: "delete", parentPath: parent, snapshot } : null;
      }
      case "delete": {
        const newPath = await restoreSubtree(action.parentPath, action.snapshot);
        await refreshTree();
        setHighlightSourcePath(null);
        setSelectedPath(newPath);
        setTreeFocusPath(newPath);
        return { type: "create", path: newPath };
      }
      case "rename": {
        const newName = action.oldPath.split(/[\\/]/).pop() ?? "";
        const restored = await renameNode(action.newPath, newName);
        await refreshTree();
        setSelectedPath(restored);
        setTreeFocusPath(restored);
        // Inverse of "rename old→new" is "rename new→old" (swap endpoints).
        return { type: "rename", oldPath: action.newPath, newPath: restored };
      }
    }
  }

  async function saveNow() {
    if (!selectedPath) return;
    try {
      const cleaned = cleanForSave(config);
      await writeNode(selectedPath, cleaned);
      setConfig(cleaned);
      setDirty(false);
      setInfo("Saved");
      scheduleRebuild();
    } catch (e) {
      setError(String(e));
    }
  }

  async function openPreview(dev: boolean) {
    if (!projectRoot) return;
    try {
      if (treeDirty) {
        const result = await applyRows();
        if (!result.ok) return;
      }
      if (selectedPath && dirty) await saveNow();
      setDevMode(dev);
      devModeRef.current = dev;
      await buildHtml(projectRoot, dev);
      const url = await previewUrl();
      if (!url) {
        setError("The preview server is not running");
        return;
      }
      await openInBrowser(url, browserPath);
      setInfo(
        dev
          ? "DEV: click an element in the browser to jump to it in the editor"
          : `Opened in browser: ${url}`
      );
    } catch (e) {
      setError(String(e));
    }
  }

  const runBuild = () => openPreview(false);
  const runDev = () => openPreview(true);

  // Quietly rebuild the preview cache so any open browser tab can pick up
  // changes via /__version polling. Debounced — coalesces bursts of saves.
  // Honors the active dev-mode so re-builds stay instrumented.
  const rebuildTimer = useRef<number | null>(null);
  function scheduleRebuild() {
    if (!projectRoot) return;
    if (rebuildTimer.current) window.clearTimeout(rebuildTimer.current);
    rebuildTimer.current = window.setTimeout(() => {
      if (projectRoot) {
        buildHtml(projectRoot, devModeRef.current).catch(() => {});
      }
    }, 250);
  }

  // DEV mode: poll the server for the element the user clicked in the preview,
  // then select it in the editor (switching body/head view + CSS tab).
  useEffect(() => {
    if (!devMode || !projectRoot) return;
    let lastVer = -1;
    let active = true;
    const id = window.setInterval(async () => {
      if (!active) return;
      try {
        const sel = await pollSelection();
        if (sel.path && sel.version !== lastVer) {
          lastVer = sel.version;
          selectFromDev(sel.path);
        }
      } catch {
        /* ignore poll errors */
      }
    }, 400);
    return () => {
      active = false;
      window.clearInterval(id);
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [devMode, projectRoot, tree]);

  // Resolve a path reported by the dev preview to a selection in the editor.
  function selectFromDev(path: string) {
    if (!tree) return;
    const node = findNode(tree, path);
    if (!node) return;
    // Switch to whichever container (body / head) holds the element.
    const head = tree.children.find((c) => c.display_name === "head");
    const inHead =
      !!head &&
      (path === head.path ||
        path.startsWith(head.path + "\\") ||
        path.startsWith(head.path + "/"));
    const targetView: "body" | "head" = inHead ? "head" : "body";
    if (treeView !== targetView) {
      setTreeView(targetView);
      const vr = getViewRoot(tree, targetView);
      setRows(syncRowsFromTree(vr));
      setTreeDirty(false);
    }
    setSelectedPath(path);
    setHighlightSourcePath(null);
    if (activeTab === "classes") {
      setActiveTab("css");
    }
  }

  async function pickBrowser() {
    const sel = await pickBrowserExecutable();
    if (sel == null) return;
    setBrowserPath(sel);
    localStorage.setItem(BROWSER_KEY, sel);
    setInfo(`Preview browser: ${sel}`);
  }

  function clearBrowser() {
    setBrowserPath(null);
    localStorage.removeItem(BROWSER_KEY);
    setInfo("Preview browser reset to default");
  }

  function editVariables() {
    if (!projectRoot) return;
    setShowVarsModal(true);
  }

  async function saveVariables(nextVars: Record<string, string>) {
    if (!projectRoot) return;
    try {
      const cfg = { ...projectConfig, variables: nextVars };
      await writeProjectConfig(projectRoot, cfg);
      setProjectConfig(cfg);
      setInfo("Project variables saved");
      scheduleRebuild();
    } catch (e) {
      setError(String(e));
    }
  }

  // Merge a patch into the project-level <head> config (htfl.yaml). Empty
  // strings are dropped so cleared fields disappear from the YAML.
  async function saveHeadConfig(patch: Partial<HeadConfig>) {
    if (!projectRoot) return;
    const merged: HeadConfig = { ...(projectConfig.head ?? {}), ...patch };
    for (const k of Object.keys(merged) as (keyof HeadConfig)[]) {
      if (!merged[k] || merged[k] === "") delete merged[k];
    }
    const cfg = { ...projectConfig, head: merged };
    try {
      await writeProjectConfig(projectRoot, cfg);
      setProjectConfig(cfg);
      setInfo("HEAD settings saved");
      scheduleRebuild();
    } catch (e) {
      setError(String(e));
    }
  }

  // The <html lang> lives on the HTML/ folder config, not htfl.yaml, so it's
  // saved separately from the head config.
  async function saveHtmlLang(lang: string) {
    if (!projectRoot || !tree) return;
    try {
      const htmlPath = tree.path;
      const cur = await readNode(htmlPath);
      const nextConfig: NodeConfig = {
        ...cur,
        attributes: { ...(cur.attributes ?? {}), lang },
        classes: cur.classes ?? [],
        links: cur.links ?? [],
      };
      await writeNode(htmlPath, cleanForSave(nextConfig));
      scheduleRebuild();
    } catch (e) {
      setError(String(e));
    }
  }

  // Toggle the project-level CSS reset. Undefined defaults to ON, so the
  // first toggle from a fresh project flips to false (browser defaults).
  async function toggleCssReset() {
    if (!projectRoot) return;
    const cur = projectConfig.css_reset !== false;
    const next = !cur;
    const cfg = { ...projectConfig, css_reset: next };
    try {
      await writeProjectConfig(projectRoot, cfg);
      setProjectConfig(cfg);
      setInfo(
        next
          ? "CSS reset: ON (clears margin / padding / list-style etc.)"
          : "CSS reset: OFF (back to browser default styles)"
      );
      scheduleRebuild();
    } catch (e) {
      setError(String(e));
    }
  }

  // Switch the UI language. English is the default; "ja" activates the
  // Japanese language pack. Persisted so the next launch starts localized.
  function changeLocale(next: "en" | "ja") {
    setLocale(next);
    localStorage.setItem(LOCALE_KEY, next);
    setLocaleDict(next === "ja" ? ja : null);
  }

  // Switch the code-editor color theme (background + syntax colors). Applied
  // via <html data-editor-theme> so the CSS variables cascade.
  function changeEditorTheme(next: EditorTheme) {
    setEditorTheme(next);
    localStorage.setItem(EDITOR_THEME_KEY, next);
    document.documentElement.setAttribute("data-editor-theme", next);
  }

  // Output mode: "ssr+js" (default, emits the SCRIPT/JS layer) ⇄ "ssr"
  // (static only — page works with JavaScript disabled).
  async function setOutputMode(mode: "ssr" | "ssr+js") {
    if (!projectRoot) return;
    const cfg = { ...projectConfig, output_mode: mode };
    try {
      await writeProjectConfig(projectRoot, cfg);
      setProjectConfig(cfg);
      setInfo(
        mode === "ssr"
          ? "Output mode: SSR (static, displays without JS)"
          : "Output mode: SSR + JS (dynamic, emits SCRIPT)"
      );
      scheduleRebuild();
    } catch (e) {
      setError(String(e));
    }
  }

  async function editDoctype() {
    if (!projectRoot) return;
    const cur = projectConfig.doctype ?? DEFAULT_DOCTYPE;
    const next = window.prompt("DOCTYPE declaration", cur);
    if (next == null) return;
    try {
      const cfg = { ...projectConfig, doctype: next };
      await writeProjectConfig(projectRoot, cfg);
      setProjectConfig(cfg);
    } catch (e) {
      setError(String(e));
    }
  }

  // The <html> element is hidden from the DOM tree (it's only ever a
  // container), so its `lang` attribute is exposed via a menu prompt.
  async function editHtmlAttrs() {
    if (!projectRoot || !tree) return;
    try {
      const htmlPath = tree.path; // tree IS the HTML/ folder
      const cur = await readNode(htmlPath);
      const curLang = cur.attributes?.lang ?? "ja";
      const nextLang = window.prompt("<html lang=\"...\">", curLang);
      if (nextLang == null) return;
      const nextAttrs = { ...(cur.attributes ?? {}), lang: nextLang };
      const nextConfig: NodeConfig = {
        ...cur,
        attributes: nextAttrs,
        classes: cur.classes ?? [],
        links: cur.links ?? [],
      };
      await writeNode(htmlPath, cleanForSave(nextConfig));
      setInfo(`Set <html lang="${nextLang}">`);
    } catch (e) {
      setError(String(e));
    }
  }

  const breadcrumbSegments = useMemo(() => {
    if (!tree || !selectedPath) return [];
    const p = findPath(tree, selectedPath);
    if (!p) return [];
    return p.map((n, i) => (i === 0 ? "HTML" : n.display_name));
  }, [tree, selectedPath]);

  function update<K extends keyof NodeConfig>(key: K, value: NodeConfig[K]) {
    setConfig((prev) => ({ ...prev, [key]: value }));
    setDirty(true);
  }

  return (
    <div className="app">
      <MenuBar
        menu={menu}
        setMenu={setMenu}
        onOpen={openProjectFlow}
        onNew={newProjectFlow}
        onSave={saveNow}
        onExportHtml={exportHtmlFlow}
        onImportHtml={importHtmlFlow}
        onImportModule={importModuleFlow}
        onAddChild={addChild}
        onDelete={deleteSelected}
        onRename={renameSelected}
        onEditVariables={editVariables}
        onEditDoctype={editDoctype}
        onEditHtmlAttrs={editHtmlAttrs}
        onEditHeadDefault={() => setShowHeadDefault(true)}
        onEditHeadProjectTags={() => setShowHeadProjectTags(true)}
        onToggleCssReset={toggleCssReset}
        cssResetOn={projectConfig.css_reset !== false}
        onOpenClasses={() => setActiveTab("classes")}
        onReload={() => window.location.reload()}
        onPickBrowser={pickBrowser}
        onClearBrowser={clearBrowser}
        browserPath={browserPath}
        plugins={plugins}
        onOpenPlugins={() => setShowPluginsModal(true)}
        onReloadPlugins={reloadPlugins}
        onRunExporter={runPluginExporter}
        canEdit={!!selectedPath}
        canSave={!!selectedPath && dirty}
        canUndo={undoStack.length > 0}
        onUndo={runUndo}
        canRedo={redoStack.length > 0}
        onRedo={runRedo}
        onOpenSettings={() => setShowSettings(true)}
        onOpenShortcuts={() => setShowShortcuts(true)}
        onOpenAbout={() => setShowAbout(true)}
        onOpenChangelog={() => setShowChangelog(true)}
        onOpenSearch={() => setShowSearch(true)}
        hasProject={!!projectRoot}
      />
      {projectRoot ? (
        <div className="workspace">
          <TreeEditorPanel
            tree={tree}
            projectRoot={projectRoot}
            rows={rows}
            onChangeRows={(newRows) => {
              setRows(newRows);
              setTreeDirty(true);
            }}
            selectedPath={selectedPath}
            highlightSourcePath={highlightSourcePath}
            onSelect={(p) => {
              setSelectedPath(p);
              setHighlightSourcePath(null);
            }}
            onSelectRow={selectRow}
            onAutoCommitRow={setAutoCommitId}
            onCommitRowEdit={commitRowEdit}
            onCopySubtree={copyRowToClipboard}
            onPasteSubtree={pasteRowSubtree}
            onEditRow={openElementEditor}
            moduleNames={moduleNames}
            onExpandModule={expandModuleIntoRow}
            onRegisterModule={(row) => setModuleRegisterRow(row)}
            hasClipboard={treeClipboard !== null}
            focusPath={treeFocusPath}
            onFocused={() => setTreeFocusPath(null)}
            treeView={treeView}
            onChangeTreeView={switchTreeView}
          />
          <EditorPanel
            selectedPath={selectedPath}
            breadcrumb={breadcrumbSegments}
            activeTab={activeTab}
            setActiveTab={setActiveTab}
            config={config}
            update={update}
            onRun={runBuild}
            onDev={runDev}
            devMode={devMode}
            dirty={dirty}
            inherited={inherited}
            basin={basin}
            onHighlightSource={setHighlightSourcePath}
            variables={projectConfig.variables ?? {}}
            classFiles={classFiles}
            classDefs={classDefs}
            selectedClassFile={selectedClassFile}
            onSelectClassFile={setSelectedClassFile}
            classFileContent={classFileContent}
            onChangeClassFileContent={(v) => {
              setClassFileContent(v);
              setClassFileDirty(true);
            }}
            classFileDirty={classFileDirty}
            onAddClassFile={addClassFile}
            onDeleteClassFile={removeClassFile}
            onToggleClass={toggleClassOnElement}
            onDeleteClassFromElement={deleteClassFromElement}
            onToggleAvailableClass={toggleAvailableClass}
            onToggleInherited={toggleInheritedProp}
            appliedClassNames={config.classes ?? []}
            imageFolders={imageFolders}
            selectedImageFolder={selectedImageFolder}
            onSelectImageFolder={setSelectedImageFolder}
            previewBaseUrl={previewBaseUrl}
            onApplyImage={applyImageToElement}
            onReloadImages={reloadImageFolders}
          />
        </div>
      ) : (
        <EmptyState onOpen={openProjectFlow} onNew={newProjectFlow} />
      )}
      {preview != null && (
        <PreviewModal html={preview} onClose={() => setPreview(null)} />
      )}
      {showPluginsModal && (
        <PluginsModal
          plugins={plugins}
          hasSelection={!!selectedPath}
          appliedClasses={config.classes ?? []}
          onClose={() => setShowPluginsModal(false)}
          onReload={reloadPlugins}
          onRunExporter={runPluginExporter}
          onInsertSnippet={insertSnippet}
          onApplyClass={applyPluginClass}
        />
      )}
      {showVarsModal && (
        <VariablesModal
          initial={projectConfig.variables ?? {}}
          onClose={() => setShowVarsModal(false)}
          onSave={async (vars) => {
            await saveVariables(vars);
            setShowVarsModal(false);
          }}
        />
      )}
      {moduleRegisterRow && (
        <ModuleRegisterModal
          tagLabel={moduleRegisterRow.name.trim() || "element"}
          defaultFileBase={
            projectRoot ? basenameOf(projectRoot) || "modules" : "modules"
          }
          existingFiles={moduleFiles.map((f) => f.name)}
          onClose={() => setModuleRegisterRow(null)}
          onSubmit={(moduleName, fileBase) => {
            const path = moduleRegisterRow.actualPath;
            setModuleRegisterRow(null);
            if (!path) {
              setInfo(t("Save the element before registering it as a module"));
              return;
            }
            registerModule(path, moduleName, fileBase);
          }}
        />
      )}
      {elementEdit && selectedPath && (
        <ElementEditModal
          lineNumber={elementEdit.lineNumber}
          tag={(
            config.tag ??
            rows.find((r) => r.actualPath === selectedPath)?.name ??
            ""
          ).toLowerCase()}
          config={config}
          update={update}
          imageFolders={imageFolders}
          selectedImageFolder={selectedImageFolder}
          onSelectImageFolder={setSelectedImageFolder}
          previewBaseUrl={previewBaseUrl}
          onApplyImage={applyImageToElement}
          onReloadImages={reloadImageFolders}
          onClose={() => setElementEdit(null)}
        />
      )}
      {showHeadDefault && (
        <HeadDefaultModal
          head={projectConfig.head ?? {}}
          lang={htmlLang}
          onClose={() => setShowHeadDefault(false)}
          onSave={async (patch, lang) => {
            await saveHeadConfig(patch);
            if (lang !== htmlLang) {
              setHtmlLang(lang);
              await saveHtmlLang(lang);
            }
            setShowHeadDefault(false);
          }}
        />
      )}
      {showHeadProjectTags && (
        <HeadProjectTagsModal
          head={projectConfig.head ?? {}}
          onClose={() => setShowHeadProjectTags(false)}
          onSave={async (patch) => {
            await saveHeadConfig(patch);
            setShowHeadProjectTags(false);
          }}
        />
      )}
      {error && (
        <div
          className="toast toast-error"
          role="alert"
          onClick={() => setError(null)}
          title="Click to dismiss"
        >
          ⚠ {error}
        </div>
      )}
      {info && !error && (
        <div
          className="toast toast-info"
          role="status"
          aria-live="polite"
          onClick={() => setInfo(null)}
        >
          {info}
        </div>
      )}
      {showSettings && (
        <SettingsModal
          cssResetOn={(projectConfig.css_reset ?? true) !== false}
          outputMode={projectConfig.output_mode === "ssr" ? "ssr" : "ssr+js"}
          onSetOutputMode={setOutputMode}
          locale={locale}
          onSetLocale={changeLocale}
          editorTheme={editorTheme}
          onSetEditorTheme={changeEditorTheme}
          hasProject={!!projectRoot}
          browserPath={browserPath}
          onToggleCssReset={toggleCssReset}
          onPickBrowser={pickBrowser}
          onClearBrowser={clearBrowser}
          onResetPluginConsent={() => {
            localStorage.removeItem(PLUGIN_CONSENT_KEY);
            setInfo("Plugin execution permission reset");
          }}
          onClose={() => setShowSettings(false)}
        />
      )}
      {showShortcuts && (
        <ShortcutsModal onClose={() => setShowShortcuts(false)} />
      )}
      {showAbout && <AboutModal onClose={() => setShowAbout(false)} />}
      {showChangelog && (
        <ChangelogModal
          text={changelogText}
          onClose={() => setShowChangelog(false)}
        />
      )}
      {showSearch && tree && (
        <SearchModal
          tree={tree}
          onJump={(p) => {
            setSelectedPath(p);
            setHighlightSourcePath(null);
            setTreeFocusPath(p);
            setShowSearch(false);
          }}
          onClose={() => setShowSearch(false)}
        />
      )}
    </div>
  );
}

function MenuBar(props: {
  menu: "file" | "edit" | "view" | "window" | "plugins" | "help" | null;
  setMenu: (
    m: "file" | "edit" | "view" | "window" | "plugins" | "help" | null
  ) => void;
  onOpen: () => void;
  onNew: () => void;
  onSave: () => void;
  onExportHtml: () => void;
  onImportHtml: () => void;
  onImportModule: () => void;
  onAddChild: () => void;
  onDelete: () => void;
  onRename: () => void;
  onUndo: () => void;
  onRedo: () => void;
  onEditVariables: () => void;
  onEditDoctype: () => void;
  onEditHtmlAttrs: () => void;
  onToggleCssReset: () => void;
  cssResetOn: boolean;
  onOpenClasses: () => void;
  onReload: () => void;
  onPickBrowser: () => void;
  onClearBrowser: () => void;
  browserPath: string | null;
  plugins: LoadedPlugin[];
  onOpenPlugins: () => void;
  onReloadPlugins: () => void;
  onRunExporter: (plugin: LoadedPlugin, exp: ExporterDef) => void;
  onOpenSettings: () => void;
  onOpenShortcuts: () => void;
  onOpenAbout: () => void;
  onOpenChangelog: () => void;
  onOpenSearch: () => void;
  onEditHeadDefault: () => void;
  onEditHeadProjectTags: () => void;
  canEdit: boolean;
  canSave: boolean;
  canUndo: boolean;
  canRedo: boolean;
  hasProject: boolean;
}) {
  const close = () => props.setMenu(null);
  return (
    <div className="menubar" onClick={close}>
      <MenuItem
        label={t("FILE")}
        open={props.menu === "file"}
        anyOpen={props.menu !== null}
        onOpen={() => props.setMenu(props.menu === "file" ? null : "file")}
        onHover={() => props.setMenu("file")}
      >
        <MenuOption onClick={props.onNew}>{t("New Project...")}</MenuOption>
        <MenuOption onClick={props.onOpen}>{t("Open Project...")}</MenuOption>
        <MenuOption onClick={props.onSave} disabled={!props.canSave}>
          {t("Save (Ctrl+S)")}
        </MenuOption>
        <div className="menu-divider" />
        <div className="menu-section-label">HEAD</div>
        <MenuOption
          onClick={props.onEditHeadDefault}
          disabled={!props.hasProject}
        >
          {t("DEFAULT (charset / viewport / lang)...")}
        </MenuOption>
        <MenuOption
          onClick={props.onEditHeadProjectTags}
          disabled={!props.hasProject}
        >
          {t("PROJECT TAGS (title / description / OGP / favicon)...")}
        </MenuOption>
        <div className="menu-divider" />
        <MenuOption onClick={props.onImportHtml}>
          {t("Import HTML... (→ HTFL)")}
        </MenuOption>
        <MenuOption onClick={props.onExportHtml} disabled={!props.hasProject}>
          {t("Export HTML... (HTFL →)")}
        </MenuOption>
        <div className="menu-divider" />
        <MenuOption onClick={props.onImportModule} disabled={!props.hasProject}>
          {t("Import module file...")}
        </MenuOption>
      </MenuItem>
      <MenuItem
        label={t("EDIT")}
        open={props.menu === "edit"}
        anyOpen={props.menu !== null}
        onOpen={() => props.setMenu(props.menu === "edit" ? null : "edit")}
        onHover={() => props.setMenu("edit")}
      >
        <MenuOption onClick={props.onUndo} disabled={!props.canUndo}>
          {t("Undo (Ctrl+Z)")}
        </MenuOption>
        <MenuOption onClick={props.onRedo} disabled={!props.canRedo}>
          {t("Redo (Ctrl+Y)")}
        </MenuOption>
        <MenuOption onClick={props.onAddChild} disabled={!props.hasProject}>
          {t("Add child...")}
        </MenuOption>
        <MenuOption onClick={props.onRename} disabled={!props.canEdit}>
          {t("Rename...")}
        </MenuOption>
        <MenuOption onClick={props.onDelete} disabled={!props.canEdit}>
          {t("Delete...")}
        </MenuOption>
        <div className="menu-divider" />
        <MenuOption onClick={props.onOpenSearch} disabled={!props.hasProject}>
          {t("Search... (Ctrl+Shift+F)")}
        </MenuOption>
      </MenuItem>
      <MenuItem
        label={t("VIEW")}
        open={props.menu === "view"}
        anyOpen={props.menu !== null}
        onOpen={() => props.setMenu(props.menu === "view" ? null : "view")}
        onHover={() => props.setMenu("view")}
      >
        <MenuOption onClick={props.onOpenClasses} disabled={!props.hasProject}>
          {t("Edit class files...")}
        </MenuOption>
        <MenuOption onClick={props.onEditDoctype} disabled={!props.hasProject}>
          {t("Edit DOCTYPE...")}
        </MenuOption>
        <MenuOption onClick={props.onEditHtmlAttrs} disabled={!props.hasProject}>
          {t("Edit <html> attributes...")}
        </MenuOption>
        <MenuOption onClick={props.onEditVariables} disabled={!props.hasProject}>
          {t("Edit project variables...")}
        </MenuOption>
        <MenuOption onClick={props.onToggleCssReset} disabled={!props.hasProject}>
          {t("CSS reset")}:{" "}
          {props.cssResetOn ? t("ON ✓") : t("OFF (browser default)")}
        </MenuOption>
      </MenuItem>
      <MenuItem
        label={t("WINDOW")}
        open={props.menu === "window"}
        anyOpen={props.menu !== null}
        onOpen={() => props.setMenu(props.menu === "window" ? null : "window")}
        onHover={() => props.setMenu("window")}
      >
        <MenuOption onClick={props.onReload}>{t("Reload")}</MenuOption>
        <MenuOption onClick={props.onPickBrowser}>
          {t("Choose preview browser...")}
          {props.browserPath ? " ✓" : ""}
        </MenuOption>
        <MenuOption
          onClick={props.onClearBrowser}
          disabled={!props.browserPath}
        >
          {t("Reset to default browser")}
        </MenuOption>
        <div className="menu-divider" />
        <MenuOption onClick={props.onOpenSettings}>
          {t("Settings...")}
        </MenuOption>
      </MenuItem>
      <MenuItem
        label={t("PLUGINS")}
        open={props.menu === "plugins"}
        anyOpen={props.menu !== null}
        onOpen={() =>
          props.setMenu(props.menu === "plugins" ? null : "plugins")
        }
        onHover={() => props.setMenu("plugins")}
      >
        <MenuOption onClick={props.onOpenPlugins} disabled={!props.hasProject}>
          {t("Manage plugins...")} ({props.plugins.length})
        </MenuOption>
        <MenuOption onClick={props.onReloadPlugins} disabled={!props.hasProject}>
          {t("Reload plugins")}
        </MenuOption>
        {props.plugins.flatMap((p) =>
          (p.manifest.exporters ?? []).map((exp) => (
            <MenuOption
              key={`${p.dir_name}:${exp.id}`}
              onClick={() => props.onRunExporter(p, exp)}
            >
              ▶ {exp.label}
            </MenuOption>
          ))
        )}
      </MenuItem>
      <MenuItem
        label={t("HELP")}
        open={props.menu === "help"}
        anyOpen={props.menu !== null}
        onOpen={() => props.setMenu(props.menu === "help" ? null : "help")}
        onHover={() => props.setMenu("help")}
      >
        <MenuOption onClick={props.onOpenShortcuts}>
          {t("Keyboard shortcuts...")}
        </MenuOption>
        <MenuOption onClick={props.onOpenChangelog}>
          {t("Changelog...")}
        </MenuOption>
        <MenuOption onClick={props.onOpenAbout}>{t("About Foling...")}</MenuOption>
      </MenuItem>
    </div>
  );
}

function MenuItem(props: {
  label: string;
  open: boolean;
  /** True when *some* top-level menu is currently open. */
  anyOpen: boolean;
  onOpen: () => void;
  /** Switch to this menu (used for hover-to-open once a menu is open). */
  onHover: () => void;
  children: React.ReactNode;
}) {
  return (
    <div
      className={`menu-item ${props.open ? "open" : ""}`}
      onClick={(e) => {
        e.stopPropagation();
        props.onOpen();
      }}
      // VSCode-style: once a menu is open, hovering another top item opens it.
      onMouseEnter={() => {
        if (props.anyOpen && !props.open) props.onHover();
      }}
    >
      <span>{props.label}</span>
      {props.open && (
        <div className="menu-dropdown" onClick={(e) => e.stopPropagation()}>
          {props.children}
        </div>
      )}
    </div>
  );
}

function MenuOption(props: {
  children: React.ReactNode;
  onClick: () => void;
  disabled?: boolean;
}) {
  return (
    <div
      className={`menu-option ${props.disabled ? "disabled" : ""}`}
      onClick={() => {
        if (!props.disabled) props.onClick();
      }}
    >
      {props.children}
    </div>
  );
}

function EmptyState(props: { onOpen: () => void; onNew: () => void }) {
  return (
    <div className="empty-state">
      <h1>Foling</h1>
      <p>{t("HTFL (HyperText Foldering Language) project")}</p>
      <div className="empty-actions">
        <button className="primary" onClick={props.onNew}>
          {t("New project")}
        </button>
        <button className="secondary" onClick={props.onOpen}>
          {t("Open existing project")}
        </button>
      </div>
    </div>
  );
}

interface ContextMenuState {
  rowIndex: number;
  x: number;
  y: number;
}

interface RowAcState {
  rowIndex: number;
  /** "tag" completes the tag name in place; "module" expands a module. */
  kind: "tag" | "module";
  items: string[];
  selectedIndex: number;
  prefix: string;
  popupTop: number;
  popupLeft: number;
}

function TreeEditorPanel(props: {
  tree: TreeNode | null;
  projectRoot: string;
  rows: FlatRow[];
  onChangeRows: (rows: FlatRow[]) => void;
  selectedPath: string | null;
  highlightSourcePath: string | null;
  onSelect: (p: string) => void;
  /** Called when user focuses a row's input. The parent (App) decides
   *  whether to auto-apply pending edits and then update the selected path. */
  onSelectRow: (row: FlatRow) => void;
  /** Queue the given row id for auto-apply + auto-select. Parent watches this
   *  via an effect; we just enqueue and let React batch the row state update
   *  with the id so the apply sees the fresh rows. */
  onAutoCommitRow: (id: string) => void;
  /** Blur of a row — parent flushes pending rename if treeDirty. */
  onCommitRowEdit: (row: FlatRow) => void;
  /** Snapshot the row's subtree into the in-app clipboard. */
  onCopySubtree: (row: FlatRow) => void;
  /** Restore the clipboard subtree as a sibling of `row`. */
  onPasteSubtree: (row: FlatRow) => void;
  /** Open the element editor (content / image / attributes) for a row.
   *  `lineNumber` is the row's 1-based line = the element's id. */
  onEditRow: (row: FlatRow, lineNumber: number) => void;
  /** Module names available for `.module` autocomplete in the tree. */
  moduleNames: string[];
  /** Expand the named module into the tree, replacing `row`. */
  onExpandModule: (row: FlatRow, moduleName: string) => void;
  /** Register the row's subtree as a reusable module (opens the modal). */
  onRegisterModule: (row: FlatRow) => void;
  /** True if there's a subtree on the clipboard available to paste. */
  hasClipboard: boolean;
  /** When set, focus the row whose actualPath matches (e.g. after undo, to
   *  put the cursor back on the restored selection). Cleared via onFocused. */
  focusPath: string | null;
  onFocused: () => void;
  treeView: "body" | "head";
  onChangeTreeView: (v: "body" | "head") => void;
}) {
  const [contextMenu, setContextMenu] = useState<ContextMenuState | null>(
    null
  );
  const [ac, setAc] = useState<RowAcState | null>(null);
  // One-shot focus request — set when an action wants a specific row's
  // input to gain focus on the next render.
  const [pendingFocusId, setPendingFocusId] = useState<string | null>(null);

  const visible = useMemo(() => getVisibleRows(props.rows), [props.rows]);

  useEffect(() => {
    if (!contextMenu) return;
    const onClick = () => setContextMenu(null);
    window.addEventListener("click", onClick);
    return () => window.removeEventListener("click", onClick);
  }, [contextMenu]);

  // Dismiss the tag-name autocomplete on any pointerdown outside the popup
  // itself (matches the behavior in the CSS / class-file editors).
  useEffect(() => {
    if (!ac) return;
    const onDown = (e: MouseEvent) => {
      const t = e.target as HTMLElement | null;
      if (!t) return;
      if (t.closest(".ac-popup")) return;
      setAc(null);
    };
    document.addEventListener("mousedown", onDown, true);
    return () => document.removeEventListener("mousedown", onDown, true);
  }, [ac]);

  // After render, clear the pending focus token (the row has been focused
  // through its own useEffect).
  useEffect(() => {
    if (pendingFocusId) {
      const t = window.setTimeout(() => setPendingFocusId(null), 50);
      return () => window.clearTimeout(t);
    }
  }, [pendingFocusId]);

  // Parent requested focus on a specific element (by path). Resolve it to the
  // matching row id so its input gains focus, then tell the parent it's done.
  useEffect(() => {
    if (!props.focusPath) return;
    const row = props.rows.find((r) => r.actualPath === props.focusPath);
    if (row) setPendingFocusId(row.id);
    props.onFocused();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [props.focusPath, props.rows]);

  function mutateRow(i: number, patch: Partial<FlatRow>) {
    const next = props.rows.map((r, idx) =>
      idx === i ? { ...r, ...patch } : r
    );
    props.onChangeRows(next);
  }

  function toggleCollapse(i: number) {
    mutateRow(i, { collapsed: !props.rows[i].collapsed });
  }

  function insertRowAt(at: number, depth: number): string {
    const id = newRowId();
    // Seed with "div" so the row has something to write to disk on auto-commit.
    // The input gets focused with text selected (TreeRowComponent does the
    // select-all on focus), so the user can immediately type to overwrite.
    const newRow: FlatRow = {
      id,
      depth: Math.max(0, depth),
      name: "div",
      collapsed: false,
    };
    const next = [
      ...props.rows.slice(0, at),
      newRow,
      ...props.rows.slice(at),
    ];
    props.onChangeRows(next);
    setPendingFocusId(id);
    props.onAutoCommitRow(id);
    return id;
  }

  function addChildBelow(i: number) {
    const cur = props.rows[i];
    if (cur.collapsed) mutateRow(i, { collapsed: false });
    insertRowAt(i + 1, cur.depth + 1);
  }

  function addSiblingBelow(i: number) {
    const cur = props.rows[i];
    const [, end] = findSubtreeRange(props.rows, i);
    insertRowAt(end, cur.depth);
  }

  function outdentRow(i: number) {
    const cur = props.rows[i];
    if (cur.depth <= 0) return;
    mutateRow(i, { depth: cur.depth - 1 });
  }

  function indentRow(i: number) {
    const cur = props.rows[i];
    const prev = props.rows[i - 1];
    const maxDepth = prev ? prev.depth + 1 : 0;
    const target = Math.min(cur.depth + 1, maxDepth);
    if (target !== cur.depth) mutateRow(i, { depth: target });
  }

  function deleteRow(i: number) {
    const [start, end] = findSubtreeRange(props.rows, i);
    const next = [...props.rows.slice(0, start), ...props.rows.slice(end)];
    props.onChangeRows(next);
  }

  function copyRowSubtree(i: number) {
    const r = props.rows[i];
    // Delegate to the parent — it owns the in-app clipboard. We deliberately
    // avoid the OS clipboard for subtree snapshots: dropping raw JSON into
    // the global clipboard means a stray Ctrl+V into any text input renders
    // a broken "{\"name\":..." string as that input's value.
    props.onCopySubtree(r);
  }

  function pasteRowSubtree(i: number) {
    const r = props.rows[i];
    if (!props.hasClipboard) return;
    props.onPasteSubtree(r);
  }

  function computeAcForInput(rowIndex: number, input: HTMLInputElement) {
    const value = input.value;
    const cursor = input.selectionStart ?? value.length;
    const upto = value.slice(0, cursor);
    const rect = input.getBoundingClientRect();

    // Module mode: a row whose whole content is `.something` references a
    // module. Suggest module names (all of them while only "." is typed).
    const modMatch = /^\.([a-zA-Z0-9_-]*)$/.exec(value.trim());
    if (modMatch) {
      if (props.moduleNames.length === 0) {
        setAc(null);
        return;
      }
      const prefix = modMatch[1];
      const items = prefix
        ? rankByFuzzy(prefix, props.moduleNames, (n) => n, 12)
        : props.moduleNames.slice(0, 12);
      if (items.length === 0) {
        setAc(null);
        return;
      }
      setAc({
        rowIndex,
        kind: "module",
        items,
        selectedIndex: 0,
        prefix,
        popupTop: rect.bottom + 2,
        popupLeft: rect.left,
      });
      return;
    }

    const m = /([a-zA-Z][a-zA-Z0-9_-]*)$/.exec(upto);
    if (!m || m[1].length === 0) {
      setAc(null);
      return;
    }
    const prefix = m[1];
    const items = rankByFuzzy(prefix, HTML_TAGS, (t) => t, 12);
    if (items.length === 0) {
      setAc(null);
      return;
    }
    setAc({
      rowIndex,
      kind: "tag",
      items,
      selectedIndex: 0,
      prefix,
      popupTop: rect.bottom + 2,
      popupLeft: rect.left,
    });
  }

  function acceptAcCompletion(rowIndex: number, item: string) {
    // Module mode: expand the named module in place of this row instead of
    // completing tag-name text. The parent re-reads the tree afterward.
    if (ac?.kind === "module") {
      setAc(null);
      props.onExpandModule(props.rows[rowIndex], item);
      return;
    }
    const input = document.querySelector<HTMLInputElement>(
      `input[data-row-index="${rowIndex}"]`
    );
    if (!input) return;
    const value = props.rows[rowIndex].name;
    const cursor = input.selectionStart ?? value.length;
    const m = /([a-zA-Z][a-zA-Z0-9_-]*)$/.exec(value.slice(0, cursor));
    if (!m) return;
    const start = cursor - m[1].length;
    const newValue = value.slice(0, start) + item + value.slice(cursor);
    mutateRow(rowIndex, { name: newValue });
    setAc(null);
    window.setTimeout(() => {
      input.focus();
      const pos = start + item.length;
      input.setSelectionRange(pos, pos);
    }, 0);
  }

  function handleRowKeyDown(
    e: React.KeyboardEvent<HTMLInputElement>,
    rowIndex: number
  ) {
    const input = e.currentTarget;
    // Autocomplete navigation has priority
    if (ac && ac.rowIndex === rowIndex) {
      if (e.key === "ArrowDown") {
        e.preventDefault();
        setAc({
          ...ac,
          selectedIndex: (ac.selectedIndex + 1) % ac.items.length,
        });
        return;
      }
      if (e.key === "ArrowUp") {
        e.preventDefault();
        setAc({
          ...ac,
          selectedIndex:
            (ac.selectedIndex - 1 + ac.items.length) % ac.items.length,
        });
        return;
      }
      if (e.key === "Escape") {
        e.preventDefault();
        setAc(null);
        return;
      }
      if (e.key === "Tab" || (e.key === "Enter" && !e.shiftKey)) {
        e.preventDefault();
        acceptAcCompletion(rowIndex, ac.items[ac.selectedIndex]);
        return;
      }
    }

    // Enter — Shift+Enter — Backspace — Tab — Arrow up/down
    if (e.key === "Enter") {
      e.preventDefault();
      const trimmed = input.value.trim();
      if (!e.shiftKey) {
        addChildBelow(rowIndex);
      } else if (trimmed === "") {
        outdentRow(rowIndex);
        setPendingFocusId(props.rows[rowIndex].id);
      } else {
        addSiblingBelow(rowIndex);
      }
      return;
    }
    if (e.key === "Tab") {
      e.preventDefault();
      if (e.shiftKey) outdentRow(rowIndex);
      else indentRow(rowIndex);
      setPendingFocusId(props.rows[rowIndex].id);
      return;
    }
    if (e.key === "Backspace" && input.value === "") {
      e.preventDefault();
      // Empty row + Backspace: step the indent down first; at depth 0 we
      // remove only THIS empty row (not its subtree — using deleteRow there
      // would sweep every following deeper row, looking to the user like
      // "everything below disappeared").
      if (props.rows[rowIndex].depth > 0) {
        outdentRow(rowIndex);
        setPendingFocusId(props.rows[rowIndex].id);
      } else {
        if (props.rows.length <= 1) return;
        const prev = props.rows[rowIndex - 1];
        const next = [
          ...props.rows.slice(0, rowIndex),
          ...props.rows.slice(rowIndex + 1),
        ];
        props.onChangeRows(next);
        if (prev) setPendingFocusId(prev.id);
      }
      return;
    }
    if (e.key === "ArrowDown" && !e.altKey && !e.ctrlKey && !e.metaKey) {
      const cur = visible.findIndex((v) => v.index === rowIndex);
      if (cur >= 0 && cur < visible.length - 1) {
        e.preventDefault();
        setPendingFocusId(visible[cur + 1].row.id);
      }
      return;
    }
    if (e.key === "ArrowUp" && !e.altKey && !e.ctrlKey && !e.metaKey) {
      const cur = visible.findIndex((v) => v.index === rowIndex);
      if (cur > 0) {
        e.preventDefault();
        setPendingFocusId(visible[cur - 1].row.id);
      }
      return;
    }
  }

  function handleRowInputChange(
    e: React.ChangeEvent<HTMLInputElement>,
    rowIndex: number
  ) {
    mutateRow(rowIndex, { name: e.target.value });
    computeAcForInput(rowIndex, e.target);
  }

  function handleRowFocus(rowIndex: number) {
    const r = props.rows[rowIndex];
    // Defer to the parent — it knows whether a not-yet-applied row needs
    // a tree flush before it can be selected.
    props.onSelectRow(r);
  }

  // Commit on blur. Two cases:
  //   • brand-new row (no actualPath) → ask parent to apply + select.
  //   • existing row whose tag-name was just edited → ask parent to flush
  //     the rename so the disk folder NN_<tag> updates and the right-pane
  //     stays pointed at the right element.
  function handleRowCommit(rowIndex: number) {
    const r = props.rows[rowIndex];
    if (!r || r.name.trim() === "") return;
    // A `.…` row is a module reference, not a tag. On blur, expand it if it
    // names a known module; either way never persist a `.`-row as an element.
    if (r.name.trim().startsWith(".")) {
      const modName = /^\.([a-zA-Z0-9_-]+)$/.exec(r.name.trim());
      if (modName && props.moduleNames.includes(modName[1])) {
        props.onExpandModule(r, modName[1]);
      }
      return;
    }
    if (!r.actualPath) props.onSelectRow(r);
    else props.onCommitRowEdit(r);
  }

  // ✎ button: open the element editor (content / image / attributes) for this
  // row. Parent flushes the row to disk if needed, then opens the modal.
  function handleRowEdit(rowIndex: number) {
    const r = props.rows[rowIndex];
    if (!r || r.name.trim() === "") return;
    props.onEditRow(r, rowIndex + 1);
  }

  // Insert a new row as a child of the depth-0 row (body or head) so the
  // "+ root" button does the user-intuitive thing: "add to the visible root."
  return (
    <aside className="tree-panel">
      <div className="tree-header">
        <span className="tree-root-label" title={props.projectRoot}>
          {props.projectRoot.split(/[\\/]/).pop()}
        </span>
      </div>
      <div className="tree-rows">
        {(() => {
          const linePad = lineNumPad(props.rows.length);
          return visible.map(({ row, index, hasChildren }) => (
            <TreeRowComponent
              key={row.id}
              row={row}
              index={index}
              lineNumber={index + 1}
              linePad={linePad}
              hasChildren={hasChildren}
              unknownTag={!isKnownTag(row.name)}
              selected={
                !!row.actualPath && row.actualPath === props.selectedPath
              }
              highlightSource={
                !!row.actualPath &&
                row.actualPath !== props.selectedPath &&
                row.actualPath === props.highlightSourcePath
              }
              focusRequest={pendingFocusId === row.id}
              onFocus={() => handleRowFocus(index)}
              onCommit={() => handleRowCommit(index)}
              onEdit={() => handleRowEdit(index)}
              onToggleCollapse={() => toggleCollapse(index)}
              onChange={(e) => handleRowInputChange(e, index)}
              onKeyDown={(e) => handleRowKeyDown(e, index)}
              onContextMenu={(e) => {
                e.preventDefault();
                setContextMenu({
                  rowIndex: index,
                  x: e.clientX,
                  y: e.clientY,
                });
              }}
            />
          ));
        })()}
        {visible.length === 0 && (
          <div className="tree-empty">
            {t("Empty tree. Press Enter on a row to add an element.")}
          </div>
        )}
      </div>
      {contextMenu && (
        <div
          className="tree-context-menu"
          style={(() => {
            // Approximate menu dimensions — clamp to viewport so the menu
            // never opens partially off-screen when the row is near the
            // bottom / right edge.
            const APPROX_W = 240;
            const APPROX_H = 170;
            const margin = 8;
            const vw = window.innerWidth;
            const vh = window.innerHeight;
            const left = Math.max(
              margin,
              Math.min(contextMenu.x, vw - APPROX_W - margin)
            );
            const top = Math.max(
              margin,
              Math.min(contextMenu.y, vh - APPROX_H - margin)
            );
            return { top, left };
          })()}
          onClick={(e) => e.stopPropagation()}
        >
          <div
            className="tree-context-item"
            onClick={() => {
              copyRowSubtree(contextMenu.rowIndex);
              setContextMenu(null);
            }}
          >
            {t("Copy (CSS + CONTENT + children)")}
          </div>
          <div
            className={`tree-context-item ${props.hasClipboard ? "" : "disabled"}`}
            onClick={() => {
              if (!props.hasClipboard) return;
              pasteRowSubtree(contextMenu.rowIndex);
              setContextMenu(null);
            }}
          >
            {t("Paste (as sibling)")}
          </div>
          <div
            className="tree-context-item"
            onClick={() => {
              addChildBelow(contextMenu.rowIndex);
              setContextMenu(null);
            }}
          >
            {t("Add child")}
          </div>
          <div
            className="tree-context-item"
            onClick={() => {
              addSiblingBelow(contextMenu.rowIndex);
              setContextMenu(null);
            }}
          >
            {t("Add sibling below")}
          </div>
          <div className="tree-context-divider" />
          <div
            className="tree-context-item"
            onClick={() => {
              props.onRegisterModule(props.rows[contextMenu.rowIndex]);
              setContextMenu(null);
            }}
          >
            {t("Register as module...")}
          </div>
          <div className="tree-context-divider" />
          <div
            className="tree-context-item danger"
            onClick={() => {
              deleteRow(contextMenu.rowIndex);
              setContextMenu(null);
            }}
          >
            {t("Delete")}
          </div>
        </div>
      )}
      {ac && (
        <div
          className={`ac-popup ${ac.kind === "module" ? "ac-popup-module" : ""}`}
          style={{
            position: "fixed",
            top: ac.popupTop,
            left: ac.popupLeft,
          }}
        >
          {ac.items.map((name, i) => (
            <div
              key={name}
              className={`ac-item ${i === ac.selectedIndex ? "selected" : ""}`}
              onMouseDown={(e) => {
                e.preventDefault();
                acceptAcCompletion(ac.rowIndex, name);
              }}
            >
              {ac.kind === "module" && <span className="ac-item-icon">▣</span>}
              <span className="ac-item-name">
                {ac.kind === "module" ? `.${name}` : name}
              </span>
            </div>
          ))}
          <div className="ac-popup-help">
            {ac.kind === "module"
              ? t("module — Tab/Enter to expand")
              : "↑↓ select / Tab/Enter accept / Esc cancel"}
          </div>
        </div>
      )}
    </aside>
  );
}

function TreeRowComponent(props: {
  row: FlatRow;
  index: number;
  lineNumber: number;
  linePad: number;
  hasChildren: boolean;
  unknownTag: boolean;
  selected: boolean;
  highlightSource: boolean;
  focusRequest: boolean;
  onFocus: () => void;
  onCommit: () => void;
  onEdit: () => void;
  onToggleCollapse: () => void;
  onChange: (e: React.ChangeEvent<HTMLInputElement>) => void;
  onKeyDown: (e: React.KeyboardEvent<HTMLInputElement>) => void;
  onContextMenu: (e: React.MouseEvent) => void;
}) {
  const inputRef = useRef<HTMLInputElement>(null);
  // Honor a parent-requested focus (e.g., after Enter creates a new row,
  // or after Alt+arrow moves the selected row).
  useEffect(() => {
    if (props.focusRequest && inputRef.current) {
      inputRef.current.focus();
      // Select-all on focus so the seeded "div" (or any prior name) is replaced
      // by the user's first keystroke — they don't have to manually clear.
      inputRef.current.select();
    }
  }, [props.focusRequest]);

  return (
    <div
      className={[
        "tree-row",
        props.selected ? "selected" : "",
        props.highlightSource ? "highlight-source" : "",
      ]
        .filter(Boolean)
        .join(" ")}
      onContextMenu={props.onContextMenu}
    >
      <span className="tree-line-num" title={`${t("Line")} ${props.lineNumber}`}>
        {String(props.lineNumber).padStart(props.linePad, "0")}
      </span>
      {Array.from({ length: props.row.depth }).map((_, i) => (
        <span key={i} className="tree-indent-guide" />
      ))}
      <button
        type="button"
        className={`tree-fold-btn ${props.hasChildren ? "" : "invisible"}`}
        title={
          props.hasChildren
            ? props.row.collapsed
              ? t("Expand")
              : t("Collapse")
            : ""
        }
        onClick={(e) => {
          e.stopPropagation();
          if (props.hasChildren) props.onToggleCollapse();
        }}
      >
        {props.hasChildren ? (props.row.collapsed ? "▶" : "▼") : ""}
      </button>
      <input
        ref={inputRef}
        className={`tree-row-input ${props.unknownTag ? "unknown-tag" : ""}`}
        data-row-index={props.index}
        value={props.row.name}
        placeholder={t("(tag name)")}
        spellCheck={false}
        title={
          props.unknownTag
            ? t(
                '"{name}" is not a known HTML tag; it is rendered as <div> on build.'
              ).replace("{name}", props.row.name)
            : undefined
        }
        onChange={props.onChange}
        onKeyDown={props.onKeyDown}
        onFocus={props.onFocus}
        onBlur={props.onCommit}
      />
      {props.unknownTag && (
        <span
          className="tree-unknown-badge"
          title={t("Unknown tag → rendered as div")}
        >
          ⚠ div
        </span>
      )}
      {(props.row.badges?.length ||
        props.row.imageLabel ||
        props.row.content) && (
        <span className="tree-row-meta">
          {props.row.badges?.map((b) => (
            <span
              key={b}
              className={`tree-badge${b === "hidden" ? " is-hidden" : ""}`}
            >
              {b}
            </span>
          ))}
          {props.row.imageLabel && (
            <span className="tree-img-mark" title={props.row.imageLabel}>
              🖼 {props.row.imageLabel}
            </span>
          )}
          {props.row.content && (
            <span className="tree-content-preview">{props.row.content}</span>
          )}
        </span>
      )}
      <span className="tree-row-spacer" />
      <button
        type="button"
        className="tree-edit-btn"
        title={
          props.row.content
            ? `${t("Text")}: ${props.row.content.slice(0, 100)}`
            : t("Edit content (text / image / attributes)")
        }
        onClick={(e) => {
          e.stopPropagation();
          props.onEdit();
        }}
      >
        ✎
      </button>
    </div>
  );
}

function EditorPanel(props: {
  selectedPath: string | null;
  breadcrumb: string[];
  activeTab: TabKey;
  setActiveTab: (t: TabKey) => void;
  config: NodeConfig;
  update: <K extends keyof NodeConfig>(k: K, v: NodeConfig[K]) => void;
  onRun: () => void;
  onDev: () => void;
  devMode: boolean;
  dirty: boolean;
  inherited: InheritedDecl[];
  basin: BasinDecl[];
  onHighlightSource: (path: string | null) => void;
  variables: Record<string, string>;
  // Classes tab
  classFiles: ClassFile[];
  classDefs: ClassDef[];
  selectedClassFile: string | null;
  onSelectClassFile: (n: string | null) => void;
  classFileContent: string;
  onChangeClassFileContent: (v: string) => void;
  classFileDirty: boolean;
  onAddClassFile: () => void;
  onDeleteClassFile: () => void;
  onToggleClass: (name: string) => void;
  onDeleteClassFromElement: (name: string) => void;
  onToggleAvailableClass: (name: string) => void;
  onToggleInherited: (prop: string) => void;
  appliedClassNames: string[];
  // IMAGES tab
  imageFolders: ImageFolder[];
  selectedImageFolder: string | null;
  onSelectImageFolder: (n: string | null) => void;
  previewBaseUrl: string;
  onApplyImage: (relPath: string) => void;
  onReloadImages: () => void;
}) {
  return (
    <main className="editor-panel">
      <div className="breadcrumb">
        {props.breadcrumb.length === 0 ? (
          <span className="breadcrumb-empty">{t("Select an element")}</span>
        ) : (
          props.breadcrumb.map((seg, i) => (
            <span key={i}>
              {i > 0 && ">"}
              {seg}
            </span>
          ))
        )}
      </div>
      <div className="tabbar">
        <button
          className={`tab tab-css ${props.activeTab === "css" ? "active" : ""}`}
          onClick={() => props.setActiveTab("css")}
        >
          CSS
        </button>
        <button
          className={`tab tab-js ${props.activeTab === "js" ? "active" : ""}`}
          onClick={() => props.setActiveTab("js")}
        >
          SCRIPT
        </button>
        <button
          className={`tab tab-classes ${
            props.activeTab === "classes" ? "active" : ""
          }`}
          onClick={() => props.setActiveTab("classes")}
        >
          CLASSES
        </button>
        <span className="dirty-indicator">
          {(props.activeTab === "classes" ? props.classFileDirty : props.dirty)
            ? t("● unsaved")
            : ""}
        </span>
        <button
          className={`dev-button ${props.devMode ? "active" : ""}`}
          title={t("Dev preview: click an element to jump to it in the editor")}
          onClick={props.onDev}
        >
          DEV
        </button>
        <button className="run-button" onClick={props.onRun}>
          RUN
        </button>
      </div>
      <div className="editor-area">
        {!props.selectedPath ? (
          <div className="editor-empty">
            {t("Select an element from the DOM tree on the left")}
          </div>
        ) : props.activeTab === "css" ? (
          <CssEditor
            value={props.config.css ?? ""}
            onChange={(v) => props.update("css", v)}
            inherited={props.inherited}
            basin={props.basin}
            onHighlightSource={props.onHighlightSource}
            variables={props.variables}
            classDefs={props.classDefs}
            onToggleClass={props.onToggleClass}
            onDeleteClassFromElement={props.onDeleteClassFromElement}
            availableClassNames={props.config.available_classes ?? []}
            appliedClassNames={props.appliedClassNames}
            disabledInherits={props.config.disabled_inherits ?? []}
            onToggleInherited={props.onToggleInherited}
          />
        ) : props.activeTab === "js" ? (
          <JsEditor
            value={props.config.js ?? ""}
            onChange={(v) => props.update("js", v || undefined)}
          />
        ) : props.activeTab === "classes" ? (
          <ClassesTab
            files={props.classFiles}
            selected={props.selectedClassFile}
            onSelect={props.onSelectClassFile}
            content={props.classFileContent}
            onChangeContent={props.onChangeClassFileContent}
            onAdd={props.onAddClassFile}
            onDelete={props.onDeleteClassFile}
            variables={props.variables}
            classDefs={props.classDefs}
            availableClassNames={props.config.available_classes ?? []}
            appliedClassNames={props.appliedClassNames}
            onToggleAvailable={props.onToggleAvailableClass}
            hasSelectedElement={!!props.selectedPath}
          />
        ) : (
          <CssEditor
            value={props.config.css ?? ""}
            onChange={(v) => props.update("css", v)}
            inherited={props.inherited}
            basin={props.basin}
            onHighlightSource={props.onHighlightSource}
            variables={props.variables}
            classDefs={props.classDefs}
            onToggleClass={props.onToggleClass}
            onDeleteClassFromElement={props.onDeleteClassFromElement}
            availableClassNames={props.config.available_classes ?? []}
            appliedClassNames={props.appliedClassNames}
            disabledInherits={props.config.disabled_inherits ?? []}
            onToggleInherited={props.onToggleInherited}
          />
        )}
      </div>
    </main>
  );
}

interface ACItem {
  name: string;
  display?: string;
  detail?: string;
}

interface ACContext {
  kind: "property" | "value" | "variable";
  prefix: string;
  absStart: number;
  absEnd: number;
  property?: string;
}

interface ACState {
  items: ACItem[];
  selectedIndex: number;
  ctx: ACContext;
  popupTop: number;
  popupLeft: number;
}

function detectAcContext(value: string, cursor: number): ACContext | null {
  const lineStart = value.lastIndexOf("\n", cursor - 1) + 1;
  const lineSoFar = value.slice(lineStart, cursor);

  // $variable trigger has highest priority
  const varMatch = /\$([a-zA-Z0-9_-]*)$/.exec(lineSoFar);
  if (varMatch) {
    const prefix = varMatch[1];
    return {
      kind: "variable",
      prefix,
      absStart: cursor - prefix.length,
      absEnd: cursor,
    };
  }

  const colonIdx = lineSoFar.lastIndexOf(":");
  if (colonIdx >= 0) {
    const tail = lineSoFar.slice(colonIdx + 1);
    const property = lineSoFar.slice(0, colonIdx).trim().toLowerCase();
    const wordMatch = /([a-zA-Z0-9_-]*)$/.exec(tail);
    const word = wordMatch ? wordMatch[1] : "";
    // If the user has already typed a complete value (and possibly `;`) and
    // the cursor now sits past it (so the trailing word is empty but the
    // tail since `:` still has visible content), they're between tokens —
    // don't pop suggestions. They re-appear the moment a fresh letter is
    // typed.
    if (word === "" && tail.trim() !== "") {
      return null;
    }
    return {
      kind: "value",
      property,
      prefix: word,
      absStart: cursor - word.length,
      absEnd: cursor,
    };
  }

  const propMatch = /([a-zA-Z0-9_-]*)$/.exec(lineSoFar);
  const prefix = propMatch ? propMatch[1] : "";
  if (prefix.length === 0) return null;
  return {
    kind: "property",
    prefix,
    absStart: cursor - prefix.length,
    absEnd: cursor,
  };
}

function rankByFuzzy<T>(
  query: string,
  items: T[],
  getName: (item: T) => string,
  limit = 12
): T[] {
  const scored = items
    .map((item) => ({ item, score: fuzzyScore(query, getName(item)) }))
    .filter((x) => x.score > 0)
    .sort((a, b) => b.score - a.score);
  return scored.slice(0, limit).map((x) => x.item);
}

function getAcItems(
  ctx: ACContext,
  variables: Record<string, string>
): ACItem[] {
  if (ctx.kind === "property") {
    return rankByFuzzy(ctx.prefix, CSS_PROPERTIES, (p) => p, 30).map(
      (name) => ({ name })
    );
  }
  if (ctx.kind === "value" && ctx.property) {
    const list = getValueSuggestionsForProp(ctx.property);
    return rankByFuzzy(ctx.prefix, list, (v) => v, 30).map((name) => ({
      name,
    }));
  }
  if (ctx.kind === "variable") {
    const entries = Object.entries(variables);
    const ranked = rankByFuzzy(ctx.prefix, entries, ([k]) => k, 30);
    return ranked.map(([name, value]) => ({
      name,
      display: "$" + name,
      detail: value,
    }));
  }
  return [];
}

// Approximate caret pixel position in a monospace textarea.
// Good enough for placing an autocomplete popup near the cursor.
function estimateCaretCoords(ta: HTMLTextAreaElement) {
  const cursor = ta.selectionStart;
  const text = ta.value.slice(0, cursor);
  const lines = text.split("\n");
  const lineIndex = lines.length - 1;
  const col = lines[lineIndex].length;
  const cs = getComputedStyle(ta);
  const fontSize = parseFloat(cs.fontSize) || 16;
  const lineHeight = parseFloat(cs.lineHeight) || fontSize * 1.6;
  const charWidth = fontSize * 0.55;
  const paddingTop = parseFloat(cs.paddingTop) || 0;
  const paddingLeft = parseFloat(cs.paddingLeft) || 0;
  return {
    top: paddingTop + (lineIndex + 1) * lineHeight - ta.scrollTop,
    left: paddingLeft + col * charWidth - ta.scrollLeft,
  };
}

type CssSectionId = "inherited" | "classes" | "css" | "basin";

// Toggle line comments over the textarea's current selection (Ctrl+/). `block`
// wraps each line in `/* … */` (valid CSS); `line` prefixes `//` (JS). Running
// it again on already-commented lines uncomments them. Blank lines are skipped.
type CommentStyle = "block" | "line";

function applyCommentToggle(
  textarea: HTMLTextAreaElement,
  value: string,
  style: CommentStyle,
  onChange: (v: string) => void
) {
  const selStart = textarea.selectionStart;
  const selEnd = textarea.selectionEnd;
  const lineStart = value.lastIndexOf("\n", selStart - 1) + 1;
  // Probe from just inside the selection so a selection ending exactly at a
  // line boundary doesn't pull in the following line.
  const probe = selEnd > selStart ? selEnd - 1 : selEnd;
  let lineEnd = value.indexOf("\n", probe);
  if (lineEnd === -1) lineEnd = value.length;

  const block = value.slice(lineStart, lineEnd);
  const lines = block.split("\n");
  const isCommented = (l: string): boolean => {
    const t = l.trim();
    return style === "block"
      ? t.startsWith("/*") && t.endsWith("*/")
      : t.startsWith("//");
  };
  const nonEmpty = lines.filter((l) => l.trim() !== "");
  const uncommenting = nonEmpty.length > 0 && nonEmpty.every(isCommented);

  const newLines = lines.map((l) => {
    if (l.trim() === "") return l;
    const m = /^(\s*)(.*)$/.exec(l)!;
    const indent = m[1];
    let body = m[2];
    if (uncommenting) {
      body =
        style === "block"
          ? body.replace(/^\/\*\s?/, "").replace(/\s?\*\/$/, "")
          : body.replace(/^\/\/\s?/, "");
    } else {
      body = style === "block" ? `/* ${body} */` : `// ${body}`;
    }
    return indent + body;
  });

  const newBlock = newLines.join("\n");
  if (newBlock === block) return;
  const newValue = value.slice(0, lineStart) + newBlock + value.slice(lineEnd);
  onChange(newValue);
  const newEnd = lineStart + newBlock.length;
  window.setTimeout(() => {
    textarea.selectionStart = lineStart;
    textarea.selectionEnd = newEnd;
  }, 0);
}

function CssEditor(props: {
  value: string;
  onChange: (v: string) => void;
  inherited: InheritedDecl[];
  basin: BasinDecl[];
  onHighlightSource: (path: string | null) => void;
  variables: Record<string, string>;
  classDefs: ClassDef[];
  /** Toggle-class callback; when undefined, the CLASSES section is read-only. */
  onToggleClass?: (name: string) => void;
  onDeleteClassFromElement?: (name: string) => void;
  /** Class names earmarked for the current element (from CLASSES tab). */
  availableClassNames?: string[];
  appliedClassNames: string[];
  /** Inherited props the user has explicitly disabled (toggled off). */
  disabledInherits?: string[];
  onToggleInherited?: (prop: string) => void;
}) {
  const taRef = useRef<HTMLTextAreaElement>(null);
  const gutterRef = useRef<HTMLDivElement>(null);
  const overlayRef = useRef<HTMLPreElement>(null);
  const [acState, setAcState] = useState<ACState | null>(null);
  const [folded, setFolded] = useState<Set<CssSectionId>>(new Set());
  const lines = props.value.split("\n");
  const lineCount = Math.max(lines.length, 8);

  // Close the autocomplete popup on any pointerdown outside the popup itself.
  // Clicking back into the textarea also dismisses it (next keystroke will
  // re-open it with fresh suggestions) — feels much more "modal-less".
  useEffect(() => {
    if (!acState) return;
    const onDown = (e: MouseEvent) => {
      const t = e.target as HTMLElement | null;
      if (!t) return;
      if (t.closest(".ac-popup")) return;
      setAcState(null);
    };
    document.addEventListener("mousedown", onDown, true);
    return () => document.removeEventListener("mousedown", onDown, true);
  }, [acState]);

  function toggleFold(id: CssSectionId) {
    setFolded((prev) => {
      const next = new Set(prev);
      if (next.has(id)) next.delete(id);
      else next.add(id);
      return next;
    });
  }
  const isFolded = (id: CssSectionId) => folded.has(id);

  function refreshAutocomplete(value: string, cursor: number) {
    const ctx = detectAcContext(value, cursor);
    if (!ctx) {
      setAcState(null);
      return;
    }
    const items = getAcItems(ctx, props.variables);
    if (items.length === 0) {
      setAcState(null);
      return;
    }
    if (!taRef.current) return;
    const coords = estimateCaretCoords(taRef.current);
    const rect = taRef.current.getBoundingClientRect();
    setAcState({
      items: items.slice(0, 12),
      selectedIndex: 0,
      ctx,
      popupTop: rect.top + coords.top,
      popupLeft: rect.left + coords.left,
    });
  }

  function onTextareaChange(e: React.ChangeEvent<HTMLTextAreaElement>) {
    props.onChange(e.target.value);
    refreshAutocomplete(e.target.value, e.target.selectionStart);
  }

  function acceptCompletion(item: ACItem) {
    if (!acState || !taRef.current) return;
    const ta = taRef.current;
    const value = ta.value;
    const before = value.slice(0, acState.ctx.absStart);
    const after = value.slice(acState.ctx.absEnd);
    let insert = item.name;
    if (acState.ctx.kind === "property") insert += ": ";
    else if (acState.ctx.kind === "value") insert += ";";
    const newValue = before + insert + after;
    props.onChange(newValue);
    const newCursor = before.length + insert.length;
    setAcState(null);
    setTimeout(() => {
      if (taRef.current) {
        taRef.current.selectionStart = newCursor;
        taRef.current.selectionEnd = newCursor;
        taRef.current.focus();
      }
    }, 0);
  }

  function onKeyDown(e: React.KeyboardEvent<HTMLTextAreaElement>) {
    // Ctrl+/ — toggle comments on the selected line(s).
    if ((e.ctrlKey || e.metaKey) && e.key === "/") {
      e.preventDefault();
      applyCommentToggle(e.currentTarget, props.value, "block", props.onChange);
      return;
    }

    // Autocomplete navigation takes precedence
    if (acState) {
      switch (e.key) {
        case "ArrowDown":
          e.preventDefault();
          setAcState({
            ...acState,
            selectedIndex: (acState.selectedIndex + 1) % acState.items.length,
          });
          return;
        case "ArrowUp":
          e.preventDefault();
          setAcState({
            ...acState,
            selectedIndex:
              (acState.selectedIndex - 1 + acState.items.length) %
              acState.items.length,
          });
          return;
        case "Tab":
        case "Enter":
          e.preventDefault();
          acceptCompletion(acState.items[acState.selectedIndex]);
          return;
        case "Escape":
          e.preventDefault();
          setAcState(null);
          return;
      }
    }

    // VSCode-style smart indent.
    if (e.key === "Enter") {
      const ta = e.currentTarget;
      const value = ta.value;
      const start = ta.selectionStart;
      const end = ta.selectionEnd;
      const lineStart = value.lastIndexOf("\n", start - 1) + 1;
      const upToCursor = value.slice(lineStart, start);
      const indent = (/^[ \t]*/.exec(upToCursor) ?? [""])[0];
      const trimmedBefore = upToCursor.trimEnd();
      const opensBlock = trimmedBefore.endsWith("{");
      const charBefore = value[start - 1];
      const charAfter = value[start];
      const betweenBraces = charBefore === "{" && charAfter === "}";

      const inner = indent + (opensBlock ? "  " : "");
      let insert: string;
      let cursorOffset: number;
      if (betweenBraces) {
        insert = "\n" + inner + "\n" + indent;
        cursorOffset = 1 + inner.length;
      } else if (opensBlock) {
        insert = "\n" + inner;
        cursorOffset = insert.length;
      } else {
        insert = "\n" + indent;
        cursorOffset = insert.length;
      }
      e.preventDefault();
      const newValue = value.slice(0, start) + insert + value.slice(end);
      props.onChange(newValue);
      window.setTimeout(() => {
        if (taRef.current) {
          const pos = start + cursorOffset;
          taRef.current.selectionStart = pos;
          taRef.current.selectionEnd = pos;
        }
      }, 0);
      return;
    }

    // Typing `}` on a whitespace-only line: dedent the line by one step.
    if (e.key === "}") {
      const ta = e.currentTarget;
      const value = ta.value;
      const start = ta.selectionStart;
      const end = ta.selectionEnd;
      const lineStart = value.lastIndexOf("\n", start - 1) + 1;
      const lineSoFar = value.slice(lineStart, start);
      if (
        start === end &&
        lineSoFar.length > 0 &&
        lineSoFar.trim() === ""
      ) {
        const dedented = lineSoFar.replace(/(\t| {1,2})$/, "");
        if (dedented !== lineSoFar) {
          e.preventDefault();
          const newValue =
            value.slice(0, lineStart) + dedented + "}" + value.slice(end);
          props.onChange(newValue);
          window.setTimeout(() => {
            if (taRef.current) {
              const pos = lineStart + dedented.length + 1;
              taRef.current.selectionStart = pos;
              taRef.current.selectionEnd = pos;
            }
          }, 0);
          return;
        }
      }
    }

    // Tab inserts two spaces (don't move focus).
    if (e.key === "Tab" && !e.shiftKey) {
      e.preventDefault();
      const ta = e.currentTarget;
      const value = ta.value;
      const start = ta.selectionStart;
      const end = ta.selectionEnd;
      const newValue = value.slice(0, start) + "  " + value.slice(end);
      props.onChange(newValue);
      window.setTimeout(() => {
        if (taRef.current) {
          taRef.current.selectionStart = start + 2;
          taRef.current.selectionEnd = start + 2;
        }
      }, 0);
      return;
    }
  }

  function onBasinClick(b: BasinDecl) {
    if (b.layer === "inherited" && b.sourcePath) {
      props.onHighlightSource(b.sourcePath);
    } else {
      props.onHighlightSource(null);
    }
  }

  return (
    <div className="css-editor">
      <CssSection
        title="INHERITED"
        count={props.inherited.length}
        folded={isFolded("inherited")}
        onToggle={() => toggleFold("inherited")}
        flavor="inherited"
      >
        {props.inherited.length === 0 ? (
          <div className="css-section-empty">
            No inherited properties
          </div>
        ) : (
          props.inherited.map((d, i) => {
            const disabled = (props.disabledInherits ?? []).includes(d.prop);
            return (
              <div
                key={i}
                className={`css-inherited-row ${
                  disabled ? "is-disabled" : ""
                }`}
                title={
                  disabled
                    ? `${d.prop} is blocked (re-enable with the checkbox)`
                    : `inherited from ${d.source.name}`
                }
              >
                {props.onToggleInherited && (
                  <button
                    type="button"
                    className="css-inherited-toggle"
                    title={disabled ? "Enable inheritance" : "Block inheritance"}
                    onClick={(e) => {
                      e.stopPropagation();
                      props.onToggleInherited!(d.prop);
                    }}
                  >
                    {disabled ? "☐" : "☑"}
                  </button>
                )}
                <span
                  className="css-inherited-source"
                  onClick={() => props.onHighlightSource(d.source.path)}
                >
                  {d.source.display_name || d.source.name}
                </span>
                <span className="css-inherited-prop">{d.prop}</span>
                <span className="css-inherited-colon">: </span>
                <span className="css-inherited-value">{d.value};</span>
              </div>
            );
          })
        )}
      </CssSection>

      <CssSection
        title="CLASSES"
        count={(() => {
          const avail = new Set(props.availableClassNames ?? []);
          for (const c of props.appliedClassNames) avail.add(c);
          return avail.size;
        })()}
        folded={isFolded("classes")}
        onToggle={() => toggleFold("classes")}
        flavor="classes"
      >
        {(() => {
          const poolNames = new Set([
            ...(props.availableClassNames ?? []),
            ...props.appliedClassNames,
          ]);
          const visibleDefs = props.classDefs.filter((c) =>
            poolNames.has(c.name.replace(/^\./, ""))
          );
          // Names known to the element but missing from any class file —
          // show as bare cards so the user can still un-register them.
          const knownDefNames = new Set(
            props.classDefs.map((c) => c.name.replace(/^\./, ""))
          );
          const orphanNames = Array.from(poolNames).filter(
            (n) => !knownDefNames.has(n)
          );
          if (visibleDefs.length === 0 && orphanNames.length === 0) {
            return (
              <div className="css-section-empty">
                No classes registered yet. Add them in the CLASSES tab.
              </div>
            );
          }
          return (
            <div className="class-cards">
              {visibleDefs.map((c, i) => {
                const stripped = c.name.replace(/^\./, "");
                const isApplied =
                  props.appliedClassNames.includes(stripped);
                const propsText = c.properties
                  .split("\n")
                  .map((l) => l.trim())
                  .filter((l) => l.length > 0)
                  .join("\n");
                return (
                  <div
                    key={`${c.source}:${c.name}:${i}`}
                    className={`class-card ${isApplied ? "applied" : ""} ${
                      !props.onToggleClass ? "readonly" : ""
                    }`}
                    title={
                      props.onToggleClass
                        ? isApplied
                          ? "Click to remove"
                          : "Click to apply"
                        : ""
                    }
                  >
                    <div
                      className="class-card-head"
                      onClick={() => {
                        if (props.onToggleClass)
                          props.onToggleClass(stripped);
                      }}
                    >
                      <span className="class-card-check">
                        {isApplied ? "☑" : "☐"}
                      </span>
                      <span className="class-card-name">{c.name}</span>
                      <span className="class-card-source">{c.source}</span>
                      {props.onDeleteClassFromElement && (
                        <button
                          type="button"
                          className="class-card-delete"
                          title="Remove from this element's list"
                          onClick={(e) => {
                            e.stopPropagation();
                            props.onDeleteClassFromElement!(stripped);
                          }}
                        >
                          ×
                        </button>
                      )}
                    </div>
                    <pre className="class-card-props">{propsText}</pre>
                  </div>
                );
              })}
              {orphanNames.map((name) => (
                <div
                  key={`orphan:${name}`}
                  className={`class-card orphan ${
                    props.appliedClassNames.includes(name) ? "applied" : ""
                  }`}
                  title="Class definition not found"
                >
                  <div
                    className="class-card-head"
                    onClick={() => {
                      if (props.onToggleClass) props.onToggleClass(name);
                    }}
                  >
                    <span className="class-card-check">
                      {props.appliedClassNames.includes(name) ? "☑" : "☐"}
                    </span>
                    <span className="class-card-name">.{name}</span>
                    <span className="class-card-source">(undefined)</span>
                    {props.onDeleteClassFromElement && (
                      <button
                        type="button"
                        className="class-card-delete"
                        title="Remove from this element's list"
                        onClick={(e) => {
                          e.stopPropagation();
                          props.onDeleteClassFromElement!(name);
                        }}
                      >
                        ×
                      </button>
                    )}
                  </div>
                </div>
              ))}
            </div>
          );
        })()}
      </CssSection>

      <CssSection
        title="CSS"
        folded={isFolded("css")}
        onToggle={() => toggleFold("css")}
        flavor="css"
        grow
      >
        <div className="css-own">
          <div className="css-gutter" ref={gutterRef}>
            {Array.from({ length: lineCount }, (_, i) => (
              <div key={i} className="css-line-num">
                {String(i + 1).padStart(2, "0")}
              </div>
            ))}
          </div>
          <div className="code-stack">
            <pre className="code-overlay" ref={overlayRef} aria-hidden="true">
              <code
                dangerouslySetInnerHTML={{
                  __html: highlight(props.value, "css") + "\n",
                }}
              />
            </pre>
            <textarea
              ref={taRef}
              className="css-textarea code-input"
              spellCheck={false}
              value={props.value}
              onFocus={() => props.onHighlightSource(null)}
              onChange={onTextareaChange}
              onKeyDown={onKeyDown}
              onBlur={() => {
                window.setTimeout(() => setAcState(null), 120);
              }}
              onScroll={(e) => {
                const ta = e.currentTarget;
                if (gutterRef.current) {
                  gutterRef.current.scrollTop = ta.scrollTop;
                }
                if (overlayRef.current) {
                  overlayRef.current.scrollTop = ta.scrollTop;
                  overlayRef.current.scrollLeft = ta.scrollLeft;
                }
                setAcState(null);
              }}
            />
          </div>
        </div>
      </CssSection>

      <CssSection
        title="BASIN"
        count={props.basin.length}
        folded={isFolded("basin")}
        onToggle={() => toggleFold("basin")}
        flavor="basin"
      >
        {props.basin.length === 0 ? (
          <div className="css-section-empty">
            No final applied properties
          </div>
        ) : (
          props.basin.map((b, i) => {
            const isMix = !!b.shadows && b.shadows.length > 0;
            const winnerDesc =
              b.layer === "inherited"
                ? `Inherited from: ${b.sourceLabel}`
                : b.layer === "class"
                ? `Class: ${b.sourceLabel}${b.classFile ? ` (${b.classFile})` : ""}`
                : b.layer === "stacked"
                ? `Ancestors + self combined: ${b.sourceLabel}`
                : "This element's CSS";
            const tooltip = isMix
              ? [
                  `winner: ${b.layer} ${b.sourceLabel} → ${b.value}`,
                  "shadowed:",
                  ...b.shadows!.map(
                    (s) => `  ${s.layer} ${s.sourceLabel} → ${s.value}`
                  ),
                ].join("\n")
              : winnerDesc;
            const rowLayerClass = isMix ? "layer-mix" : `layer-${b.layer}`;
            const pillText = isMix
              ? "mix"
              : b.layer === "stacked"
              ? "stack Σ"
              : b.layer;
            return (
              <div
                key={i}
                className={`basin-row ${rowLayerClass}`}
                title={tooltip}
                onClick={() => onBasinClick(b)}
              >
                <span className="basin-layer-pill">{pillText}</span>
                <span className="basin-prop">{b.prop}</span>
                <span className="basin-colon">: </span>
                <span className="basin-value">{b.value};</span>
                <span className="basin-source">{b.sourceLabel}</span>
              </div>
            );
          })
        )}
      </CssSection>

      {acState && (
        <div
          className="ac-popup"
          style={{
            position: "fixed",
            top: acState.popupTop,
            left: acState.popupLeft,
          }}
        >
          {acState.items.map((item, i) => (
            <div
              key={item.name}
              className={`ac-item ${
                i === acState.selectedIndex ? "selected" : ""
              }`}
              onMouseDown={(e) => {
                e.preventDefault();
                acceptCompletion(item);
              }}
            >
              <span className="ac-item-name">
                {item.display ?? item.name}
              </span>
              {item.detail && (
                <span className="ac-item-detail">{item.detail}</span>
              )}
            </div>
          ))}
          <div className="ac-popup-help">
            ↑↓ select / Tab/Enter accept / Esc cancel
          </div>
        </div>
      )}
    </div>
  );
}

function CssSection(props: {
  title: string;
  count?: number;
  folded: boolean;
  onToggle: () => void;
  flavor: "inherited" | "classes" | "css" | "basin";
  grow?: boolean;
  children: React.ReactNode;
}) {
  return (
    <section
      className={`css-section flavor-${props.flavor} ${
        props.folded ? "folded" : ""
      } ${props.grow ? "grow" : ""}`}
    >
      <button
        type="button"
        className="css-section-header"
        onClick={props.onToggle}
      >
        <span className="css-section-chevron">
          {props.folded ? "▶" : "▼"}
        </span>
        <span className="css-section-title">{props.title}</span>
        {props.count != null && (
          <span className="css-section-count">{props.count}</span>
        )}
      </button>
      {!props.folded && (
        <div className="css-section-body">{props.children}</div>
      )}
    </section>
  );
}

// Bare CSS editor: just the gutter + textarea + autocomplete popup.
// Used inside the CLASSES tab for editing class-file content — no INHERITED
// / BASIN / per-element CLASSES sections (those don't apply to a class file).
function CssBareEditor(props: {
  value: string;
  onChange: (v: string) => void;
  variables: Record<string, string>;
}) {
  const taRef = useRef<HTMLTextAreaElement>(null);
  const gutterRef = useRef<HTMLDivElement>(null);
  const overlayRef = useRef<HTMLPreElement>(null);
  const [acState, setAcState] = useState<ACState | null>(null);
  const lines = props.value.split("\n");
  const lineCount = Math.max(lines.length, 8);

  // Dismiss the autocomplete popup on any pointerdown that lands outside it.
  useEffect(() => {
    if (!acState) return;
    const onDown = (e: MouseEvent) => {
      const t = e.target as HTMLElement | null;
      if (!t) return;
      if (t.closest(".ac-popup")) return;
      setAcState(null);
    };
    document.addEventListener("mousedown", onDown, true);
    return () => document.removeEventListener("mousedown", onDown, true);
  }, [acState]);

  function refreshAutocomplete(value: string, cursor: number) {
    const ctx = detectAcContext(value, cursor);
    if (!ctx) {
      setAcState(null);
      return;
    }
    const items = getAcItems(ctx, props.variables);
    if (items.length === 0) {
      setAcState(null);
      return;
    }
    if (!taRef.current) return;
    const coords = estimateCaretCoords(taRef.current);
    const rect = taRef.current.getBoundingClientRect();
    setAcState({
      items: items.slice(0, 12),
      selectedIndex: 0,
      ctx,
      popupTop: rect.top + coords.top,
      popupLeft: rect.left + coords.left,
    });
  }

  function onTextareaChange(e: React.ChangeEvent<HTMLTextAreaElement>) {
    props.onChange(e.target.value);
    refreshAutocomplete(e.target.value, e.target.selectionStart);
  }

  function acceptCompletion(item: ACItem) {
    if (!acState || !taRef.current) return;
    const ta = taRef.current;
    const value = ta.value;
    const before = value.slice(0, acState.ctx.absStart);
    const after = value.slice(acState.ctx.absEnd);
    let insert = item.name;
    if (acState.ctx.kind === "property") insert += ": ";
    else if (acState.ctx.kind === "value") insert += ";";
    const newValue = before + insert + after;
    props.onChange(newValue);
    const newCursor = before.length + insert.length;
    setAcState(null);
    setTimeout(() => {
      if (taRef.current) {
        taRef.current.selectionStart = newCursor;
        taRef.current.selectionEnd = newCursor;
        taRef.current.focus();
      }
    }, 0);
  }

  function onKeyDown(e: React.KeyboardEvent<HTMLTextAreaElement>) {
    // Ctrl+/ — toggle comments on the selected line(s).
    if ((e.ctrlKey || e.metaKey) && e.key === "/") {
      e.preventDefault();
      applyCommentToggle(e.currentTarget, props.value, "block", props.onChange);
      return;
    }

    // Autocomplete navigation takes precedence
    if (acState) {
      switch (e.key) {
        case "ArrowDown":
          e.preventDefault();
          setAcState({
            ...acState,
            selectedIndex: (acState.selectedIndex + 1) % acState.items.length,
          });
          return;
        case "ArrowUp":
          e.preventDefault();
          setAcState({
            ...acState,
            selectedIndex:
              (acState.selectedIndex - 1 + acState.items.length) %
              acState.items.length,
          });
          return;
        case "Tab":
        case "Enter":
          e.preventDefault();
          acceptCompletion(acState.items[acState.selectedIndex]);
          return;
        case "Escape":
          e.preventDefault();
          setAcState(null);
          return;
      }
    }

    // VSCode-style smart indent.
    if (e.key === "Enter") {
      const ta = e.currentTarget;
      const value = ta.value;
      const start = ta.selectionStart;
      const end = ta.selectionEnd;
      const lineStart = value.lastIndexOf("\n", start - 1) + 1;
      const upToCursor = value.slice(lineStart, start);
      const indent = (/^[ \t]*/.exec(upToCursor) ?? [""])[0];
      const trimmedBefore = upToCursor.trimEnd();
      const opensBlock = trimmedBefore.endsWith("{");
      const charBefore = value[start - 1];
      const charAfter = value[start];
      const betweenBraces = charBefore === "{" && charAfter === "}";

      const inner = indent + (opensBlock ? "  " : "");
      let insert: string;
      let cursorOffset: number;
      if (betweenBraces) {
        insert = "\n" + inner + "\n" + indent;
        cursorOffset = 1 + inner.length;
      } else if (opensBlock) {
        insert = "\n" + inner;
        cursorOffset = insert.length;
      } else {
        insert = "\n" + indent;
        cursorOffset = insert.length;
      }
      e.preventDefault();
      const newValue = value.slice(0, start) + insert + value.slice(end);
      props.onChange(newValue);
      window.setTimeout(() => {
        if (taRef.current) {
          const pos = start + cursorOffset;
          taRef.current.selectionStart = pos;
          taRef.current.selectionEnd = pos;
        }
      }, 0);
      return;
    }

    // Typing `}` on a whitespace-only line: dedent the line by one step.
    if (e.key === "}") {
      const ta = e.currentTarget;
      const value = ta.value;
      const start = ta.selectionStart;
      const end = ta.selectionEnd;
      const lineStart = value.lastIndexOf("\n", start - 1) + 1;
      const lineSoFar = value.slice(lineStart, start);
      if (
        start === end &&
        lineSoFar.length > 0 &&
        lineSoFar.trim() === ""
      ) {
        const dedented = lineSoFar.replace(/(\t| {1,2})$/, "");
        if (dedented !== lineSoFar) {
          e.preventDefault();
          const newValue =
            value.slice(0, lineStart) + dedented + "}" + value.slice(end);
          props.onChange(newValue);
          window.setTimeout(() => {
            if (taRef.current) {
              const pos = lineStart + dedented.length + 1;
              taRef.current.selectionStart = pos;
              taRef.current.selectionEnd = pos;
            }
          }, 0);
          return;
        }
      }
    }

    // Tab inserts two spaces (don't move focus).
    if (e.key === "Tab" && !e.shiftKey) {
      e.preventDefault();
      const ta = e.currentTarget;
      const value = ta.value;
      const start = ta.selectionStart;
      const end = ta.selectionEnd;
      const newValue = value.slice(0, start) + "  " + value.slice(end);
      props.onChange(newValue);
      window.setTimeout(() => {
        if (taRef.current) {
          taRef.current.selectionStart = start + 2;
          taRef.current.selectionEnd = start + 2;
        }
      }, 0);
      return;
    }
  }

  return (
    <div className="css-bare-editor">
      <div className="css-own">
        <div className="css-gutter" ref={gutterRef}>
          {Array.from({ length: lineCount }, (_, i) => (
            <div key={i} className="css-line-num">
              {String(i + 1).padStart(2, "0")}
            </div>
          ))}
        </div>
        <div className="code-stack">
          <pre className="code-overlay" ref={overlayRef} aria-hidden="true">
            <code
              dangerouslySetInnerHTML={{
                __html: highlight(props.value, "css") + "\n",
              }}
            />
          </pre>
          <textarea
            ref={taRef}
            className="css-textarea code-input"
            spellCheck={false}
            value={props.value}
            onChange={onTextareaChange}
            onKeyDown={onKeyDown}
            onBlur={() => {
              window.setTimeout(() => setAcState(null), 120);
            }}
            onScroll={(e) => {
              const ta = e.currentTarget;
              if (gutterRef.current) {
                gutterRef.current.scrollTop = ta.scrollTop;
              }
              if (overlayRef.current) {
                overlayRef.current.scrollTop = ta.scrollTop;
                overlayRef.current.scrollLeft = ta.scrollLeft;
              }
              setAcState(null);
            }}
          />
        </div>
      </div>
      {acState && (
        <div
          className="ac-popup"
          style={{
            position: "fixed",
            top: acState.popupTop,
            left: acState.popupLeft,
          }}
        >
          {acState.items.map((item, i) => (
            <div
              key={item.name}
              className={`ac-item ${
                i === acState.selectedIndex ? "selected" : ""
              }`}
              onMouseDown={(e) => {
                e.preventDefault();
                acceptCompletion(item);
              }}
            >
              <span className="ac-item-name">
                {item.display ?? item.name}
              </span>
              {item.detail && (
                <span className="ac-item-detail">{item.detail}</span>
              )}
            </div>
          ))}
          <div className="ac-popup-help">
            ↑↓ select / Tab/Enter accept / Esc cancel
          </div>
        </div>
      )}
    </div>
  );
}

function ContentEditor(props: {
  value: string;
  onChange: (v: string) => void;
  autoFocus?: boolean;
}) {
  const ref = useRef<HTMLTextAreaElement>(null);
  // Focus on mount and place the caret at the end, so the user can type
  // immediately (e.g. opening the element editor via Ctrl+T).
  useEffect(() => {
    if (props.autoFocus && ref.current) {
      const ta = ref.current;
      ta.focus();
      ta.setSelectionRange(ta.value.length, ta.value.length);
    }
  }, [props.autoFocus]);
  return (
    <div className="content-editor">
      <textarea
        ref={ref}
        className="content-textarea"
        spellCheck={false}
        value={props.value}
        placeholder={t("Text shown inside this tag...")}
        onChange={(e) => props.onChange(e.target.value)}
      />
    </div>
  );
}

function JsEditor(props: { value: string; onChange: (v: string) => void }) {
  const gutterRef = useRef<HTMLDivElement>(null);
  const overlayRef = useRef<HTMLPreElement>(null);
  const taRef = useRef<HTMLTextAreaElement>(null);
  const lines = props.value.split("\n");
  const lineCount = Math.max(lines.length, 8);
  function handleKeyDown(e: React.KeyboardEvent<HTMLTextAreaElement>) {
    // Ctrl+/ — toggle `//` line comments on the selected line(s).
    if ((e.ctrlKey || e.metaKey) && e.key === "/") {
      e.preventDefault();
      applyCommentToggle(e.currentTarget, props.value, "line", props.onChange);
      return;
    }
    // Tab inserts a literal tab (or 2 spaces); avoid losing focus.
    if (e.key === "Tab") {
      e.preventDefault();
      const ta = e.currentTarget;
      const s = ta.selectionStart;
      const en = ta.selectionEnd;
      const next = ta.value.slice(0, s) + "  " + ta.value.slice(en);
      props.onChange(next);
      window.setTimeout(() => {
        if (taRef.current) {
          taRef.current.selectionStart = taRef.current.selectionEnd = s + 2;
        }
      }, 0);
    }
  }
  return (
    <div className="js-fullpane">
      <div className="js-fullpane-gutter" ref={gutterRef}>
        {Array.from({ length: lineCount }, (_, i) => (
          <div key={i} className="js-fullpane-line-num">
            {String(i + 1).padStart(2, "0")}
          </div>
        ))}
      </div>
      <div className="code-stack">
        <pre className="code-overlay" ref={overlayRef} aria-hidden="true">
          <code
            dangerouslySetInnerHTML={{
              __html: highlight(props.value, "js") + "\n",
            }}
          />
        </pre>
        <textarea
          ref={taRef}
          className="js-fullpane-textarea code-input"
          spellCheck={false}
          value={props.value}
          placeholder={
            "// el refers to this element\n// Example:\n// el.addEventListener('click', () => {\n//   el.textContent = 'clicked';\n// });"
          }
          onChange={(e) => props.onChange(e.target.value)}
          onKeyDown={handleKeyDown}
          onScroll={(e) => {
            const ta = e.currentTarget;
            if (gutterRef.current) {
              gutterRef.current.scrollTop = ta.scrollTop;
            }
            if (overlayRef.current) {
              overlayRef.current.scrollTop = ta.scrollTop;
              overlayRef.current.scrollLeft = ta.scrollLeft;
            }
          }}
        />
      </div>
    </div>
  );
}

// Inline element editor opened from a tree row's ✎ button. Edits the
// element's text content (or, for <img>, picks an image → src) plus a compact
// attribute editor. The element's id is its line number (shown, not editable).
function ElementEditModal(props: {
  lineNumber: number;
  tag: string;
  config: NodeConfig;
  update: <K extends keyof NodeConfig>(k: K, v: NodeConfig[K]) => void;
  imageFolders: ImageFolder[];
  selectedImageFolder: string | null;
  onSelectImageFolder: (n: string | null) => void;
  previewBaseUrl: string;
  onApplyImage: (relPath: string) => void;
  onReloadImages: () => void;
  onClose: () => void;
}) {
  const c = props.config;
  const isImg = props.tag === "img";
  const VOID = new Set([
    "area", "base", "br", "col", "embed", "hr", "img", "input", "link",
    "meta", "source", "track", "wbr",
  ]);
  const takesText = !VOID.has(props.tag);

  function setAttr(k: string, v: string) {
    props.update("attributes", { ...c.attributes, [k]: v });
  }
  function delAttr(k: string) {
    const next = { ...c.attributes };
    delete next[k];
    props.update("attributes", next);
  }
  function addAttr() {
    const k = window.prompt(t("Attribute name (e.g. href, alt, data-x)"));
    if (!k) return;
    setAttr(k.trim(), "");
  }

  return (
    <div className="modal-bg" onClick={props.onClose}>
      <div
        className="modal element-edit-modal"
        onClick={(e) => e.stopPropagation()}
      >
        <div className="modal-head">
          <span>
            {t("Edit element — line")} {props.lineNumber}
            <code className="elem-tag">&lt;{props.tag || "?"}&gt;</code>
            <span className="elem-id">id="{props.lineNumber}"</span>
          </span>
          <button onClick={props.onClose}>×</button>
        </div>
        <div className="element-edit-body">
          {isImg ? (
            <div className="elem-section">
              <div className="elem-section-title">{t("Select image (src)")}</div>
              {c.attributes.src && (
                <div className="elem-current-src">
                  {t("Current:")} {c.attributes.src}
                </div>
              )}
              <ImagesTab
                folders={props.imageFolders}
                selected={props.selectedImageFolder}
                onSelectFolder={props.onSelectImageFolder}
                baseUrl={props.previewBaseUrl}
                onApply={props.onApplyImage}
                onRefresh={props.onReloadImages}
                hasSelectedElement={true}
              />
              <label className="elem-field">
                <span>alt</span>
                <input
                  value={c.attributes.alt ?? ""}
                  onChange={(e) => setAttr("alt", e.target.value)}
                  placeholder={t("Alternative text")}
                />
              </label>
            </div>
          ) : takesText ? (
            <div className="elem-section">
              <div className="elem-section-title">{t("Text (content)")}</div>
              <ContentEditor
                value={c.content ?? ""}
                onChange={(v) => props.update("content", v || undefined)}
                autoFocus
              />
            </div>
          ) : (
            <div className="elem-section elem-void-note">
              {t(
                "<{tag}> is a void element; it has no content. Edit attributes only."
              ).replace("{tag}", props.tag)}
            </div>
          )}

          <div className="elem-section">
            <div className="elem-section-title">{t("Attributes")}</div>
            {Object.entries(c.attributes)
              .filter(([k]) => !(isImg && (k === "src" || k === "alt")))
              .map(([k, v]) => (
                <div key={k} className="attr-row">
                  <span className="attr-key">{k}</span>
                  <input value={v} onChange={(e) => setAttr(k, e.target.value)} />
                  <button onClick={() => delAttr(k)} title={t("Delete")}>
                    ×
                  </button>
                </div>
              ))}
            <button className="add-btn" onClick={addAttr}>
              {t("+ Add attribute")}
            </button>
          </div>
        </div>
        <div className="element-edit-foot">
          <button className="primary" onClick={props.onClose}>
            {t("Done")}
          </button>
        </div>
      </div>
    </div>
  );
}

// FILE → HEAD → DEFAULT: rarely-changed head settings (charset / viewport)
// plus the <html lang>. Stored in htfl.yaml `head:` (lang on HTML/ config).
function HeadDefaultModal(props: {
  head: HeadConfig;
  lang: string;
  onClose: () => void;
  onSave: (patch: Partial<HeadConfig>, lang: string) => void | Promise<void>;
}) {
  const [charset, setCharset] = useState(props.head.charset ?? "UTF-8");
  const [viewport, setViewport] = useState(
    props.head.viewport ?? "width=device-width, initial-scale=1"
  );
  const [lang, setLang] = useState(props.lang);
  return (
    <div className="modal-bg" onClick={props.onClose}>
      <div className="modal head-modal" onClick={(e) => e.stopPropagation()}>
        <div className="modal-head">
          <span>HEAD — DEFAULT</span>
          <button onClick={props.onClose}>×</button>
        </div>
        <div className="head-modal-body">
          <p className="head-modal-help">
            {t(
              "Rarely-changed default head settings. Saved to htfl.yaml and emitted into <head> at build time."
            )}
          </p>
          <label className="head-field">
            <span>&lt;html lang&gt;</span>
            <input value={lang} onChange={(e) => setLang(e.target.value)} />
          </label>
          <label className="head-field">
            <span>charset</span>
            <input
              value={charset}
              onChange={(e) => setCharset(e.target.value)}
            />
          </label>
          <label className="head-field">
            <span>viewport</span>
            <input
              value={viewport}
              onChange={(e) => setViewport(e.target.value)}
            />
          </label>
        </div>
        <div className="head-modal-foot">
          <button onClick={props.onClose}>{t("Cancel")}</button>
          <button
            className="primary"
            onClick={() =>
              props.onSave(
                { charset: charset.trim(), viewport: viewport.trim() },
                lang.trim() || "ja"
              )
            }
          >
            {t("Save")}
          </button>
        </div>
      </div>
    </div>
  );
}

// FILE → HEAD → PROJECT TAGS: per-project head tags (title / description /
// OGP / favicon / theme-color). Stored in htfl.yaml `head:`.
function HeadProjectTagsModal(props: {
  head: HeadConfig;
  onClose: () => void;
  onSave: (patch: Partial<HeadConfig>) => void | Promise<void>;
}) {
  const [f, setF] = useState<HeadConfig>({
    title: props.head.title ?? "",
    description: props.head.description ?? "",
    og_title: props.head.og_title ?? "",
    og_description: props.head.og_description ?? "",
    og_image: props.head.og_image ?? "",
    favicon: props.head.favicon ?? "",
    theme_color: props.head.theme_color ?? "",
  });
  const set = (k: keyof HeadConfig, v: string) =>
    setF((prev) => ({ ...prev, [k]: v }));
  const field = (k: keyof HeadConfig, label: string, ph = "") => (
    <label className="head-field">
      <span>{label}</span>
      <input
        value={f[k] ?? ""}
        placeholder={ph}
        onChange={(e) => set(k, e.target.value)}
      />
    </label>
  );
  return (
    <div className="modal-bg" onClick={props.onClose}>
      <div className="modal head-modal" onClick={(e) => e.stopPropagation()}>
        <div className="modal-head">
          <span>HEAD — PROJECT TAGS</span>
          <button onClick={props.onClose}>×</button>
        </div>
        <div className="head-modal-body">
          <p className="head-modal-help">
            {t("Head tags specific to this project.")}
          </p>
          {field("title", "title", t("Page title"))}
          {field("description", "meta description", t("Page description"))}
          {field("theme_color", "theme-color", "#39b54a")}
          <div className="head-group-label">{t("OGP (social share)")}</div>
          {field("og_title", "og:title")}
          {field("og_description", "og:description")}
          {field("og_image", "og:image", "https://... or /images/...")}
          <div className="head-group-label">{t("Icon")}</div>
          {field("favicon", "favicon (link rel=icon)", "/favicon.ico")}
        </div>
        <div className="head-modal-foot">
          <button onClick={props.onClose}>{t("Cancel")}</button>
          <button className="primary" onClick={() => props.onSave(f)}>
            {t("Save")}
          </button>
        </div>
      </div>
    </div>
  );
}

function VariablesModal(props: {
  initial: Record<string, string>;
  onClose: () => void;
  onSave: (vars: Record<string, string>) => void | Promise<void>;
}) {
  const [rows, setRows] = useState<{ name: string; value: string }[]>(() =>
    Object.entries(props.initial).map(([name, value]) => ({ name, value }))
  );

  function update(i: number, patch: Partial<{ name: string; value: string }>) {
    setRows((prev) =>
      prev.map((r, idx) => (idx === i ? { ...r, ...patch } : r))
    );
  }

  function add() {
    setRows((prev) => [...prev, { name: "", value: "" }]);
  }

  function remove(i: number) {
    setRows((prev) => prev.filter((_, idx) => idx !== i));
  }

  async function save() {
    const out: Record<string, string> = {};
    for (const r of rows) {
      const k = r.name.trim().replace(/^\$/, "");
      if (k === "") continue;
      out[k] = r.value;
    }
    await props.onSave(out);
  }

  return (
    <div className="modal-bg" onClick={props.onClose}>
      <div className="modal vars-modal" onClick={(e) => e.stopPropagation()}>
        <div className="modal-head">
          <span>{t("Project variables")}</span>
          <button onClick={props.onClose}>×</button>
        </div>
        <div className="vars-body">
          <div className="vars-help">
            {t(
              "Reference them in CSS and attribute values like $colorMain. Saved to variables: in htfl.yaml."
            )}
          </div>
          <div className="vars-table">
            <div className="vars-row vars-row-head">
              <div className="vars-col-name">name</div>
              <div className="vars-col-value">value</div>
              <div className="vars-col-actions"></div>
            </div>
            {rows.length === 0 && (
              <div className="vars-empty">
                {t("No variables yet. Use “＋ Add variable” to create one.")}
              </div>
            )}
            {rows.map((r, i) => (
              <div className="vars-row" key={i}>
                <div className="vars-col-name">
                  <span className="vars-prefix">$</span>
                  <input
                    spellCheck={false}
                    placeholder="colorMain"
                    value={r.name}
                    onChange={(e) => update(i, { name: e.target.value })}
                  />
                </div>
                <div className="vars-col-value">
                  <input
                    spellCheck={false}
                    placeholder="#39b54a"
                    value={r.value}
                    onChange={(e) => update(i, { value: e.target.value })}
                  />
                  {/^#[0-9a-fA-F]{3,8}$/.test(r.value.trim()) && (
                    <span
                      className="vars-color-chip"
                      style={{ background: r.value.trim() }}
                      title={r.value}
                    />
                  )}
                </div>
                <div className="vars-col-actions">
                  <button
                    type="button"
                    title={t("Delete")}
                    onClick={() => remove(i)}
                  >
                    ×
                  </button>
                </div>
              </div>
            ))}
          </div>
          <button className="vars-add" type="button" onClick={add}>
            {t("＋ Add variable")}
          </button>
        </div>
        <div className="vars-foot">
          <button onClick={props.onClose}>{t("Cancel")}</button>
          <button className="primary" onClick={save}>
            {t("Save")}
          </button>
        </div>
      </div>
    </div>
  );
}

function ModuleRegisterModal(props: {
  tagLabel: string;
  defaultFileBase: string;
  existingFiles: string[];
  onClose: () => void;
  onSubmit: (moduleName: string, fileBase: string) => void;
}) {
  const [name, setName] = useState("");
  const [fileBase, setFileBase] = useState(props.defaultFileBase);

  function submit() {
    const n = name.trim();
    if (!n) return;
    props.onSubmit(n, fileBase.trim() || props.defaultFileBase);
  }

  return (
    <div className="modal-bg" onClick={props.onClose}>
      <div
        className="modal module-register-modal"
        onClick={(e) => e.stopPropagation()}
      >
        <div className="modal-head">
          <span>{t("Register as module")}</span>
          <button onClick={props.onClose}>×</button>
        </div>
        <div className="module-register-body">
          <div className="module-register-help">
            {t("Saves")} <code>&lt;{props.tagLabel}&gt;</code>{" "}
            {t(
              "and everything under it (CSS + SCRIPT + children) as a reusable module. Type .name in the tree to expand it."
            )}
          </div>
          <label className="module-register-field">
            <span>{t("Module name")}</span>
            <div className="module-register-input">
              <span className="module-register-dot">.</span>
              <input
                autoFocus
                spellCheck={false}
                placeholder="card"
                value={name}
                onChange={(e) => setName(e.target.value)}
                onKeyDown={(e) => {
                  if (e.key === "Enter") submit();
                }}
              />
            </div>
          </label>
          <label className="module-register-field">
            <span>{t("File name")}</span>
            <div className="module-register-input">
              <input
                spellCheck={false}
                list="module-files"
                value={fileBase}
                onChange={(e) => setFileBase(e.target.value)}
                onKeyDown={(e) => {
                  if (e.key === "Enter") submit();
                }}
              />
              <span className="module-register-ext">.yaml</span>
            </div>
            <datalist id="module-files">
              {props.existingFiles.map((f) => (
                <option key={f} value={f.replace(/\.ya?ml$/i, "")} />
              ))}
            </datalist>
          </label>
        </div>
        <div className="vars-foot">
          <button onClick={props.onClose}>{t("Cancel")}</button>
          <button className="primary" onClick={submit} disabled={!name.trim()}>
            {t("Register")}
          </button>
        </div>
      </div>
    </div>
  );
}

function PluginsModal(props: {
  plugins: LoadedPlugin[];
  hasSelection: boolean;
  appliedClasses: string[];
  onClose: () => void;
  onReload: () => void;
  onRunExporter: (plugin: LoadedPlugin, exp: ExporterDef) => void;
  onInsertSnippet: (s: SnippetEntry) => void;
  onApplyClass: (name: string) => void;
}) {
  return (
    <div className="modal-bg" onClick={props.onClose}>
      <div className="modal plugins-modal" onClick={(e) => e.stopPropagation()}>
        <div className="modal-head">
          <span>Plugins ({props.plugins.length})</span>
          <button onClick={props.onClose}>×</button>
        </div>
        <div className="plugins-body">
          <div className="plugins-toolbar">
            <button onClick={props.onReload}>⟳ Reload</button>
            <span className="plugins-hint">
              Loads each project's <code>plugins/&lt;name&gt;/plugin.yaml</code>
            </span>
          </div>
          {props.plugins.length === 0 ? (
            <div className="plugins-empty">
              No plugins.
              Create a folder under <code>plugins/</code>
              and add a <code>plugin.yaml</code>.
            </div>
          ) : (
            props.plugins.map((p) => (
              <div key={p.dir_name} className="plugin-card">
                <div className="plugin-card-head">
                  <span className="plugin-name">{p.manifest.name}</span>
                  {p.manifest.version && (
                    <span className="plugin-ver">v{p.manifest.version}</span>
                  )}
                  <span className="plugin-dir">{p.dir_name}</span>
                </div>
                {p.manifest.description && (
                  <div className="plugin-desc">{p.manifest.description}</div>
                )}
                {(p.manifest.exporters ?? []).length > 0 && (
                  <div className="plugin-section">
                    <div className="plugin-section-title">Exporters</div>
                    <div className="plugin-chip-row">
                      {p.manifest.exporters!.map((exp) => (
                        <button
                          key={exp.id}
                          className="plugin-chip exporter"
                          onClick={() => props.onRunExporter(p, exp)}
                        >
                          ▶ {exp.label}
                          {exp.extension ? ` (.${exp.extension})` : ""}
                        </button>
                      ))}
                    </div>
                  </div>
                )}
                {(p.manifest.classes ?? []).length > 0 && (
                  <div className="plugin-section">
                    <div className="plugin-section-title">
                      Class dictionary ({p.manifest.classes!.length})
                    </div>
                    <div className="plugin-chip-row">
                      {p.manifest.classes!.slice(0, 60).map((c) => {
                        const on = props.appliedClasses.includes(c.name);
                        return (
                          <button
                            key={c.name}
                            className={`plugin-chip dict ${on ? "on" : ""}`}
                            title={
                              props.hasSelection
                                ? `${c.description ?? ""}\nClick to apply/remove on the selected element`
                                : c.description
                            }
                            disabled={!props.hasSelection}
                            onClick={() => props.onApplyClass(c.name)}
                          >
                            {on ? "✓ " : ""}.{c.name}
                          </button>
                        );
                      })}
                      {p.manifest.classes!.length > 60 && (
                        <span className="plugin-chip muted">…</span>
                      )}
                    </div>
                  </div>
                )}
                {(p.manifest.snippets ?? []).length > 0 && (
                  <div className="plugin-section">
                    <div className="plugin-section-title">Snippets</div>
                    <div className="plugin-chip-row">
                      {p.manifest.snippets!.map((s) => (
                        <button
                          key={s.name}
                          className="plugin-chip snippet"
                          title={s.body}
                          disabled={!props.hasSelection}
                          onClick={() => props.onInsertSnippet(s)}
                        >
                          + {s.name}{" "}
                          <span className="snippet-kind">{s.kind}</span>
                        </button>
                      ))}
                    </div>
                  </div>
                )}
              </div>
            ))
          )}
        </div>
        <div className="plugins-foot">
          ⚠ Plugin JS runs in a worker, but only install plugins you trust.
        </div>
      </div>
    </div>
  );
}

// Close a modal when Escape is pressed. Shared by the P2 modals.
function useEscClose(onClose: () => void) {
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape") onClose();
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [onClose]);
}

function SettingsModal(props: {
  cssResetOn: boolean;
  outputMode: "ssr" | "ssr+js";
  onSetOutputMode: (m: "ssr" | "ssr+js") => void;
  locale: "en" | "ja";
  onSetLocale: (l: "en" | "ja") => void;
  editorTheme: EditorTheme;
  onSetEditorTheme: (t: EditorTheme) => void;
  hasProject: boolean;
  browserPath: string | null;
  onToggleCssReset: () => void;
  onPickBrowser: () => void;
  onClearBrowser: () => void;
  onResetPluginConsent: () => void;
  onClose: () => void;
}) {
  useEscClose(props.onClose);
  return (
    <div className="modal-bg" onClick={props.onClose}>
      <div
        className="modal settings-modal"
        role="dialog"
        aria-modal="true"
        aria-label={t("Settings")}
        onClick={(e) => e.stopPropagation()}
      >
        <div className="modal-head">
          <span>{t("Settings")}</span>
          <button aria-label={t("Close")} onClick={props.onClose}>
            ×
          </button>
        </div>
        <div className="settings-body">
          <section className="settings-row">
            <div className="settings-label">
              <strong>{t("Language")}</strong>
              <p>
                {t(
                  "Choose the UI language. English is the default; 日本語 is a language pack."
                )}
              </p>
            </div>
            <button
              className="settings-toggle"
              onClick={() =>
                props.onSetLocale(props.locale === "ja" ? "en" : "ja")
              }
            >
              {props.locale === "ja" ? "日本語" : "English"}
            </button>
          </section>

          <section className="settings-row">
            <div className="settings-label">
              <strong>{t("Editor theme")}</strong>
              <p>{t("Code editor background and syntax colors.")}</p>
            </div>
            <select
              className="settings-select"
              value={props.editorTheme}
              onChange={(e) =>
                props.onSetEditorTheme(e.target.value as EditorTheme)
              }
            >
              <option value="dark">Dark</option>
              <option value="light">Light</option>
              <option value="monokai">Monokai</option>
            </select>
          </section>

          <section className="settings-row">
            <div className="settings-label">
              <strong>{t("Output mode")}</strong>
              <p>
                {t(
                  "SSR = static HTML only (no SCRIPT/JS — displays with JavaScript disabled). SSR + JS = also emits interactive JS (per project)."
                )}
              </p>
            </div>
            <button
              className="settings-toggle"
              disabled={!props.hasProject}
              onClick={() =>
                props.onSetOutputMode(
                  props.outputMode === "ssr" ? "ssr+js" : "ssr"
                )
              }
            >
              {props.outputMode === "ssr"
                ? t("SSR (static)")
                : t("SSR + JS (dynamic)")}
            </button>
          </section>

          <section className="settings-row">
            <div className="settings-label">
              <strong>{t("CSS reset")}</strong>
              <p>
                {t(
                  "Disable browser default margin / padding / list-style etc. (per project)."
                )}
              </p>
            </div>
            <button
              className="settings-toggle"
              disabled={!props.hasProject}
              onClick={props.onToggleCssReset}
            >
              {props.cssResetOn ? t("ON ✓") : t("OFF (browser default)")}
            </button>
          </section>

          <section className="settings-row">
            <div className="settings-label">
              <strong>{t("Preview browser")}</strong>
              <p className="settings-path">
                {props.browserPath ?? t("(OS default browser)")}
              </p>
            </div>
            <div className="settings-actions">
              <button onClick={props.onPickBrowser}>{t("Choose...")}</button>
              <button
                disabled={!props.browserPath}
                onClick={props.onClearBrowser}
              >
                {t("Reset to default")}
              </button>
            </div>
          </section>

          <section className="settings-row">
            <div className="settings-label">
              <strong>{t("Plugin execution permission")}</strong>
              <p>
                {t(
                  "Plugins run arbitrary JavaScript. Resetting will ask for confirmation again on next run."
                )}
              </p>
            </div>
            <button onClick={props.onResetPluginConsent}>{t("Reset")}</button>
          </section>
        </div>
      </div>
    </div>
  );
}

const SHORTCUTS: { keys: string; desc: string }[] = [
  { keys: "Ctrl+S", desc: "Save (tree / selected element / class file)" },
  { keys: "Ctrl+Z", desc: "Undo" },
  { keys: "Ctrl+Y / Ctrl+Shift+Z", desc: "Redo" },
  { keys: "Ctrl+Shift+F", desc: "Search in project" },
  { keys: "Alt+T", desc: "Toggle the element editor (text / image)" },
  { keys: "Shift+Delete", desc: "Delete the selected element and its subtree" },
  { keys: "Alt+S", desc: "Edit the selected element's CSS" },
  { keys: "Alt+C", desc: "Go to the CLASSES tab" },
  { keys: "Alt+J", desc: "Edit the selected element's SCRIPT" },
  { keys: "Alt+R", desc: "RUN (open preview)" },
  { keys: "Alt+Shift+R", desc: "DEV (click-to-edit preview)" },
  { keys: "Alt+↑ / ↓", desc: "Move the selection up / down a row" },
  { keys: "Alt+←", desc: "Select the parent (from the editor: jump to the tag)" },
  { keys: "Alt+→", desc: "Select the next sibling (wraps)" },
  { keys: "Enter", desc: "Tree: add a child element" },
  { keys: "Shift+Enter", desc: "Tree: add a sibling / outdent an empty row" },
  { keys: "Tab / Shift+Tab", desc: "Tree: indent / outdent" },
  { keys: "Backspace (empty row)", desc: "Tree: outdent / delete the row" },
  { keys: "↑ / ↓", desc: "Tree: move between rows" },
  { keys: "Alt+Shift+↑ / ↓", desc: "Tree: reorder the selected row" },
  { keys: "Alt+Shift+← / →", desc: "Tree: outdent / indent" },
  { keys: "Ctrl+C / Ctrl+V", desc: "Tree: copy / paste an element with its subtree" },
  { keys: "Esc", desc: "Close dialog / autocomplete" },
];

function ShortcutsModal(props: { onClose: () => void }) {
  useEscClose(props.onClose);
  return (
    <div className="modal-bg" onClick={props.onClose}>
      <div
        className="modal shortcuts-modal"
        role="dialog"
        aria-modal="true"
        aria-label={t("Keyboard shortcuts")}
        onClick={(e) => e.stopPropagation()}
      >
        <div className="modal-head">
          <span>{t("Keyboard shortcuts")}</span>
          <button aria-label={t("Close")} onClick={props.onClose}>
            ×
          </button>
        </div>
        <div className="shortcuts-body">
          <table>
            <tbody>
              {SHORTCUTS.map((s) => (
                <tr key={s.keys}>
                  <td className="shortcut-keys">
                    <kbd>{s.keys}</kbd>
                  </td>
                  <td>{t(s.desc)}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </div>
    </div>
  );
}

function AboutModal(props: { onClose: () => void }) {
  useEscClose(props.onClose);
  return (
    <div className="modal-bg" onClick={props.onClose}>
      <div
        className="modal about-modal"
        role="dialog"
        aria-modal="true"
        aria-label={t("About Foling")}
        onClick={(e) => e.stopPropagation()}
      >
        <div className="modal-head">
          <span>{t("About Foling")}</span>
          <button aria-label={t("Close")} onClick={props.onClose}>
            ×
          </button>
        </div>
        <div className="about-body">
          <h2>Foling</h2>
          <p className="about-version">
            {t("Version")} {APP_VERSION}
          </p>
          <p>
            {t(
              "A desktop editor for HTFL (HyperText Foldering Language)."
            )}
          </p>
          <dl className="about-meta">
            <dt>{t("License")}</dt>
            <dd>AGPL-3.0-or-later</dd>
            <dt>{t("Built with")}</dt>
            <dd>Tauri 2 · React · TypeScript · Rust</dd>
          </dl>
          <p className="about-copyright">© 2026 大松雄斗</p>
          {REPO_URL && <p className="about-repo">{REPO_URL}</p>}
        </div>
      </div>
    </div>
  );
}

function ChangelogModal(props: { text: string; onClose: () => void }) {
  useEscClose(props.onClose);
  return (
    <div className="modal-bg" onClick={props.onClose}>
      <div
        className="modal changelog-modal"
        role="dialog"
        aria-modal="true"
        aria-label={t("Changelog")}
        onClick={(e) => e.stopPropagation()}
      >
        <div className="modal-head">
          <span>{t("Changelog")}</span>
          <button aria-label={t("Close")} onClick={props.onClose}>
            ×
          </button>
        </div>
        <div className="changelog-body">
          <pre>{props.text}</pre>
        </div>
      </div>
    </div>
  );
}

interface SearchHit {
  path: string;
  label: string;
  reason: string;
}

// Walk the in-memory tree and collect nodes matching the query against the
// tag name, id, classes, text content, and CSS. Purely client-side (no disk
// access) since read_tree already loaded every node's config.
function searchTree(root: TreeNode, queryRaw: string): SearchHit[] {
  const q = queryRaw.trim().toLowerCase();
  if (!q) return [];
  const hits: SearchHit[] = [];
  const walk = (n: TreeNode, depth: number) => {
    if (depth > 0) {
      const cfg = n.config ?? ({} as NodeConfig);
      const tag = (n.display_name || n.name || "").toLowerCase();
      const id = (cfg.id ?? "").toLowerCase();
      const classes = (cfg.classes ?? []).join(" ").toLowerCase();
      const content = (cfg.content ?? "").toLowerCase();
      const css = (cfg.css ?? "").toLowerCase();
      let reason = "";
      if (tag.includes(q)) reason = "tag";
      else if (id.includes(q)) reason = `id="${cfg.id}"`;
      else if (classes.includes(q)) reason = `class: ${(cfg.classes ?? []).join(" ")}`;
      else if (content.includes(q)) reason = "content";
      else if (css.includes(q)) reason = "CSS";
      if (reason) {
        hits.push({
          path: n.path,
          label: n.display_name || n.name,
          reason,
        });
      }
    }
    for (const c of n.children ?? []) walk(c, depth + 1);
  };
  walk(root, 0);
  return hits.slice(0, 200);
}

function SearchModal(props: {
  tree: TreeNode;
  onJump: (path: string) => void;
  onClose: () => void;
}) {
  useEscClose(props.onClose);
  const [query, setQuery] = useState("");
  const inputRef = useRef<HTMLInputElement>(null);
  useEffect(() => {
    inputRef.current?.focus();
  }, []);
  const hits = useMemo(() => searchTree(props.tree, query), [props.tree, query]);
  return (
    <div className="modal-bg" onClick={props.onClose}>
      <div
        className="modal search-modal"
        role="dialog"
        aria-modal="true"
        aria-label="Search in project"
        onClick={(e) => e.stopPropagation()}
      >
        <div className="modal-head">
          <span>Search (tag / id / class / content / CSS)</span>
          <button aria-label="閉じる" onClick={props.onClose}>
            ×
          </button>
        </div>
        <div className="search-body">
          <input
            ref={inputRef}
            className="search-input"
            value={query}
            placeholder="Search keyword..."
            spellCheck={false}
            onChange={(e) => setQuery(e.target.value)}
            onKeyDown={(e) => {
              if (e.key === "Enter" && hits.length > 0) {
                props.onJump(hits[0].path);
              }
            }}
          />
          <div className="search-count">
            {query.trim()
              ? `${hits.length} hit(s)${hits.length >= 200 ? " (max)" : ""}`
              : "Type a keyword"}
          </div>
          <div className="search-results">
            {hits.map((h) => (
              <button
                key={h.path}
                className="search-hit"
                onClick={() => props.onJump(h.path)}
                title={h.path}
              >
                <span className="search-hit-tag">&lt;{h.label}&gt;</span>
                <span className="search-hit-reason">{h.reason}</span>
              </button>
            ))}
          </div>
        </div>
      </div>
    </div>
  );
}

function PreviewModal(props: { html: string; onClose: () => void }) {
  return (
    <div className="modal-bg" onClick={props.onClose}>
      <div className="modal" onClick={(e) => e.stopPropagation()}>
        <div className="modal-head">
          <span>Preview</span>
          <button onClick={props.onClose}>×</button>
        </div>
        <iframe
          className="preview-frame"
          srcDoc={props.html}
          title="preview"
          sandbox="allow-same-origin"
        />
        <details className="preview-source">
          <summary>HTML source</summary>
          <pre>{props.html}</pre>
        </details>
      </div>
    </div>
  );
}

function ImagesTab(props: {
  folders: ImageFolder[];
  selected: string | null;
  onSelectFolder: (n: string | null) => void;
  baseUrl: string;
  onApply: (relPath: string) => void;
  onRefresh: () => void;
  hasSelectedElement: boolean;
}) {
  const current = props.folders.find((f) => f.name === props.selected);
  return (
    <div className="images-tab">
      <div className="classes-list-pane">
        <div className="classes-list-toolbar">
          <button onClick={props.onRefresh} title="Reload">
            ⟳ Refresh
          </button>
        </div>
        <div className="classes-list-rows">
          {props.folders.length === 0 && (
            <div className="classes-list-empty">
              No subfolders under images/. Use your OS file explorer
              <br />
              to add folders with images, then press “Refresh”.
            </div>
          )}
          {props.folders.map((f) => (
            <div
              key={f.name}
              className={`classes-list-row ${
                props.selected === f.name ? "selected" : ""
              }`}
              onClick={() => props.onSelectFolder(f.name)}
            >
              <div className="classes-list-row-name">{f.name}</div>
              <div className="images-row-sub">{f.images.length}</div>
            </div>
          ))}
        </div>
        <div className="classes-help">
          Select an element, then click an image:
          for <code>&lt;img&gt;</code> it sets <code>src</code>, otherwise
          it is applied as <code>background-image</code>.
        </div>
      </div>
      <div className="classes-detail-pane">
        {current ? (
          <div className="images-grid">
            {current.images.length === 0 && (
              <div className="editor-empty">
                No images in this folder
              </div>
            )}
            {current.images.map((rel) => {
              const fileName = rel.split("/").pop() ?? rel;
              const url = props.baseUrl
                ? `${props.baseUrl}/images/${rel}`
                : "";
              return (
                <button
                  key={rel}
                  type="button"
                  className="image-cell"
                  disabled={!props.hasSelectedElement}
                  title={
                    props.hasSelectedElement
                      ? `Click to apply: /images/${rel}`
                      : "Select an element in the DOM tree"
                  }
                  onClick={() => props.onApply(rel)}
                >
                  <div className="image-cell-thumb">
                    {url ? <img src={url} alt={fileName} /> : null}
                  </div>
                  <span className="image-cell-name">{fileName}</span>
                </button>
              );
            })}
          </div>
        ) : (
          <div className="editor-empty">
            Select an image folder on the left
          </div>
        )}
      </div>
    </div>
  );
}

function ClassesTab(props: {
  files: ClassFile[];
  selected: string | null;
  onSelect: (n: string | null) => void;
  content: string;
  onChangeContent: (v: string) => void;
  onAdd: () => void;
  onDelete: () => void;
  variables: Record<string, string>;
  classDefs: ClassDef[];
  /** Class names already registered for the currently-selected element. */
  availableClassNames: string[];
  appliedClassNames: string[];
  /** Toggle membership in the current element's available_classes pool. */
  onToggleAvailable: (name: string) => void;
  hasSelectedElement: boolean;
}) {
  // Classes parsed out of the currently-selected file.
  const chips = useMemo(() => {
    if (!props.selected) return [] as ClassDef[];
    return props.classDefs.filter((c) => c.source === props.selected);
  }, [props.classDefs, props.selected]);

  return (
    <div className="classes-tab">
      <div className="classes-list-pane">
        <div className="classes-list-toolbar">
          <button onClick={props.onAdd}>＋ New</button>
          <button onClick={props.onDelete} disabled={!props.selected}>
            － Delete
          </button>
        </div>
        <div className="classes-list-rows">
          {props.files.length === 0 && (
            <div className="classes-list-empty">
              No files. Use “＋ New” to add one.
            </div>
          )}
          {props.files.map((f) => (
            <div
              key={f.name}
              className={`classes-list-row ${
                props.selected === f.name ? "selected" : ""
              }`}
              onClick={() => props.onSelect(f.name)}
            >
              <div className="classes-list-row-name">{f.name}</div>
            </div>
          ))}
        </div>
        <div className="classes-help">
          The leading <code>01_</code>, <code>02_</code> sets the cascade order.
          Variables like <code>$colorMain</code> are also supported.
        </div>
      </div>
      <div className="classes-detail-pane">
        {props.selected ? (
          <>
            <div className="classes-chip-panel">
              <div className="classes-chip-header">
                <span className="classes-chip-title">
                  Classes in {props.selected} ({chips.length})
                </span>
                <span className="classes-chip-hint">
                  {props.hasSelectedElement
                    ? "Click to add to / remove from the selected element"
                    : "Select an element in the DOM tree"}
                </span>
              </div>
              <div className="classes-chip-list">
                {chips.length === 0 && (
                  <div className="css-section-empty">
                    No class definitions in this file
                  </div>
                )}
                {chips.map((c, i) => {
                  const stripped = c.name.replace(/^\./, "");
                  const inPool =
                    props.availableClassNames.includes(stripped) ||
                    props.appliedClassNames.includes(stripped);
                  return (
                    <button
                      key={`${c.source}:${c.name}:${i}`}
                      type="button"
                      className={`class-chip ${inPool ? "added" : ""}`}
                      disabled={!props.hasSelectedElement}
                      title={
                        props.hasSelectedElement
                          ? inPool
                            ? "Remove from the selected element's list"
                            : "Add to the selected element's list"
                          : "No element selected"
                      }
                      onClick={() => props.onToggleAvailable(stripped)}
                    >
                      <span className="class-chip-check">
                        {inPool ? "✓" : "+"}
                      </span>
                      <span className="class-chip-name">{c.name}</span>
                    </button>
                  );
                })}
              </div>
            </div>
            <div className="classes-editor-pane">
              <CssBareEditor
                value={props.content}
                onChange={props.onChangeContent}
                variables={props.variables}
              />
            </div>
          </>
        ) : (
          <div className="editor-empty">
            Select a file from the list on the left, or add one with “＋ New”
          </div>
        )}
      </div>
    </div>
  );
}
