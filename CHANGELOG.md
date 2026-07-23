# Changelog

All notable changes to Foling are recorded here.
Format follows [Keep a Changelog](https://keepachangelog.com/en/1.1.0/);
versions follow [Semantic Versioning](https://semver.org/).

## [Unreleased]

## [0.12.6] - 2026-07-23

### Changed
- **Find on the CSS tab covers the whole cascade**, not just the element's own
  declarations. Inherited properties, the classes' definitions and the resolved
  BASIN rows are all searched and marked. Searching one element's own block
  found little worth finding — the property you are hunting has usually arrived
  from a class or an ancestor.
- **Redactions in a bug report are visible.** The marker is now a plain
  `[HOME]` rather than a bare `~`, it is tinted in the preview so the spots can
  be found at a glance, and the report states how many paths were removed — so
  "none were found" is distinguishable from "redaction did not run".

## [0.12.5] - 2026-07-23

### Added
- **Bug reporting** (HELP → Report a bug, or the button on any error banner).
  Uncaught errors, rejected promises and the app's own error messages are
  captured as they happen, together with the version and OS, and assembled into
  a report — no copying stack traces by hand.
  - **Recording your steps is opt-in**, and attaching them to a report is a
    second, separate choice. Turning recording off also discards what was held.
  - **File paths are redacted** before the report is shown: a Windows home
    directory carries the account name, and the issue tracker is public.
  - The full report is displayed before anything is sent, and sending opens a
    pre-filled GitHub issue in the browser — nothing leaves the machine on its
    own.

### Fixed
- **The title-bar search works again.** It disabled itself whenever no element
  was selected, which is the state the app starts in — so the shortcut and the
  click both did nothing. With no code editor open it now searches the tree,
  matching tag names and text and tinting the rows that hit.
- **The search box no longer overlaps the HELP menu** on narrow windows. It was
  centred absolutely, over the menus; it now sits between two flexible spacers,
  so it centres in the space that is actually free and shrinks instead of
  colliding.

## [0.12.4] - 2026-07-22

### Changed
- **The title-bar search box is a real input, and marks hits in place.** It used
  to be a button that opened a dialog of results to jump to, which made both the
  behaviour and the reach of the search hard to read. Now what you type is
  highlighted where it sits, in whichever editor is open.
- **Find is scoped to the open editor, and says so.** The placeholder reads
  "Find in CSS" / "Find in SCRIPT" / "Find in CLASSES" depending on the current
  tab, and a match count sits at the right of the box — so the search's reach is
  never a guess. Ctrl/Cmd+F focuses the box; Escape clears it.
- **Project-wide search stays on Ctrl/Cmd+Shift+F**, keeping the results dialog
  for searching across every element. Same split as VS Code: plain F is local,
  Shift+F is project-wide.

## [0.12.3] - 2026-07-22

### Added
- **Search box in the centre of the title bar**, VS Code style. It opens the
  project search (tag / id / class / content / CSS), and fills what was an empty
  strip on macOS with the native menu. Present on every platform.
- **Find shortcut**: `Ctrl+F` (Windows/Linux) or `Cmd+F` (macOS) opens the
  search. `Ctrl+Shift+F` / `Cmd+Shift+F` still work as before. On macOS this is
  Cmd only, never Ctrl — `Ctrl+F` there is the system "move cursor forward"
  binding in text fields, and taking it over would break cursor movement.

### Fixed
- **"About Foling" no longer appears twice on macOS.** It sits in the
  application menu (the standard place) and was also listed under Help; the Help
  copy is removed on macOS.

## [0.12.2] - 2026-07-22

### Changed
- **macOS uses the system menu bar.** Every mac app has a native menu bar
  whether it wants one or not — the Edit menu there is what makes Cmd+C / Cmd+V
  work in a webview — so carrying our own in-window bar as well left two menus
  stacked. On macOS the in-window bar is gone; FILE / EDIT / VIEW / WINDOW /
  PLUGINS / HELP now live in the native bar at the top of the screen (as in
  VS Code). Windows and Linux keep the in-window title bar unchanged.
  - Built from the frontend with Tauri's menu API, driven by the same handlers
    the in-window menu used, so there is no second copy of the menu logic to
    keep in sync. If installing the native menu ever fails, the in-window bar
    comes back as a fallback rather than leaving macOS with no menu.
  - Cut / Copy / Paste / Select All are native menu items, so the standard
    editing shortcuts work in every text field.

### Fixed
- **The macOS logo no longer drifts right in fullscreen.** The title bar
  reserves space for the traffic lights, which hide in fullscreen; that padding
  is now dropped there so the logo sits at the edge.

## [0.12.1] - 2026-07-21

### Fixed
- **Undo no longer leaves a folder on its `__tmp_…` name.** Applying tree edits
  renames in two steps (original → temp → final) so siblings can swap positions
  without colliding, but *both* steps were pushed onto the undo stack. One
  Ctrl+Z therefore landed the folder on the temp name and it took a second to
  get home. The temp step is an implementation detail and no longer records
  anything; the final step points back at the pre-rename path.
- **macOS: letter shortcuts no longer type a character.** `Option+letter` *is* a
  character on macOS (`†`, `ß`, `ç`, …), and the webview inserts it even when
  the handler calls `preventDefault`. Pressing Option+T on a tree row — whose
  text is selected on focus — replaced the tag name with `†`, which sanitises to
  nothing and so landed on disk as `NN_tag`. Letter shortcuts now take
  **⌘+⌥** on macOS (Alt elsewhere); arrow shortcuts keep plain Option, since
  arrows produce no text.
- **The element editor gives focus back to the tree.** Closing it left focus on
  `<body>`, so the Alt+arrow shortcuts — which only act when a tree row is
  focused — silently did nothing until the row was clicked.
- **The logo is visible on macOS.** The title bar hid it there to make room for
  the native traffic lights, but the bar already reserves padding to clear them.

### Added
- **Escape closes the element editor**, so leaving it never depends on a
  modifier combination that the OS may turn into text.

## [0.12.0] - 2026-07-21

### Added
- **Foling is an MCP server** (`docs/MCP.md`). An AI agent can now edit a
  project through Foling's own operations instead of guessing at folder names:
  `NN_` numbering, `config.yaml` shape and build semantics are enforced by the
  app. 17 tools cover reading the tree, editing elements, expanding modules,
  editing project settings and building.
  - Elements are addressed either by **line number** (`L12` — the same number
    the editor shows and the build emits as `id`) or by **path relative to
    `HTML/`** (`02_body/01_header`). Every tool accepts and reports both.
    Absolute paths never cross the boundary, and references cannot escape the
    project.
  - `htfl_build` returns **diagnostics** — unknown tags falling back to
    `<div>`, classes applied but never defined, content on void elements, empty
    `href`/`src` — so an agent can check its own work.
  - Not exposed: arbitrary file writes, terminal launching, browser launching,
    plugin-script reads.
- **Two MCP transports**, sharing one implementation:
  - **Running editor over HTTP** (PLUGINS → AI → *Start MCP server*). Bound to
    `127.0.0.1`, gated by a bearer token minted per launch, and closed to
    browser origins. Agent edits **refresh the open tree automatically**.
    *MCP connection info...* shows a ready-to-paste `.mcp.json`.
  - **`foling-mcp`**, a standalone stdio binary that works with Foling closed
    (`--project <dir>`, `--read-only`). Published as a release asset for all
    three platforms.

### Fixed
- **`<pre>` no longer picks up layout indentation.** The builder indents its
  output for readability, but whitespace inside `<pre>` / `<textarea>` is
  content — every line of a code block was arriving with two spaces per level of
  nesting in front of it. Preformatted elements and their descendants now emit
  verbatim, with no newline after the opening tag and none before the closing
  one. Found by writing the new sample project.

### Changed
- **`sample-project` explains HTFL, in HTFL.** It was a generic page that
  demonstrated nothing in particular. It is now an eight-section document about
  the language, where each section uses the feature it describes: the CSS
  section is styled by its own `css:`, the variables section reads `$colorMain`,
  the JavaScript section has a working button, the `<head>` section points at
  `htfl.yaml`. It also ships a module and three class files, so `modules/` and
  the CLASSES palette are discoverable from a fresh open. Builds with no
  diagnostics.
- **The menu bar is now the title bar.** The OS frame is off, so FILE / EDIT /
  VIEW … sit on the same row as the logo and the window buttons, giving back a
  row of vertical space. Windows and Linux get buttons drawn by the app; macOS
  keeps its native traffic lights (`titleBarStyle: "Overlay"`) with the menus
  inset to clear them.
- **Chrome is neutral, colour is information.** The menu bar is dark grey
  instead of orange — it was the most saturated thing on screen and carried no
  information. Editor tabs identify their layer with a 2px underline instead of
  a filled block.
- **DEV and RUN are buttons now**, rounded and sized to their labels rather than
  full-height blocks that read as two more tabs.
  - **DEV** is outlined when off and filled blue when on. Both states used to be
    filled (dark blue vs bright blue), which left the current state ambiguous.
  - **RUN** is green. Orange read as a warning for an action that is safe and
    repeatable, and green is what a run/play control is everywhere else. The
    generic primary-button colour split off into `--c-primary` and is unchanged.
- **The breadcrumb colours the selected element, not the bar.** It was a
  full-width saturated cyan fill, making the container louder than the one word
  in it that mattered. Ancestors are now grey on a neutral strip and the
  selected element carries the blue that already means "selected" in the tree.
- **New app icon**, generated from `src-tauri/icons/source/*.svg` (kept in the
  repo so the icon set can be rebuilt — see the README there).
- **Icon changes now trigger a rebuild.** `tauri-build` embeds the icon but does
  not register it with cargo, so replacing a logo left the *old* icon in the
  binary until an unrelated source change forced a rebuild. `build.rs` now emits
  `cargo:rerun-if-changed=icons`.
- **The macOS icon is no longer oversized.** macOS has drawn app icons inside an
  824/1024 (80.5%) body since Big Sur, leaving a margin for the Dock's shadow;
  `tauri icon` does not add that margin, so a full-bleed source rendered about
  24% larger than every neighbouring app. `icon.icns` is now built from a
  separate inset source. Windows and Linux stay full-bleed, which is correct
  for them.
- **`src-tauri/src/lib.rs` split into `htfl/`** (`types`, `lock`, `tree`,
  `node`, `project`, `build`, `import`, `plugin`) with the `#[tauri::command]`
  layer reduced to thin delegations. The editor and the MCP server now call the
  same functions, which is what keeps them from drifting apart. No behaviour
  change.
- **`NN_` folder numbering moved into Rust** (`htfl::tree`). It previously
  existed only in the frontend's `rowsToParsedTree`, which was fine while the
  editor was the sole writer. Insert-in-the-middle still renumbers only the
  *following* siblings, and deletes still leave gaps — every avoided rename is
  one less chance for Windows to answer with ERROR_ACCESS_DENIED.
- **Filesystem locking is now cross-process.** The in-process mutex is joined
  by an advisory `.foling/lock` directory, so a running editor and a
  `foling-mcp` process cannot interleave writes to the same project. It is
  best-effort by design: a lock that cannot be taken is skipped rather than
  allowed to wedge the editor, and a lock outliving its holder is stolen after
  30 seconds.

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
