import { describe, it, expect } from "vitest";
import {
  FlatRow,
  basenameOf,
  findSubtreeRange,
  getVisibleRows,
  lineNumPad,
  nnOf,
  rowsToParsedTree,
  sanitizeTagForFolder,
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
