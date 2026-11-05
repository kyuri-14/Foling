// SPDX-License-Identifier: AGPL-3.0-or-later
// Copyright (C) 2026 大松雄斗

import { describe, it, expect } from "vitest";
import {
  linkOpenTag,
  plainTextOfContent,
  textModeOf,
  wrapRuby,
  wrapSelection,
} from "./inlineMarkup";

describe("wrapSelection", () => {
  it("wraps the selection and keeps it selected", () => {
    const r = wrapSelection("say hello now", 4, 9, "<strong>", "</strong>");
    expect(r.value).toBe("say <strong>hello</strong> now");
    expect(r.value.slice(r.start, r.end)).toBe("hello");
  });

  it("inserts an empty pair with the caret inside when nothing is selected", () => {
    const r = wrapSelection("ab", 1, 1, "<mark>", "</mark>");
    expect(r.value).toBe("a<mark></mark>b");
    expect([r.start, r.end]).toEqual([7, 7]);
  });

  it("accepts a backwards selection", () => {
    expect(wrapSelection("xyz", 2, 1, "<b>", "</b>").value).toBe("x<b>y</b>z");
  });
});

describe("links and ruby", () => {
  it("quotes the URL safely", () => {
    expect(linkOpenTag(' /a?x="1" ')).toBe('<a href="/a?x=%221%22">');
  });

  it("puts the reading in <rt>", () => {
    const r = wrapRuby("漢字です", 0, 2, "かんじ");
    expect(r.value).toBe("<ruby>漢字<rt>かんじ</rt></ruby>です");
    expect(r.value.slice(r.start, r.end)).toBe("漢字");
  });
});

describe("plainTextOfContent", () => {
  it("drops inline tags and joins lines", () => {
    expect(plainTextOfContent('Read <a href="/x">this</a>\nand <b>that</b>')).toBe(
      "Read this and that"
    );
  });

  it("leaves other angle brackets alone", () => {
    expect(plainTextOfContent("the <body> element")).toBe("the <body> element");
  });

  it("is undefined for empty text", () => {
    expect(plainTextOfContent("  \n ")).toBeUndefined();
    expect(plainTextOfContent(undefined)).toBeUndefined();
  });
});

describe("textModeOf", () => {
  it("matches the builder's rules", () => {
    expect(textModeOf("p", false)).toBe("rich");
    expect(textModeOf("CODE", false)).toBe("literal");
    expect(textModeOf("span", true)).toBe("raw");
    for (const raw of ["script", "style", "title", "textarea", "option", "pre"]) {
      expect(textModeOf(raw, false)).toBe("raw");
    }
  });
});
