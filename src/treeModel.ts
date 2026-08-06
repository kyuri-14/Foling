// SPDX-License-Identifier: AGPL-3.0-or-later
// Copyright (C) 2026 大松雄斗

// Pure tree-model helpers for the row-based DOM tree editor.
//
// These functions have no React or Tauri dependencies, which keeps them unit
// testable in isolation (see treeModel.test.ts) and decouples the core
// folder-naming / flattening logic from the giant App component.

export interface FlatRow {
  id: string;
  depth: number;
  name: string;
  /** Absolute path on disk, when this row was synced from the actual tree. */
  actualPath?: string;
  collapsed: boolean;
  /** Inline hints derived from the element's config (shown next to the tag). */
  content?: string; // text content, if any
  imageLabel?: string; // image filename (img src) or "bg-image"
  badges?: string[]; // key CSS hints: flex / grid / absolute / hidden / ...
}

export interface RowMeta {
  content?: string;
  imageLabel?: string;
  badges: string[];
}

// Derive the inline tree-row hints (content preview, image marker, key CSS
// badges) from an element's tag + config. Pure so it stays unit-testable.
export function rowMetaFromConfig(
  tag: string,
  config: {
    css?: string;
    content?: string;
    attributes?: Record<string, string>;
  }
): RowMeta {
  const css = config.css ?? "";
  const attrs = config.attributes ?? {};
  const badges: string[] = [];

  const disp = /(?:^|[;{\s])display\s*:\s*([a-z-]+)/i.exec(css);
  if (disp) {
    const map: Record<string, string> = {
      flex: "flex",
      "inline-flex": "inline-flex",
      grid: "grid",
      "inline-grid": "inline-grid",
      none: "hidden",
      "inline-block": "inline-block",
      inline: "inline",
    };
    const v = map[disp[1].toLowerCase()];
    if (v) badges.push(v);
  }
  if (badges.includes("flex") || badges.includes("inline-flex")) {
    const fd = /flex-direction\s*:\s*(column|row)/i.exec(css);
    if (fd) badges.push(fd[1].toLowerCase() === "column" ? "col" : "row");
  }
  const pos = /(?:^|[;{\s])position\s*:\s*(absolute|fixed|sticky)/i.exec(css);
  if (pos) badges.push(pos[1].toLowerCase());

  let imageLabel: string | undefined;
  if (tag === "img" && attrs.src) imageLabel = basenameOf(attrs.src);
  else if (/background-image\s*:\s*url\(/i.test(css)) imageLabel = "bg-image";

  const content = config.content?.trim() || undefined;
  return { content, imageLabel, badges };
}

export interface ParsedNode {
  name: string; // tag name shown in the tree
  lineIndex: number; // index into rows array
  folderName: string; // desired on-disk folder name (`NN_tag`)
  actualPath?: string; // path of the existing on-disk node, if any
  rowId: string; // originating FlatRow id (for post-apply re-select)
  children: ParsedNode[];
}

export interface VisibleRow {
  row: FlatRow;
  index: number;
  hasChildren: boolean;
}

/** Zero-pad width for the line-number gutter. */
export function lineNumPad(rowsLength: number): number {
  return Math.max(2, String(Math.max(rowsLength, 1)).length);
}

/** Sanitize a tag name for the filesystem (keep ASCII alphanumerics + `-_`). */
export function sanitizeTagForFolder(name: string): string {
  return name.replace(/[^a-zA-Z0-9_-]/g, "") || "tag";
}

/** Last path segment, splitting on both `/` and `\`. */
export function basenameOf(path: string): string {
  const m = /[^/\\]+$/.exec(path);
  return m ? m[0] : "";
}

/** Parse the leading `NN_` ordinal of a folder name, or null if absent. */
export function nnOf(folderName: string): number | null {
  const m = /^(\d+)_/.exec(folderName);
  if (!m) return null;
  const n = parseInt(m[1], 10);
  return Number.isNaN(n) ? null : n;
}

// Convert the flat row list into the nested ParsedNode tree applyTreeDiff
// expects. rowId is carried so the caller can re-select the row after apply.
//
// Structure first, folder names second: a row's `NN_` ordinal depends on all of
// its siblings, so it cannot be decided while still streaming through the list.
// Assigning as we went used to hand a new row the next ordinal free *among the
// siblings seen so far*, which duplicated the ordinal of any sibling below it —
// and duplicates make the builder fall back to sorting by folder name, so the
// tree silently reordered itself alphabetically on the next save.
export function rowsToParsedTree(rows: FlatRow[]): ParsedNode[] {
  const root: ParsedNode = {
    name: "",
    lineIndex: -1,
    folderName: "",
    rowId: "",
    children: [],
  };
  const stack: ParsedNode[] = [root];
  const depths: number[] = [-1];
  rows.forEach((r, i) => {
    const name = r.name.trim();
    if (!name) return;
    let depth = r.depth;
    if (depth > depths[depths.length - 1] + 1) {
      depth = depths[depths.length - 1] + 1;
    }
    while (depths[depths.length - 1] >= depth) {
      stack.pop();
      depths.pop();
    }
    const node: ParsedNode = {
      name,
      lineIndex: i,
      folderName: "",
      actualPath: r.actualPath,
      rowId: r.id,
      children: [],
    };
    stack[stack.length - 1].children.push(node);
    stack.push(node);
    depths.push(depth);
  });
  assignFolderNames(root);
  return root.children;
}

// Give every child a `NN_tag` folder name whose ordinal is strictly greater
// than its previous sibling's, so disk order (sorted by NN) always matches the
// order shown in the editor.
//
// An existing ordinal is kept whenever it is already large enough, which is the
// common case: opening a project renames nothing, and a plain edit renames only
// what the new position actually forces. That restraint matters on Windows,
// where every extra rename is another chance for Explorer / AV / the search
// indexer to answer with ERROR_ACCESS_DENIED.
function assignFolderNames(parent: ParsedNode): void {
  let lastNN = 0;
  for (const child of parent.children) {
    const existingBase = child.actualPath ? basenameOf(child.actualPath) : null;
    const existingNN = existingBase ? nnOf(existingBase) : null;

    if (existingBase && existingNN == null) {
      // Unnumbered folder on disk (e.g. plain `header`): left alone entirely,
      // and left out of the numbering so it cannot push its siblings around.
      child.folderName = existingBase;
    } else {
      const nn = existingNN != null && existingNN > lastNN ? existingNN : lastNN + 1;
      lastNN = nn;
      child.folderName = `${String(nn).padStart(2, "0")}_${sanitizeTagForFolder(
        child.name
      )}`;
    }
    assignFolderNames(child);
  }
}

// ---------- Module snapshots ----------
//
// A module is a captured subtree, and the MODULES tab has to describe one
// before the user commits to stamping it into the page. These read a snapshot
// without needing the disk, which is also what makes them testable.

/** Minimal shape of a captured subtree — matches NodeSnapshot in types.ts. */
export interface SnapshotLike {
  name: string;
  config?: {
    classes?: string[];
    content?: string;
    css?: string;
    js?: string;
  };
  children?: SnapshotLike[];
}

export interface OutlineRow {
  depth: number;
  tag: string;
  classes: string[];
  content?: string;
  /** The element's own declarations and script, so a row can be inspected
   *  without walking back into the snapshot for it. */
  css?: string;
  js?: string;
}

/** Flatten a snapshot into indented rows, the way it will look once expanded. */
export function moduleOutline(
  snap: SnapshotLike,
  depth = 0,
  out: OutlineRow[] = []
): OutlineRow[] {
  const c = snap.config ?? {};
  out.push({
    depth,
    tag: snap.name.replace(/^\d+_/, ""),
    classes: c.classes ?? [],
    content: c.content?.trim() || undefined,
    css: c.css?.trim() || undefined,
    js: c.js?.trim() || undefined,
  });
  for (const child of snap.children ?? []) moduleOutline(child, depth + 1, out);
  return out;
}

/** How many elements expanding this module will add. */
export function countSnapshotNodes(snap: SnapshotLike): number {
  return (
    1 + (snap.children ?? []).reduce((n, c) => n + countSnapshotNodes(c), 0)
  );
}

/** Whether any element in the subtree carries per-element JavaScript. Walks the
 *  tree rather than searching the serialised snapshot for `"js"`, which would
 *  also match a class or a piece of text that happened to contain it. */
export function snapshotHasScript(snap: SnapshotLike): boolean {
  if ((snap.config?.js ?? "").trim() !== "") return true;
  return (snap.children ?? []).some(snapshotHasScript);
}

/** Filter out rows that live under a collapsed ancestor. */
export function getVisibleRows(rows: FlatRow[]): VisibleRow[] {
  const out: VisibleRow[] = [];
  let skipUntilDepth = -1;
  for (let i = 0; i < rows.length; i++) {
    const r = rows[i];
    if (skipUntilDepth >= 0) {
      if (r.depth > skipUntilDepth) continue;
      skipUntilDepth = -1;
    }
    const hasChildren = i + 1 < rows.length && rows[i + 1].depth > r.depth;
    out.push({ row: r, index: i, hasChildren });
    if (hasChildren && r.collapsed) skipUntilDepth = r.depth;
  }
  return out;
}

/** [start, end) — the row plus all its descendants. */
export function findSubtreeRange(rows: FlatRow[], i: number): [number, number] {
  const base = rows[i].depth;
  let end = i + 1;
  while (end < rows.length && rows[end].depth > base) end++;
  return [i, end];
}
