// SPDX-License-Identifier: AGPL-3.0-or-later
// Copyright (C) 2026 大松雄斗

import { describe, it, expect } from "vitest";
import {
  FlatRow,
  basenameOf,
  findSubtreeRange,
  getVisibleRows,
  lineNumPad,
  countSnapshotNodes,
  moduleOutline,
  nnOf,
  snapshotHasScript,
  rowsToParsedTree,
  sanitizeTagForFolder,
  duplicatePageIds,
  ownIdOf,
  pageIdOf,
} from "./treeModel";

const row = (
  id: string,
  depth: number,
  name: string,
  extra: Partial<FlatRow> = {}
): FlatRow => ({ id, depth, name, collapsed: false, ...extra });

describe("nnOf", () => {
  it("parses a leading NN_ ordinal", () => {
    expect(nnOf("02_section")).toBe(2);
    expect(nnOf("10_div")).toBe(10);
  });
  it("returns null when there is no numeric prefix", () => {
    expect(nnOf("header")).toBeNull();
    expect(nnOf("_div")).toBeNull();
    expect(nnOf("")).toBeNull();
  });
});

describe("basenameOf", () => {
  it("takes the last segment for both separators", () => {
    expect(basenameOf("C:\\proj\\HTML\\02_body\\01_header")).toBe("01_header");
    expect(basenameOf("/proj/HTML/02_body")).toBe("02_body");
    expect(basenameOf("solo")).toBe("solo");
  });
});

describe("sanitizeTagForFolder", () => {
  it("keeps ASCII word chars and dashes", () => {
    expect(sanitizeTagForFolder("my-widget_1")).toBe("my-widget_1");
  });
  it("strips other characters and falls back to 'tag'", () => {
    expect(sanitizeTagForFolder("会社")).toBe("tag");
    expect(sanitizeTagForFolder("a b!c")).toBe("abc");
  });
});

describe("lineNumPad", () => {
  it("is at least 2 and scales with row count", () => {
    expect(lineNumPad(0)).toBe(2);
    expect(lineNumPad(9)).toBe(2);
    expect(lineNumPad(99)).toBe(2);
    expect(lineNumPad(100)).toBe(3);
  });
});

