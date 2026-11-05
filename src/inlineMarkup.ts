// SPDX-License-Identifier: AGPL-3.0-or-later
// Copyright (C) 2026 大松雄斗

// Editing helpers for inline tags in an element's text.
//
// Which tags count, and how they render, is decided in one place — the Rust
// builder (src-tauri/src/htfl/inline.rs), which the editor's preview also
// calls. These helpers only insert tags while typing and strip them for the
// one-line previews in the tree.

/** Phrasing tags that may be written inside an element's text. Keep in step
 *  with INLINE_TAGS in src-tauri/src/htfl/inline.rs. */
export const INLINE_TAGS = [
  "a", "strong", "em", "b", "i", "u", "s", "mark", "small", "code", "kbd",
  "sub", "sup", "span", "br", "ruby", "rt", "rp",
] as const;

/** How an element's text is rendered. Mirrors text_mode() in
 *  src-tauri/src/htfl/inline.rs: "rich" — inline tags are markup and a line
 *  break is <br>; "literal" — all text, line break is <br> (code, kbd, samp);
 *  "raw" — the text as written (script, style, title, textarea, option, and
 *  anything inside <pre>). */
export type TextMode = "rich" | "literal" | "raw";

export function textModeOf(tag: string, inPre: boolean): TextMode {
  if (inPre) return "raw";
  switch (tag.toLowerCase()) {
    case "script":
    case "style":
    case "title":
    case "textarea":
    case "option":
    case "pre":
      return "raw";
    case "code":
    case "kbd":
    case "samp":
      return "literal";
    default:
      return "rich";
  }
}

export interface TextEdit {
  value: string;
  /** Selection to restore after the edit. */
  start: number;
  end: number;
}

/**
 * Wrap `value[start, end)` in `open` … `close`. With nothing selected the tags
 * are inserted with the caret between them, ready to type into; with a
 * selection, the wrapped text stays selected.
 */
export function wrapSelection(
  value: string,
  start: number,
  end: number,
  open: string,
  close: string
): TextEdit {
  const [s, e] = start <= end ? [start, end] : [end, start];
  const inner = value.slice(s, e);
  return {
    value: value.slice(0, s) + open + inner + close + value.slice(e),
    start: s + open.length,
    end: s + open.length + inner.length,
  };
}

/** `<a href="…">` for a URL the user typed. A `"` would end the value early
 *  (and is not valid in a URL anyway), so it is percent-encoded; everything
 *  else is escaped by the builder on output. */
export function linkOpenTag(url: string): string {
  return `<a href="${url.trim().replace(/"/g, "%22")}">`;
}

/**
 * Ruby for the selected text: `<ruby>漢字<rt>かんじ</rt></ruby>`. The reading
 * goes in <rt>; with nothing selected the caret lands on the base text.
 */
export function wrapRuby(
  value: string,
  start: number,
  end: number,
  reading: string
): TextEdit {
  const [s, e] = start <= end ? [start, end] : [end, start];
  const base = value.slice(s, e);
  const open = "<ruby>";
  const close = `<rt>${reading}</rt></ruby>`;
  return {
    value: value.slice(0, s) + open + base + close + value.slice(e),
    start: s + open.length,
    end: s + open.length + base.length,
  };
}

const TAG_RE = new RegExp(
  `</?(?:${INLINE_TAGS.join("|")})(?:\\s[^<>]*)?/?>`,
  "gi"
);

/** The text a reader would see, on one line — for tree previews. */
export function plainTextOfContent(content: string | undefined): string | undefined {
  if (!content) return undefined;
  const text = content.replace(TAG_RE, "").replace(/\s+/g, " ").trim();
  return text || undefined;
}
