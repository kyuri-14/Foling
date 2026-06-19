# Changelog

All notable changes to Foling are recorded here.
Format follows [Keep a Changelog](https://keepachangelog.com/en/1.1.0/);
versions follow [Semantic Versioning](https://semver.org/).

## [Unreleased]

### Added
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
- Menu bar now follows the common desktop pattern: once a top-level menu is
  open, hovering another top item (e.g. VIEW → WINDOW) switches to it.
- Element-editor toggle moved from Ctrl+T to **Alt+T** (consistent with the
  Alt shortcuts and web-safe). Row reorder is now **Alt+Shift+↑/↓**; indent /
  outdent is **Alt+←/→**.

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
