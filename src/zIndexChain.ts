// SPDX-License-Identifier: AGPL-3.0-or-later
// Copyright (C) 2026 大松雄斗

// Stacking order, laid out the way the browser decides it.
//
// z-index only ranks siblings inside the same stacking context, so two
// elements are compared level by level from the top — like version numbers,
// where 100 › 10 sits above 100 › 5 but below 200 › 1. This lists, for one
// element, every level that takes part in that comparison: each ancestor (and
// the element itself) that declares a z-index or creates a stacking context,
// with whether the z-index actually applies there.
//
// It replaces a single number summed over the ancestors, which matched
// nothing the browser does — and gave no hint when a z-index was dead because
// the element was not positioned, the most common way z-index "does nothing".

/** Winning declaration of a property at one level (classes, then own CSS). */
export type DeclLookup = (prop: string) => string | undefined;

export interface StackLevelInput {
  /** Tree depth: <body> is 1. */
  depth: number;
  label: string;
  path?: string;
  /** The element the chain is for (always the last level). */
  self?: boolean;
  decl: DeclLookup;
}

/** Why a declared z-index has no effect. */
export type ZProblem = "not-positioned" | "invalid";

export interface StackLevel {
  depth: number;
  label: string;
  path?: string;
  self: boolean;
  /** Declared z-index ("100", "-1", "auto"), or null when none is declared. */
  z: string | null;
  /** The declared z-index takes effect. False only when z is set but dead. */
  effective: boolean;
  problem?: ZProblem;
  /** What makes this level a stacking context ("z-index", "opacity", …), if
   *  anything. A context caps every z-index inside it. */
  context: string | null;
}

const POSITIONED = new Set(["relative", "absolute", "fixed", "sticky"]);
const FLEX_OR_GRID = new Set(["flex", "inline-flex", "grid", "inline-grid"]);

function norm(v: string | undefined): string | undefined {
  if (v == null) return undefined;
  const s = v.replace(/!important/i, "").trim().toLowerCase();
  return s === "" ? undefined : s;
}

/** A stacking context created by something other than z-index. */
function otherContext(decl: DeclLookup): string | null {
  const pos = norm(decl("position"));
  if (pos === "fixed" || pos === "sticky") return `position: ${pos}`;
  const op = norm(decl("opacity"));
  if (op != null) {
    const n = op.endsWith("%") ? parseFloat(op) / 100 : parseFloat(op);
    if (!Number.isNaN(n) && n < 1) return "opacity";
  }
  for (const p of [
    "transform",
    "filter",
    "backdrop-filter",
    "perspective",
    "clip-path",
    "mask",
    "mask-image",
  ]) {
    const v = norm(decl(p));
    if (v != null && v !== "none") return p;
  }
  if (norm(decl("isolation")) === "isolate") return "isolation";
  const blend = norm(decl("mix-blend-mode"));
  if (blend != null && blend !== "normal") return "mix-blend-mode";
  const wc = norm(decl("will-change"));
  if (wc != null && /\b(transform|opacity|filter|perspective|clip-path|mask)\b/.test(wc)) {
    return "will-change";
  }
  const contain = norm(decl("contain"));
  if (contain != null && /\b(layout|paint|strict|content)\b/.test(contain)) return "contain";
  const ct = norm(decl("container-type"));
  if (ct === "size" || ct === "inline-size") return "container-type";
  return null;
}

/**
 * The levels that decide where the last level (the element) stacks, top
 * first. Null when no level declares a z-index at all — then there is nothing
 * to show.
 */
export function stackingChain(levels: StackLevelInput[]): StackLevel[] | null {
  const out: StackLevel[] = [];
  let anyZ = false;
  levels.forEach((lv, i) => {
    const z = norm(lv.decl("z-index")) ?? null;
    const positioned = POSITIONED.has(norm(lv.decl("position")) ?? "static");
    // Flex and grid items honour z-index without being positioned.
    const parentDisplay = i > 0 ? norm(levels[i - 1].decl("display")) : undefined;
    const applies = positioned || (parentDisplay != null && FLEX_OR_GRID.has(parentDisplay));
    const isInt = z != null && /^-?\d+$/.test(z);

    let effective = true;
    let problem: ZProblem | undefined;
    if (z != null) {
      anyZ = true;
      if (z !== "auto" && !isInt) {
        effective = false;
        problem = "invalid";
      } else if (isInt && !applies) {
        effective = false;
        problem = "not-positioned";
      }
    }
    const context = isInt && applies ? "z-index" : otherContext(lv.decl);
    if (z != null || context != null || lv.self) {
      out.push({
        depth: lv.depth,
        label: lv.label,
        path: lv.path,
        self: !!lv.self,
        z,
        effective,
        problem,
        context,
      });
    }
  });
  return anyZ ? out : null;
}

/** Plain-text form of a chain — for search and tooltips, not for layout. */
export function chainText(chain: StackLevel[]): string {
  return chain
    .map((l) => {
      const who = l.self ? "self" : `${l.label}(${l.depth})`;
      const what = l.z ?? (l.context ? `[${l.context}]` : "auto");
      return `${who} ${what}${l.effective ? "" : " ×"}`;
    })
    .join(" › ");
}
