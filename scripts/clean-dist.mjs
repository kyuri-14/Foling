// SPDX-License-Identifier: AGPL-3.0-or-later
// Copyright (C) 2026 大松雄斗

// Remove the build output dir before bundling.
//
// Why this exists: on Windows with Node 24.x, the native recursive remove
// (`fs.rmSync(path, { recursive: true })` / `fs.rmdirSync(..., { recursive })`)
// hard-aborts the process with STATUS_STACK_BUFFER_OVERRUN (0xC0000409, shown
// as exit code 127 in Git Bash). Vite's `emptyOutDir` uses exactly that, so the
// SECOND `vite build` (when `dist/` already exists) crashes right after
// "modules transformed" with no error message. Deleting entries manually
// (unlink + non-recursive rmdir) avoids the broken native path entirely, so
// `dist/` is gone before Vite runs and `emptyOutDir` has nothing to remove.
import { existsSync, readdirSync, unlinkSync, rmdirSync } from "node:fs";
import { join } from "node:path";

function rmrf(p) {
  if (!existsSync(p)) return;
  for (const entry of readdirSync(p, { withFileTypes: true })) {
    const child = join(p, entry.name);
    if (entry.isDirectory()) rmrf(child);
    else unlinkSync(child); // files and symlinks
  }
  rmdirSync(p); // non-recursive — the recursive form is the one that crashes
}

// npm runs scripts with cwd set to the package root, so "dist" resolves there.
rmrf("dist");
