// SPDX-License-Identifier: AGPL-3.0-or-later
// Copyright (C) 2026 大松雄斗

// Bug reporting.
//
// Everything up to the moment of sending is automatic: uncaught errors,
// rejected promises and the app's own error banners are captured as they
// happen, together with the version and OS, and assembled into a report. The
// user only decides whether to send it.
//
// Sending is deliberately *not* automatic. A report can quote file paths and
// project text, so it is shown in full first and only leaves the machine when
// the user presses the button — at which point it goes to the public issue
// tracker, where anything included is world-readable.
//
// Two privacy measures follow from that:
//   • paths are redacted (a Windows home directory contains the user's name);
//   • the step-by-step action log is opt-in, per the toggle in Settings.

const ACTION_LOG_KEY = "foling.bugReport.logActions";
/** Kept short: enough to see what led to a failure, not a session recording. */
const MAX_ACTIONS = 40;
const MAX_ERRORS = 10;

export interface LoggedAction {
  at: number;
  what: string;
}

export interface LoggedError {
  at: number;
  message: string;
  stack?: string;
  /** "uncaught" | "promise" | "app" — where it surfaced from. */
  source: string;
}

const actions: LoggedAction[] = [];
const errors: LoggedError[] = [];
let listeners: (() => void)[] = [];

function notify() {
  for (const l of listeners) l();
}

/** Subscribe to error captures (the UI offers to report when one lands). */
export function onErrorCaptured(fn: () => void): () => void {
  listeners.push(fn);
  return () => {
    listeners = listeners.filter((l) => l !== fn);
  };
}

// localStorage is absent outside a browser (tests) and can throw when storage
// is disabled, so the preference falls back to memory rather than taking the
// app down over a toggle.
const memoryPrefs = new Map<string, string>();

function readPref(key: string): string | null {
  try {
    return localStorage.getItem(key);
  } catch {
    return memoryPrefs.get(key) ?? null;
  }
}

function writePref(key: string, value: string): void {
  try {
    localStorage.setItem(key, value);
  } catch {
    memoryPrefs.set(key, value);
  }
}

export function isActionLogEnabled(): boolean {
  // Opt-in: absent means off.
  return readPref(ACTION_LOG_KEY) === "1";
}

export function setActionLogEnabled(on: boolean): void {
  writePref(ACTION_LOG_KEY, on ? "1" : "0");
  if (!on) actions.length = 0; // stop holding what we may no longer send
}

/** Record a user action. No-op unless the user turned the log on. */
export function logAction(what: string): void {
  if (!isActionLogEnabled()) return;
  actions.push({ at: Date.now(), what });
  if (actions.length > MAX_ACTIONS) actions.shift();
}

export function logError(message: string, source: string, stack?: string): void {
  const last = errors[errors.length - 1];
  // Collapse repeats: a render loop can throw the same error hundreds of times.
  if (last && last.message === message && last.source === source) return;
  errors.push({ at: Date.now(), message, stack, source });
  if (errors.length > MAX_ERRORS) errors.shift();
  notify();
}

export function capturedErrors(): LoggedError[] {
  return errors.slice();
}

export function capturedActions(): LoggedAction[] {
  return actions.slice();
}

export function clearCaptured(): void {
  errors.length = 0;
  actions.length = 0;
}

/** Start listening for uncaught errors. Call once, at startup. */
export function installErrorCapture(): void {
  window.addEventListener("error", (e) => {
    // Resource load failures also fire here but carry no Error object.
    const msg = e.error?.message ?? e.message ?? "unknown error";
    logError(String(msg), "uncaught", e.error?.stack);
  });
  window.addEventListener("unhandledrejection", (e) => {
    const r = e.reason;
    const msg = r?.message ?? (typeof r === "string" ? r : JSON.stringify(r));
    logError(String(msg), "promise", r?.stack);
  });
}

