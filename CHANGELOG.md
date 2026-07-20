# Changelog

All notable changes to Foling are recorded here.
Format follows [Keep a Changelog](https://keepachangelog.com/en/1.1.0/);
versions follow [Semantic Versioning](https://semver.org/).

## [Unreleased]

## [0.11.0] - 2026-07-08

### Added
- **AI agent integration** (PLUGINS menu → AI). Launch **Claude Code** or
  **Codex CLI** (built-in), or any agent a plugin registers via `agents:` in
  `plugin.yaml`, in the OS terminal with the project folder as cwd — HTFL is
  plain folders + YAML, so file-editing agents work on the project directly.
  The exact command is confirmed before launching; **PLUGINS → Reload tree**
  picks up the agent's edits afterwards.
- **Auto-update** via the Tauri updater plugin (**HELP → Check for updates...**).
  Releases publish signed updater artifacts + `latest.json` to GitHub Releases;
  the app verifies the signature against its embedded public key before
  installing and restarting. (Update-signing is separate from OS code signing,
  which is still pending a certificate.)
- **`CODE_OF_CONDUCT.md`** (Contributor Covenant 2.1) and **`SECURITY.md`**
  (vulnerability-reporting policy + the app's known security characteristics).
- **`THIRD-PARTY-NOTICES.md`** — attribution for all bundled dependencies
  (487 Rust crates in the binary closure + the npm runtime packages), with each
  distinct license's full text in an appendix. All are AGPL-compatible
  (permissive, plus MPL-2.0 from `scraper`; `r-efi`'s LGPL option is unused).
- **SPDX license headers** (`SPDX-License-Identifier: AGPL-3.0-or-later`) on all
  first-party source files.
- **Modules** — reusable components (a captured subtree: DOM + per-element
  CSS / SCRIPT, plus the class definitions it uses, bundled so it stays
  self-contained). Right-click a tree element → **Register as module...** to
  save it (file defaults to the project name; module name entered on save).
  In the tree, type **`.name`** in a row to expand a module in place — its
  missing class definitions are added to `99_modules.css` automatically.
  Import a module file from another project via **FILE → Import module
  file...**. Stored as YAML under `modules/`. Ships with a sample bundle
  `examples/modules/samples.yaml` containing **drawermenu**, **slider** and
  **modal** (each self-contained with its own CSS + SCRIPT; import and type
  `.name`).
- **Ctrl+/** in the CSS / CLASSES / SCRIPT editors toggles comments on the
  selected line(s) — `/* … */` for CSS, `//` for SCRIPT.
- **Syntax highlighting** in the CSS / SCRIPT / CLASS editors (lightweight
  transparent-textarea overlay; tokens colored via CSS variables).
- **Settings → Editor theme** (Dark / Light / Monokai) controlling the code
  editor background, gutter and syntax colors.
- Editor shortcuts for the selected element (web-safe — no Ctrl/Cmd, no
  Alt+digit): **Alt+S** edit CSS, **Alt+C** go to CLASSES, **Alt+J** edit
  SCRIPT (switches the tab and focuses the editor).
- Inline tree-row hints next to each tag: key CSS badges (flex / grid /
  absolute / hidden / …), an image marker (🖼 filename), and a greyed content
  preview. The ✎ button's tooltip now shows the element's text.
- **Alt+↑ / Alt+↓** move the selection up / down a row.
- **Alt+R** runs the preview (RUN); **Alt+Shift+R** runs the DEV preview.
- **Alt+←** selects the parent element — or, from the CSS / SCRIPT editor,
  jumps back to that element's tree row. **Alt+→** selects the next sibling
  (wraps around).

### Changed
- **Relicensed from GPL-3.0-or-later to AGPL-3.0-or-later.** AGPL adds the
  network-use clause (§13) so a future hosted/web version can't ship modified
  Foling without offering its source. Updated `LICENSE`, `package.json`,
  `Cargo.toml`, README, CONTRIBUTING and the in-app About dialog.
- **App icon** generated from the project logo (`src-tauri/app-icon.svg` →
  `src-tauri/icons/`), replacing the default Tauri logo.
- Unified all internal names to **Foling / foling** (dropping the "-editor"
  suffix): npm package `foling`, Cargo package `foling` + lib `foling_lib`,
  bundle identifier `com.foling`, window/document titles and docs. (The
  on-disk project folder is renamed separately.)
- Code-editor comments are now a muted slate-grey (was green), so commented-out
  CSS / JS reads clearly as "disabled" across all three editor themes.
- Menu bar now follows the common desktop pattern: once a top-level menu is
  open, hovering another top item (e.g. VIEW → WINDOW) switches to it.
- Element-editor toggle moved from Ctrl+T to **Alt+T** (consistent with the
  Alt shortcuts and web-safe). Row reorder is now **Alt+Shift+↑/↓**; indent /
  outdent is **Alt+←/→**.

### Fixed
- **macOS keyboard support.** Alt+letter shortcuts (Alt+T/S/C/J/R,
  Alt+Shift+R) now match the physical key (`e.code`), so they work with the
  **Option** key on macOS — Option+letter types a transformed character
  ("†", "ß", …) into `e.key`, which the old comparison never matched.
  Added **Cmd+Backspace** as the macOS way to delete the selected element
  (Mac laptops have no forward-Delete key), and a platform note in the
  keyboard-shortcuts dialog. Ctrl-based shortcuts already accepted Cmd.
- **Production build** (`npm run build` / `tauri build`) failing on a rebuild.
  A bug in Node 24.x on Windows makes the native recursive remove
  (`fs.rm`/`fs.rmdir` with `recursive: true`) hard-abort the process
  (STATUS_STACK_BUFFER_OVERRUN); Vite's `emptyOutDir` uses it, so the second
  build into an existing `dist/` crashed right after "modules transformed"
  with no error. Added `scripts/clean-dist.mjs` (a manual, non-recursive
  delete) run before `tsc && vite build`, so `dist/` is cleared without
  hitting the broken native path.
- CSS declarations sharing one physical line (e.g.
  `width: 100%; max-width: 960px;`) are now parsed as separate properties.
  The BASIN cascade, inheritance and z-index resolution split on `;` rather
  than on newlines, so each property shows on its own row. The splitter
  respects parens, quotes and comments (so `;` inside `url(data:…;base64,…)`,
  `,` inside `rgba()`, and `//` inside `url(http://…)` are left intact).

## [0.10.0] - 2026-06

### Added
- **English UI by default**, with a switchable **Japanese language pack**
  (Settings → Language). i18n via `src/i18n.ts` + `src/locales/ja.ts`.
- **FILE → HEAD** menus: **DEFAULT** (charset / viewport / lang) and
  **PROJECT TAGS** (title / description / OGP / favicon / theme-color),
  stored in `htfl.yaml` and injected into `<head>` at build time.
- Per-row **✎ element editor** (text content; image picker for `<img>`;
  attributes), pinned to the right of each tree row.
- **Ctrl+T** toggles the element editor (text input is focused on open;
  press again to finish). **Shift+Delete** deletes the selected element
  and its subtree.
- **Output mode** setting: `SSR` (static, works with JS disabled) vs
  `SSR + JS` (emits the interactive SCRIPT layer).
- In-app **Changelog** viewer and **About** dialog showing the version.
- Settings modal (CSS reset, preview browser, plugin-consent reset,
  language, output mode); project-wide Search (Ctrl+Shift+F); Redo
  (Ctrl+Y / Ctrl+Shift+Z); save-on-exit; window-state persistence;
  top-level error boundary; plugin-execution consent dialog.
- Docs: HTFL spec (`docs/HTFL-SPEC.md`), plugin guide (`docs/PLUGINS.md`),
  CONTRIBUTING, RELEASE_TODO, LICENSE (GPL-3.0), `.gitattributes`.

### Changed
- Renamed the product **"Foling Editor" → "Foling"**.
- Element `id` is now the line number, auto-assigned by the build over the
  `<body>` subtree (body = 1), matching the editor's line gutter.
- DOM tree shows `<body>` only (head moved to the FILE → HEAD menus); the
  `<body>` label and `+` button were removed; chevrons indent by depth.
- "JS" tab renamed **SCRIPT**; removed the CONTENT / INFO / IMAGES tabs.
- Folder naming unified to per-sibling ordinals (`NN_tag`) to avoid
  unnecessary renames; ASCII bundle identifier; production CSP.

### Fixed
- Access-denied (OS error 5) and rename cascades when creating new tags.
- New/pasted elements not selectable; stale element appearing on paste.
- Autosave path race (writing one element's config into another's folder).
- Tree copy/paste vs. text-copy conflict; empty-row Backspace behavior.
- Hardened reachable Rust `unwrap()`s.

## [0.1.0] - 2026

- Initial version: HTFL tree editing, CSS/CONTENT editing, HTML
  import/export, dev mode (click → edit), plugin system, CSS reset.
