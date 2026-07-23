// SPDX-License-Identifier: AGPL-3.0-or-later
// Copyright (C) 2026 大松雄斗

import { describe, expect, it } from "vitest";
import { countMatches, highlight, markMatches } from "./syntax";

// markMatches rewrites the HTML the highlighter produced, so the risk it has to
// be held to is corrupting that markup — a <mark> opened inside a tag, or a
// syntax span lost. These check the seams rather than the happy path alone.
describe("markMatches", () => {
  it("marks hits and leaves the syntax spans intact", () => {
    const html = highlight("padding: 1rem;\ncolor: red;", "css");
    const out = markMatches(html, "color");
    expect(out).toContain('<mark class="find-hit">color</mark>');
    expect(out.match(/<span/g)?.length).toBe(html.match(/<span/g)?.length);
  });

  it("never opens a mark inside a tag", () => {
    // "span" and "class" occur in the markup itself, so a naive string replace
    // would rewrite the tags rather than the code.
    const html = highlight("span { color: red; }", "css");
    for (const q of ["span", "class", "syn"]) {
      expect(markMatches(html, q)).not.toMatch(/<[^>]*<mark/);
    }
  });

  it("is case-insensitive and preserves the original casing", () => {
    const out = markMatches(highlight("Color: Red;", "css"), "color");
    expect(out).toContain('<mark class="find-hit">Color</mark>');
  });

  it("finds text the highlighter had to escape", () => {
    const out = markMatches(highlight("a < b;", "js"), "<");
    expect(out).toContain('<mark class="find-hit">&lt;</mark>');
  });

  it("returns the html untouched for a blank query", () => {
    const html = highlight("color: red;", "css");
    expect(markMatches(html, "")).toBe(html);
    expect(markMatches(html, "   ")).toBe(html);
  });
});

describe("countMatches", () => {
  it("counts every occurrence, case-insensitively", () => {
    expect(countMatches("color: red; background-color: blue;", "color")).toBe(2);
    expect(countMatches("Color color COLOR", "color")).toBe(3);
    expect(countMatches("nothing here", "zzz")).toBe(0);
    expect(countMatches("anything", "")).toBe(0);
  });

  it("does not count overlapping matches twice", () => {
    expect(countMatches("aaaa", "aa")).toBe(2);
  });
});
