// SPDX-License-Identifier: AGPL-3.0-or-later
// Copyright (C) 2026 大松雄斗

// macOS native menu bar.
//
// On macOS the system draws a menu bar at the top of the screen, and every
// native app has one whether or not it wants it — the Edit menu there is what
// makes Cmd+C / Cmd+V work inside a webview. Keeping our own in-window menu bar
// as well left two menus stacked, so on macOS we drop the in-window bar and put
// everything here instead (this is what VS Code does).
//
// Built entirely from the frontend via Tauri's JS menu API, so the same handler
// closures the in-window menu uses drive this one — there is no Rust-side event
// plumbing to keep in sync. Behaviour is read through a ref so a menu built once
// never calls a stale handler; labels and structure are rebuilt by the caller
// when the values they depend on change.

import { MutableRefObject } from "react";
import { Menu } from "@tauri-apps/api/menu";
import { t } from "./i18n";
import type { AgentDef, ExporterDef, LoadedPlugin } from "./types";

export interface NativeMenuActions {
  onNew: () => void;
  onOpen: () => void;
  onSave: () => void;
  onEditHeadDefault: () => void;
  onEditHeadProjectTags: () => void;
  onImportHtml: () => void;
  onExportHtml: () => void;
  onImportModule: () => void;
  onUndo: () => void;
  onRedo: () => void;
  onAddChild: () => void;
  onRename: () => void;
  onDelete: () => void;
  onOpenSearch: () => void;
  onOpenClasses: () => void;
  onEditDoctype: () => void;
  onEditHtmlAttrs: () => void;
  onEditVariables: () => void;
  onToggleCssReset: () => void;
  cssResetOn: boolean;
  onReload: () => void;
  onPickBrowser: () => void;
  onClearBrowser: () => void;
  browserPath: string | null;
  onOpenSettings: () => void;
  onOpenPlugins: () => void;
  onReloadPlugins: () => void;
  plugins: LoadedPlugin[];
  onRunExporter: (p: LoadedPlugin, e: ExporterDef) => void;
  agents: AgentDef[];
  onRunAgent: (a: AgentDef) => void;
  onReloadTree: () => void;
  mcpEnabled: boolean;
  onToggleMcp: () => void;
  onOpenMcp: () => void;
  onOpenShortcuts: () => void;
  onOpenChangelog: () => void;
  onReportBug: () => void;
  onCheckUpdate: () => void;
  onOpenAbout: () => void;
}

// The in-window menu labels carry a "(Ctrl+…)" hint that reads wrong in a macOS
// menu (it's Cmd there, and the accelerators live in the JS keyboard handler,
// not on these items). Strip it so the native menu stays clean.
const clean = (label: string) => label.replace(/\s*\(Ctrl\+[^)]*\)/i, "");

