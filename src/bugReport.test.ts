// SPDX-License-Identifier: AGPL-3.0-or-later
// Copyright (C) 2026 大松雄斗

import { beforeEach, describe, expect, it } from "vitest";
import {
  buildReport,
  clearCaptured,
  countRedactions,
  issueUrl,
  logAction,
  logError,
  redact,
  setActionLogEnabled,
} from "./bugReport";

beforeEach(() => {
  clearCaptured();
  setActionLogEnabled(false);
});

// A report is headed for a public issue tracker, so the tests that matter are
// the ones about what must *not* end up in it.
describe("redact", () => {
  it("folds a Windows home directory away", () => {
    const out = redact("at C:\\Users\\大松雄斗\\Documents\\site\\HTML");
    expect(out).toContain("[REDACTED]\\Documents\\site\\HTML");
    expect(out).not.toContain("大松雄斗");
  });

  it("folds macOS and Linux home directories", () => {
    expect(redact("/Users/yuto/dev/x")).toBe("[REDACTED]/dev/x");
    expect(redact("/home/yuto/dev/x")).toBe("[REDACTED]/dev/x");
  });

  it("redacts every occurrence, not just the first", () => {
    const out = redact("C:\\Users\\a\\one and C:\\Users\\a\\two");
    expect(out).not.toContain("Users\\a");
  });

  it("counts what it would remove, so 'none' is distinguishable from 'failed'", () => {
    expect(countRedactions("C:\\Users\\a\\x and /home/b/y")).toBe(2);
    expect(countRedactions("no paths here")).toBe(0);
  });
});

describe("report privacy section", () => {
  it("says how many paths were removed", () => {
    logError("failed at C:\\Users\\大松雄斗\\p\\htfl.yaml", "app");
    const out = buildReport({ appVersion: "1", includeActions: false });
    expect(out).toContain("1 file path(s)");
    expect(out).toContain("[REDACTED]");
    expect(out).not.toContain("大松雄斗");
  });

  it("says so plainly when there was nothing to remove", () => {
    logError("something broke", "app");
    const out = buildReport({ appVersion: "1", includeActions: false });
    expect(out).toContain("No file paths were found");
  });
});

describe("action log", () => {
  it("records nothing until the user opts in", () => {
    logAction("opened project");
    expect(buildReport({ appVersion: "1", includeActions: true })).not.toContain(
      "opened project"
    );

    setActionLogEnabled(true);
    logAction("opened project");
    expect(buildReport({ appVersion: "1", includeActions: true })).toContain(
      "opened project"
    );
  });

  it("stays out of the report when the user declines to attach it", () => {
    setActionLogEnabled(true);
    logAction("selected element");
    const out = buildReport({ appVersion: "1", includeActions: false });
    expect(out).not.toContain("selected element");
  });

  it("drops what it holds when switched off", () => {
    setActionLogEnabled(true);
    logAction("secret step");
    setActionLogEnabled(false);
    setActionLogEnabled(true);
    expect(buildReport({ appVersion: "1", includeActions: true })).not.toContain(
      "secret step"
    );
  });
});

describe("buildReport", () => {
  it("includes the version and captured errors", () => {
    logError("boom", "uncaught", "Error: boom\n  at foo");
    const out = buildReport({ appVersion: "0.12.5", includeActions: false });
    expect(out).toContain("0.12.5");
    expect(out).toContain("boom");
    expect(out).toContain("at foo");
  });

  it("collapses a repeated error instead of flooding the report", () => {
    for (let i = 0; i < 50; i++) logError("same", "uncaught");
    const out = buildReport({ appVersion: "1", includeActions: false });
    expect(out).toContain("Errors (1)");
  });

  it("redacts paths that arrive through an error message", () => {
    logError("ENOENT: C:\\Users\\大松雄斗\\p\\htfl.yaml", "app");
    const out = buildReport({ appVersion: "1", includeActions: false });
    expect(out).not.toContain("大松雄斗");
  });
});

describe("issueUrl", () => {
  it("puts the title and body in the query string", () => {
    const url = issueUrl("https://github.com/o/r", "crash", "body text");
    expect(url.startsWith("https://github.com/o/r/issues/new?")).toBe(true);
    expect(url).toContain("title=crash");
    expect(url).toContain("body+text");
  });

  it("truncates a body too long for a URL", () => {
    const url = issueUrl("https://github.com/o/r", "t", "x".repeat(9000));
    expect(url).toContain("truncated");
    expect(url.length).toBeLessThan(9000);
  });
});