describe("rowsToParsedTree", () => {
  it("nests rows by depth", () => {
    const tree = rowsToParsedTree([
      row("a", 0, "body"),
      row("b", 1, "header"),
      row("c", 1, "main"),
      row("d", 2, "section"),
    ]);
    expect(tree).toHaveLength(1);
    expect(tree[0].name).toBe("body");
    expect(tree[0].children.map((c) => c.name)).toEqual(["header", "main"]);
    expect(tree[0].children[1].children[0].name).toBe("section");
  });

  it("assigns per-sibling NN_ ordinals to new rows", () => {
    const tree = rowsToParsedTree([
      row("a", 0, "body"),
      row("b", 1, "header"),
      row("c", 1, "footer"),
    ]);
    expect(tree[0].folderName).toBe("01_body");
    expect(tree[0].children[0].folderName).toBe("01_header");
    expect(tree[0].children[1].folderName).toBe("02_footer");
  });

  it("reuses an existing NN_ prefix but updates the tag part", () => {
    const tree = rowsToParsedTree([
      row("a", 0, "div", { actualPath: "/p/HTML/02_body/04_section" }),
    ]);
    // keep 04, swap tag → 04_div (no renumber)
    expect(tree[0].folderName).toBe("04_div");
  });

  it("continues numbering new siblings after a matched one", () => {
    const tree = rowsToParsedTree([
      row("p", 0, "body", { actualPath: "/p/HTML/02_body" }),
      row("a", 1, "header", { actualPath: "/p/HTML/02_body/03_header" }),
      row("b", 1, "footer"), // new → max(3)+1 = 4
    ]);
    expect(tree[0].children[0].folderName).toBe("03_header");
    expect(tree[0].children[1].folderName).toBe("04_footer");
  });

  it("skips blank-name rows", () => {
    const tree = rowsToParsedTree([
      row("a", 0, "body"),
      row("b", 1, "   "),
      row("c", 1, "main"),
    ]);
    expect(tree[0].children.map((c) => c.name)).toEqual(["main"]);
  });

  it("clamps an over-deep indent to parent depth + 1", () => {
    const tree = rowsToParsedTree([
      row("a", 0, "body"),
      row("b", 5, "child"), // jumps from 0 to 5 → clamped to 1
    ]);
    expect(tree[0].children[0].name).toBe("child");
  });

  // Ordinals decide disk order, and equal ordinals make the builder fall back
  // to sorting by folder name — so a duplicate does not merely look untidy, it
  // silently reorders the tree alphabetically behind the user's back.
  const ordinals = (nodes: { folderName: string }[]) =>
    nodes.map((c) => c.folderName);

  it("gives a row inserted above an existing sibling the lower ordinal", () => {
    const tree = rowsToParsedTree([
      row("p", 0, "body", { actualPath: "/p/HTML/02_body" }),
      row("n", 1, "article"), // new, inserted first
      row("h", 1, "header", { actualPath: "/p/HTML/02_body/01_header" }),
    ]);
    expect(ordinals(tree[0].children)).toEqual(["01_article", "02_header"]);
  });

  it("keeps row order when a new row lands between two existing ones", () => {
    const tree = rowsToParsedTree([
      row("p", 0, "body", { actualPath: "/p/HTML/02_body" }),
      row("h", 1, "header", { actualPath: "/p/HTML/02_body/01_header" }),
      row("n", 1, "main"), // new, in the middle
      row("f", 1, "footer", { actualPath: "/p/HTML/02_body/02_footer" }),
    ]);
    expect(ordinals(tree[0].children)).toEqual([
      "01_header",
      "02_main",
      "03_footer",
    ]);
  });

  it("never repeats an ordinal among siblings", () => {
    const tree = rowsToParsedTree([
      row("p", 0, "body", { actualPath: "/p/HTML/02_body" }),
      row("a", 1, "a"),
      row("b", 1, "b", { actualPath: "/p/HTML/02_body/01_b" }),
      row("c", 1, "c"),
      row("d", 1, "d", { actualPath: "/p/HTML/02_body/02_d" }),
    ]);
    const nns = tree[0].children.map((c) => nnOf(c.folderName));
    expect(new Set(nns).size).toBe(nns.length);
    // ...and they increase, so sorting by ordinal reproduces the row order.
    expect([...nns].sort((x, y) => (x ?? 0) - (y ?? 0))).toEqual(nns);
  });

  it("renames nothing when the disk order is already correct", () => {
    // Opening a project must not trigger a mass renumber: every rename is a
    // chance for another handle holder on Windows to refuse it.
    const tree = rowsToParsedTree([
      row("p", 0, "body", { actualPath: "/p/HTML/02_body" }),
      row("a", 1, "header", { actualPath: "/p/HTML/02_body/01_header" }),
      row("b", 1, "main", { actualPath: "/p/HTML/02_body/05_main" }),
      row("c", 1, "footer", { actualPath: "/p/HTML/02_body/09_footer" }),
    ]);
    // Gaps and all — untouched.
    expect(ordinals(tree[0].children)).toEqual([
      "01_header",
      "05_main",
      "09_footer",
    ]);
  });

  it("repairs duplicate ordinals left by earlier versions", () => {
    const tree = rowsToParsedTree([
      row("p", 0, "body", { actualPath: "/p/HTML/02_body" }),
      row("a", 1, "article", { actualPath: "/p/HTML/02_body/01_article" }),
      row("h", 1, "header", { actualPath: "/p/HTML/02_body/01_header" }),
    ]);
    expect(ordinals(tree[0].children)).toEqual(["01_article", "02_header"]);
  });

  it("leaves an unnumbered folder alone without disturbing its siblings", () => {
    const tree = rowsToParsedTree([
      row("p", 0, "body", { actualPath: "/p/HTML/02_body" }),
      row("h", 1, "header", { actualPath: "/p/HTML/02_body/header" }),
      row("n", 1, "main"),
    ]);
    expect(ordinals(tree[0].children)).toEqual(["header", "01_main"]);
  });
});