// A Windows home directory embeds the account name, and this text is headed for
// a public issue, so home paths are folded away before the report is even shown.
//
// The marker is deliberately loud rather than a bare `~`: the point is for the
// user to be able to *find* the redactions and satisfy themselves that their
// name is gone. `[HOME]` survives Markdown and a URL query intact.
export const HOME_MARK = "[HOME]";

const HOME_PATTERNS = [
  /[A-Za-z]:\\Users\\[^\\/\r\n"']+/g,
  /\/(?:Users|home)\/[^/\r\n"']+/g,
];

export function redact(text: string): string {
  let out = text;
  for (const re of HOME_PATTERNS) out = out.replace(re, HOME_MARK);
  return out;
}

/** How many home paths `redact` would fold away. Reported to the user so an
 *  absence of redactions reads as "none were found", not "it didn't work". */
export function countRedactions(text: string): number {
  let n = 0;
  for (const re of HOME_PATTERNS) n += text.match(re)?.length ?? 0;
  return n;
}

export interface ReportInput {
  appVersion: string;
  /** Whether to attach the action log (also gated by the stored preference). */
  includeActions: boolean;
  /** Free-text description from the user, optional. */
  note?: string;
}

const stamp = (t: number) => new Date(t).toISOString().slice(11, 19);

/** Assemble the report the user will see, and send if they choose to. */
export function buildReport(input: ReportInput): string {
  const lines: string[] = [];

  // `navigator` exists in the app but not in every test/runtime host.
  const nav: Partial<Navigator> =
    typeof navigator === "undefined" ? {} : navigator;

  lines.push("### Environment");
  lines.push("");
  lines.push(`- Foling: ${input.appVersion}`);
  lines.push(`- Platform: ${nav.platform || "unknown"}`);
  lines.push(`- User agent: ${nav.userAgent ?? "unknown"}`);
  lines.push(`- Language: ${nav.language ?? "unknown"}`);
  lines.push(`- Reported: ${new Date().toISOString()}`);
  lines.push("");

  if (input.note && input.note.trim()) {
    lines.push("### What happened");
    lines.push("");
    lines.push(input.note.trim());
    lines.push("");
  }

  const errs = capturedErrors();
  lines.push(`### Errors (${errs.length})`);
  lines.push("");
  if (errs.length === 0) {
    lines.push("_None captured._");
  } else {
    for (const e of errs) {
      lines.push(`- \`${stamp(e.at)}\` [${e.source}] ${e.message}`);
      if (e.stack) {
        lines.push("");
        lines.push("```");
        // A full stack is mostly bundler noise; the top frames carry the signal.
        lines.push(e.stack.split("\n").slice(0, 8).join("\n"));
        lines.push("```");
      }
    }
  }
  lines.push("");

  if (input.includeActions && isActionLogEnabled()) {
    const acts = capturedActions();
    lines.push(`### Steps (${acts.length})`);
    lines.push("");
    if (acts.length === 0) {
      lines.push("_None recorded._");
    } else {
      for (const a of acts) lines.push(`- \`${stamp(a.at)}\` ${a.what}`);
    }
    lines.push("");
  }

  // Stated in the report itself, so the reader knows whether anything was
  // removed and can go looking for the markers.
  const raw = lines.join("\n");
  const removed = countRedactions(raw);
  const privacy =
    removed === 0
      ? "_No file paths were found in this report._"
      : `_${removed} file path(s) had the home directory replaced with \`${HOME_MARK}\`._`;

  return redact(`${raw}### Privacy\n\n${privacy}\n`);
}

/** GitHub's issue form takes the body in the query string; it has a practical
 *  URL ceiling, so an over-long report is trimmed rather than silently lost. */
export function issueUrl(repoUrl: string, title: string, body: string): string {
  const MAX_BODY = 6000;
  const trimmed =
    body.length > MAX_BODY
      ? body.slice(0, MAX_BODY) + "\n\n_(report truncated)_"
      : body;
  const q = new URLSearchParams({ title, body: trimmed, labels: "bug" });
  return `${repoUrl.replace(/\/$/, "")}/issues/new?${q.toString()}`;
}