/// Build the macOS menu and install it as the application menu. Reads current
/// behaviour and labels from `ref.current` each time it runs.
export async function installNativeMenu(
  ref: MutableRefObject<NativeMenuActions>
): Promise<void> {
  // Every item dispatches through the ref, so a menu built once still calls the
  // latest handler after React re-renders with new state.
  const run = (pick: (a: NativeMenuActions) => () => void) => () =>
    pick(ref.current)();

  const a = ref.current;

  const exporterItems = a.plugins.flatMap((p) =>
    (p.manifest.exporters ?? []).map((exp) => ({
      text: `▶ ${exp.label}`,
      action: () => ref.current.onRunExporter(p, exp),
    }))
  );

  const agentItems = a.agents.map((ag) => ({
    text: t("Open {label} here...").replace("{label}", ag.label),
    action: () => ref.current.onRunAgent(ag),
  }));

  const menu = await Menu.new({
    items: [
      {
        // macOS replaces this title with the app name and makes it the bold
        // application menu (it must be the first submenu).
        text: "Foling",
        items: [
          { text: t("About Foling..."), action: run((a) => a.onOpenAbout) },
          { item: "Separator" },
          { text: clean(t("Settings...")), action: run((a) => a.onOpenSettings) },
          { item: "Separator" },
          { item: "Services" },
          { item: "Separator" },
          { item: "Hide" },
          { item: "HideOthers" },
          { item: "ShowAll" },
          { item: "Separator" },
          { item: "Quit" },
        ],
      },
      {
        text: t("FILE"),
        items: [
          { text: t("New Project..."), action: run((a) => a.onNew) },
          { text: t("Open Project..."), action: run((a) => a.onOpen) },
          { text: clean(t("Save (Ctrl+S)")), action: run((a) => a.onSave) },
          { item: "Separator" },
          {
            text: t("DEFAULT (charset / viewport / lang)..."),
            action: run((a) => a.onEditHeadDefault),
          },
          {
            text: t("PROJECT TAGS (title / description / OGP / favicon)..."),
            action: run((a) => a.onEditHeadProjectTags),
          },
          { item: "Separator" },
          {
            text: t("Import HTML... (→ HTFL)"),
            action: run((a) => a.onImportHtml),
          },
          {
            text: t("Export HTML... (HTFL →)"),
            action: run((a) => a.onExportHtml),
          },
          { item: "Separator" },
          {
            text: t("Import module file..."),
            action: run((a) => a.onImportModule),
          },
        ],
      },
      {
        text: t("EDIT"),
        items: [
          { text: clean(t("Undo (Ctrl+Z)")), action: run((a) => a.onUndo) },
          { text: clean(t("Redo (Ctrl+Y)")), action: run((a) => a.onRedo) },
          { item: "Separator" },
          // These make Cmd+C / X / V / A work inside the webview.
          { item: "Cut" },
          { item: "Copy" },
          { item: "Paste" },
          { item: "SelectAll" },
          { item: "Separator" },
          { text: t("Add child..."), action: run((a) => a.onAddChild) },
          { text: t("Rename..."), action: run((a) => a.onRename) },
          { text: t("Delete..."), action: run((a) => a.onDelete) },
          { item: "Separator" },
          {
            text: clean(t("Search... (Ctrl+Shift+F)")),
            action: run((a) => a.onOpenSearch),
          },
        ],
      },
      {
        text: t("VIEW"),
        items: [
          {
            text: t("Edit class files..."),
            action: run((a) => a.onOpenClasses),
          },
          { text: t("Edit DOCTYPE..."), action: run((a) => a.onEditDoctype) },
          {
            text: t("Edit <html> attributes..."),
            action: run((a) => a.onEditHtmlAttrs),
          },
          {
            text: t("Edit project variables..."),
            action: run((a) => a.onEditVariables),
          },
          {
            text: `${t("CSS reset")}: ${
              a.cssResetOn ? t("ON ✓") : t("OFF (browser default)")
            }`,
            action: run((a) => a.onToggleCssReset),
          },
        ],
      },
      {
        text: t("WINDOW"),
        items: [
          { text: t("Reload"), action: run((a) => a.onReload) },
          {
            text: `${t("Choose preview browser...")}${a.browserPath ? " ✓" : ""}`,
            action: run((a) => a.onPickBrowser),
          },
          {
            text: t("Reset to default browser"),
            action: run((a) => a.onClearBrowser),
            enabled: !!a.browserPath,
          },
          { item: "Separator" },
          { text: t("Settings..."), action: run((a) => a.onOpenSettings) },
          { item: "Separator" },
          { item: "Minimize" },
          { item: "Fullscreen" },
        ],
      },
      {
        text: t("PLUGINS"),
        items: [
          {
            text: `${t("Manage plugins...")} (${a.plugins.length})`,
            action: run((a) => a.onOpenPlugins),
          },
          { text: t("Reload plugins"), action: run((a) => a.onReloadPlugins) },
          ...exporterItems,
          { item: "Separator" },
          ...agentItems,
          {
            text: t("Reload tree (after external edits)"),
            action: run((a) => a.onReloadTree),
          },
          {
            text: a.mcpEnabled ? t("Stop MCP server") : t("Start MCP server"),
            action: run((a) => a.onToggleMcp),
          },
          {
            text: t("MCP connection info..."),
            action: run((a) => a.onOpenMcp),
          },
        ],
      },
      {
        text: t("HELP"),
        // About Foling lives in the app menu on macOS (the standard place), so
        // it is intentionally absent here — otherwise it shows up twice.
        items: [
          {
            text: t("Keyboard shortcuts..."),
            action: run((a) => a.onOpenShortcuts),
          },
          { text: t("Changelog..."), action: run((a) => a.onOpenChangelog) },
          { text: t("Report a bug..."), action: run((a) => a.onReportBug) },
          {
            text: t("Check for updates..."),
            action: run((a) => a.onCheckUpdate),
          },
        ],
      },
    ],
  });

  await menu.setAsAppMenu();
}