describe("module snapshots", () => {
  // Shaped like the shipped drawermenu module: a root with classes, a child
  // carrying script, and a grandchild with text.
  const snap = {
    name: "01_div",
    config: { classes: ["drawer"] },
    children: [
      {
        name: "01_button",
        config: { js: "el.addEventListener('click', () => {});" },
        children: [],
      },
      {
        name: "02_nav",
        config: { classes: ["drawer-panel", "is-open"] },
        children: [
          { name: "01_a", config: { content: "  Home  " }, children: [] },
        ],
      },
    ],
  };

  it("flattens the subtree in expansion order, with depths", () => {
    expect(moduleOutline(snap).map((r) => [r.depth, r.tag])).toEqual([
      [0, "div"],
      [1, "button"],
      [1, "nav"],
      [2, "a"],
    ]);
  });

  it("surfaces classes and trimmed text for each row", () => {
    const rows = moduleOutline(snap);
    expect(rows[0].classes).toEqual(["drawer"]);
    expect(rows[2].classes).toEqual(["drawer-panel", "is-open"]);
    expect(rows[3].content).toBe("Home");
    expect(rows[1].content).toBeUndefined();
  });

  it("counts every element the module will add", () => {
    expect(countSnapshotNodes(snap)).toBe(4);
    expect(countSnapshotNodes({ name: "01_div" })).toBe(1);
  });

  it("finds script anywhere in the subtree", () => {
    expect(snapshotHasScript(snap)).toBe(true);
    expect(snapshotHasScript(snap.children[1])).toBe(false);
  });

  it("does not mistake the word js in text or a class for script", () => {
    // The obvious shortcut — searching the serialised snapshot for "js" —
    // reports these as scripted.
    expect(
      snapshotHasScript({
        name: "01_p",
        config: { classes: ["js-toggle"], content: 'about "js" files' },
      })
    ).toBe(false);
    // Whitespace-only js is not script either.
    expect(
      snapshotHasScript({ name: "01_p", config: { js: "   \n " } })
    ).toBe(false);
  });
});

describe("getVisibleRows", () => {
  it("hides descendants of a collapsed row", () => {
    const rows = [
      row("a", 0, "body"),
      row("b", 1, "ul", { collapsed: true }),
      row("c", 2, "li"),
      row("d", 2, "li"),
      row("e", 1, "footer"),
    ];
    const visible = getVisibleRows(rows).map((v) => v.row.id);
    expect(visible).toEqual(["a", "b", "e"]); // li children hidden
  });

  it("flags rows that have children", () => {
    const vis = getVisibleRows([row("a", 0, "body"), row("b", 1, "p")]);
    expect(vis[0].hasChildren).toBe(true);
    expect(vis[1].hasChildren).toBe(false);
  });
});

describe("findSubtreeRange", () => {
  it("spans the row plus all deeper descendants", () => {
    const rows = [
      row("a", 0, "body"),
      row("b", 1, "ul"),
      row("c", 2, "li"),
      row("d", 1, "footer"),
    ];
    expect(findSubtreeRange(rows, 1)).toEqual([1, 3]); // ul + li
    expect(findSubtreeRange(rows, 0)).toEqual([0, 4]); // whole tree
    expect(findSubtreeRange(rows, 3)).toEqual([3, 4]); // leaf
  });
});

describe("element ids", () => {
  it("emits the user's own id when there is one, else the fixed id", () => {
    expect(pageIdOf({ autoId: "e3" })).toBe("e3");
    expect(pageIdOf({ autoId: "e3", ownId: "hero" })).toBe("hero");
    expect(pageIdOf({})).toBeUndefined();
  });

  it("reads the own id from the id field, then a typed id attribute", () => {
    expect(ownIdOf({ id: "a", attributes: { id: "b" } })).toBe("a");
    expect(ownIdOf({ id: "  ", attributes: { id: "b" } })).toBe("b");
    expect(ownIdOf({ attributes: {} })).toBeUndefined();
  });

  it("flags only ids that more than one element would emit", () => {
    const dup = duplicatePageIds([
      { autoId: "e1" },
      { autoId: "e2", ownId: "x" },
      { autoId: "e3", ownId: "x" },
      { autoId: "e4" },
    ]);
    expect([...dup]).toEqual(["x"]);
  });
});
