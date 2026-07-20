// SPDX-License-Identifier: AGPL-3.0-or-later
// Copyright (C) 2026 大松雄斗

//! Serde types shared by the editor commands, the builder and the MCP layer.

use serde::{Deserialize, Serialize};
use std::collections::BTreeMap;

#[derive(Serialize, Deserialize, Debug, Clone)]
pub struct TreeNode {
    pub name: String,
    pub display_name: String,
    pub path: String,
    pub order: Option<u32>,
    pub has_config: bool,
    /// Element config inlined so the frontend can read ancestor CSS (for
    /// inheritance display) and detect display/position labels (for tree pills)
    /// without one extra invoke per node.
    pub config: NodeConfig,
    pub children: Vec<TreeNode>,
}

#[derive(Serialize, Deserialize, Debug, Default, Clone)]
pub struct NodeConfig {
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub tag: Option<String>,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub id: Option<String>,
    /// Classes that are currently *applied* (emitted into HTML class="...").
    #[serde(default, skip_serializing_if = "Vec::is_empty")]
    pub classes: Vec<String>,
    /// Classes the user has earmarked for this element so they appear in the
    /// per-element CLASSES section. Superset of `classes`; toggling in the UI
    /// only flips membership in `classes`.
    #[serde(default, skip_serializing_if = "Vec::is_empty")]
    pub available_classes: Vec<String>,
    /// Inherited CSS properties the user has explicitly disabled for this
    /// element. Emitted as `propname: initial;` in inline style at build time.
    #[serde(default, skip_serializing_if = "Vec::is_empty")]
    pub disabled_inherits: Vec<String>,
    #[serde(default, skip_serializing_if = "BTreeMap::is_empty")]
    pub attributes: BTreeMap<String, String>,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub content: Option<String>,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub css: Option<String>,
    /// Per-element JavaScript. Wrapped in an IIFE at build time with `el`
    /// bound to this element via `data-htfl-id`.
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub js: Option<String>,
    #[serde(default, skip_serializing_if = "Vec::is_empty")]
    pub links: Vec<LinkEntry>,
}

#[derive(Serialize, Deserialize, Debug, Clone)]
pub struct LinkEntry {
    pub rel: String,
    pub href: String,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    #[serde(rename = "type")]
    pub link_type: Option<String>,
}

#[derive(Serialize, Deserialize, Debug, Default, Clone)]
pub struct ProjectConfig {
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub doctype: Option<String>,
    #[serde(default)]
    pub variables: BTreeMap<String, String>,
    /// Optional metadata: which DOM element a class file is intended for.
    /// Key = class filename (e.g. "01_foundation.css")
    /// Value = relative path under HTML/ (e.g. "02_body/02_article")
    #[serde(default, skip_serializing_if = "BTreeMap::is_empty")]
    pub class_file_targets: BTreeMap<String, String>,
    /// When `Some(true)` or unset, the build prepends a small CSS reset
    /// to the <style> block (zeros out browser default margin / padding /
    /// list-style / text-decoration / font-size etc.). Set to `Some(false)`
    /// to fall back to the browser's user-agent stylesheet.
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub css_reset: Option<bool>,
    /// Output mode. `"ssr"` emits static HTML only (the per-element SCRIPT/JS
    /// layer is omitted, so the page works with JavaScript disabled).
    /// `"ssr+js"` (default) also emits the JS for client-side interactivity.
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub output_mode: Option<String>,
    /// Project-level <head> settings, edited via FILE → HEAD (not the DOM
    /// tree). Injected into <head> at build time.
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub head: Option<HeadConfig>,
}

/// <head> tags managed at the project level (FILE → HEAD menus).
/// DEFAULT = rarely-changed (charset, viewport). PROJECT TAGS = per-project
/// (title, description, OGP, favicon, theme-color).
#[derive(Serialize, Deserialize, Debug, Default, Clone)]
pub struct HeadConfig {
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub charset: Option<String>,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub viewport: Option<String>,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub title: Option<String>,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub description: Option<String>,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub og_title: Option<String>,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub og_description: Option<String>,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub og_image: Option<String>,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub favicon: Option<String>,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub theme_color: Option<String>,
}
#[derive(Serialize, Deserialize, Debug, Clone)]
pub struct NodeSnapshot {
    pub name: String,
    pub config: NodeConfig,
    pub children: Vec<NodeSnapshot>,
}

#[derive(Serialize, Deserialize, Debug, Clone)]
pub struct ClassFile {
    pub name: String,
    pub content: String,
}

/// A reusable component: a captured subtree (DOM + per-element CSS/JS/classes)
/// plus the class definitions it references, bundled so the module is
/// self-contained and can be expanded into any project.
#[derive(Serialize, Deserialize, Debug, Clone)]
pub struct ModuleDef {
    pub name: String,
    pub snapshot: NodeSnapshot,
    /// Bundled `.class { ... }` definitions used by the subtree (CSS text).
    #[serde(default)]
    pub css: String,
}

/// One module file under `modules/` — a YAML list of [`ModuleDef`].
#[derive(Serialize, Deserialize, Debug, Clone)]
pub struct ModuleFile {
    pub name: String,
    pub modules: Vec<ModuleDef>,
}

#[derive(Serialize, Deserialize, Debug, Clone)]
pub struct ImageFolder {
    /// Sub-folder name under `images/`, e.g. "icons".
    pub name: String,
    /// Image paths relative to `images/`, e.g. ["icons/foo.png", "icons/bar.svg"].
    pub images: Vec<String>,
}

// ---------- Plugins ----------

pub fn default_snippet_kind() -> String {
    "css".to_string()
}

#[derive(Serialize, Deserialize, Debug, Clone)]
pub struct ExporterDef {
    pub id: String,
    pub label: String,
    /// JS file (relative to the plugin dir) exporting a default fn(doc)->string.
    pub script: String,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub extension: Option<String>,
}

#[derive(Serialize, Deserialize, Debug, Clone)]
pub struct ClassDictEntry {
    pub name: String,
    #[serde(default)]
    pub description: String,
}

#[derive(Serialize, Deserialize, Debug, Clone)]
pub struct SnippetEntry {
    pub name: String,
    /// "css" | "content" — where the snippet is meant to be inserted.
    #[serde(default = "default_snippet_kind")]
    pub kind: String,
    pub body: String,
}

/// An AI agent CLI a plugin makes launchable from the PLUGINS menu.
/// `command` is run in the OS terminal with the project folder as cwd
/// (e.g. "claude", "codex", "aider --model …"). The user confirms the exact
/// command in the UI before it is launched.
#[derive(Serialize, Deserialize, Debug, Clone)]
pub struct AgentDef {
    pub id: String,
    pub label: String,
    pub command: String,
}

#[derive(Serialize, Deserialize, Debug, Clone, Default)]
pub struct PluginManifest {
    pub name: String,
    #[serde(default)]
    pub version: String,
    #[serde(default)]
    pub description: String,
    #[serde(default)]
    pub exporters: Vec<ExporterDef>,
    #[serde(default)]
    pub classes: Vec<ClassDictEntry>,
    #[serde(default)]
    pub snippets: Vec<SnippetEntry>,
    #[serde(default)]
    pub agents: Vec<AgentDef>,
}

#[derive(Serialize, Deserialize, Debug, Clone)]
pub struct LoadedPlugin {
    /// Absolute path of the plugin directory.
    pub dir: String,
    /// Plugin folder name.
    pub dir_name: String,
    pub manifest: PluginManifest,
}