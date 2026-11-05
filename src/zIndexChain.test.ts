// SPDX-License-Identifier: AGPL-3.0-or-later
// Copyright (C) 2026 大松雄斗

import { describe, it, expect } from "vitest";
import { chainText, stackingChain, StackLevelInput } from "./zIndexChain";

const level = (
  depth: number,
  label: string,
  css: Record<string, string>,
  self = false
): StackLevelInput => ({ depth, label, self, decl: (p) => css[p] });

describe("stackingChain", () => {
  it("lists each level's own z-index instead of a sum", () => {
    const chain = stackingChain([
      level(1, "body", {}),
      level(2, "header", { position: "relative", "z-index": "100" }),
      level(3, "nav", { position: "absolute", "z-index": "10" }),
      level(4, "a", { position: "relative", "z-index": "5" }, true),
    ])!;
    expect(chain.map((l) => [l.depth, l.z, l.effective])).toEqual([
      [2, "100", true],
      [3, "10", true],
      [4, "5", true],
    ]);
    expect(chainText(chain)).toBe("header(2) 100 › nav(3) 10 › self 5");
  });

  it("marks a z-index on a non-positioned element as having no effect", () => {
    const chain = stackingChain([
      level(1, "body", {}),
      level(2, "div", { "z-index": "100" }, true),
    ])!;
    expect(chain[0]).toMatchObject({
      z: "100",
      effective: false,
      problem: "not-positioned",
      context: null,
    });
  });

  it("lets flex and grid items use z-index without position", () => {
    for (const display of ["flex", "inline-grid"]) {
      const chain = stackingChain([
        level(1, "ul", { display }),
        level(2, "li", { "z-index": "3" }, true),
      ])!;
      expect(chain[0]).toMatchObject({ effective: true, context: "z-index" });
    }
  });

  it("shows levels that cap z-index without declaring one", () => {
    const chain = stackingChain([
      level(1, "body", {}),
      level(2, "section", { opacity: "0.9" }),
      level(3, "div", { transform: "translateX(1px)" }),
      level(4, "p", { position: "relative", "z-index": "999" }, true),
    ])!;
    expect(chain.map((l) => [l.label, l.z, l.context])).toEqual([
      ["section", null, "opacity"],
      ["div", null, "transform"],
      ["p", "999", "z-index"],
    ]);
  });

  it("flags values that are not a z-index", () => {
    const chain = stackingChain([
      level(1, "div", { position: "relative", "z-index": "high" }, true),
    ])!;
    expect(chain[0]).toMatchObject({ effective: false, problem: "invalid" });
  });

  it("returns null when nothing declares a z-index", () => {
    expect(
      stackingChain([level(1, "body", { opacity: "0.5" }), level(2, "p", {}, true)])
    ).toBeNull();
  });

  it("always ends with the element itself, even without a z-index", () => {
    const chain = stackingChain([
      level(1, "header", { position: "fixed", "z-index": "50" }),
      level(2, "span", {}, true),
    ])!;
    expect(chain.map((l) => [l.self, l.z])).toEqual([
      [false, "50"],
      [true, null],
    ]);
  });
});
