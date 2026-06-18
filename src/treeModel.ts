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
// expects. Folder-name policy is conservative on purpose:
//
//   • Matched rows (already on disk) keep their existing `NN_` prefix; only
//     the tag part is updated. So opening a project never triggers a mass
//     renumber of unrelated folders — which on Windows is the difference
//     between "edit one element" and "every other handle holder (Explorer,
//     AV, search indexer) blocks the rename with ERROR_ACCESS_DENIED".
//
//   • New rows take the next-available NN among their siblings (max + 1),
//     so they slot in at the end of disk order without colliding.
//
// rowId is carried so the caller can re-select the row after apply.
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
  const usedNNs: Set<number>[] = [new Set()];
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
      usedNNs.pop();
    }
    const used = usedNNs[usedNNs.length - 1];
    let folderName: string;
    if (r.actualPath) {
      const existingBase = basenameOf(r.actualPath);
      const existingNN = nnOf(existingBase);
      if (existingNN != null) {
        // Reuse the disk prefix → tag-only rename is the only possible op.
        used.add(existingNN);
        folderName = `${String(existingNN).padStart(2, "0")}_${sanitizeTagForFolder(name)}`;
      } else {
        // No NN prefix on disk — leave the folder name alone.
        folderName = existingBase;
      }
    } else {
      // Brand-new row: append at the end with max+1.
      let next = 1;
      for (const n of used) if (n >= next) next = n + 1;
      used.add(next);
      folderName = `${String(next).padStart(2, "0")}_${sanitizeTagForFolder(name)}`;
    }
    const node: ParsedNode = {
      name,
      lineIndex: i,
      folderName,
      actualPath: r.actualPath,
      rowId: r.id,
      children: [],
    };
    stack[stack.length - 1].children.push(node);
    stack.push(node);
    depths.push(depth);
    usedNNs.push(new Set());
  });
  return root.children;
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
