// SPDX-License-Identifier: AGPL-3.0-or-later
// Copyright (C) 2026 大松雄斗

//! HTFL core — every filesystem and rendering operation the editor performs,
//! independent of Tauri. The `#[tauri::command]` layer in lib.rs and the MCP
//! server in mcp/ are both thin callers of this module.
//!
//! Named `htfl` rather than `core` because `core` is a built-in crate name.

pub mod build;
pub mod import;
pub mod lock;
pub mod node;
pub mod plugin;
pub mod project;
pub mod tree;
pub mod types;

pub use build::*;
pub use import::*;
pub use lock::*;
pub use node::*;
pub use plugin::*;
pub use project::*;
pub use tree::*;
pub use types::*;

pub const CONFIG_FILE: &str = "config.yaml";
pub const PROJECT_FILE: &str = "htfl.yaml";
pub const HTML_ROOT: &str = "HTML";
pub const CLASSES_DIR: &str = "classes";
pub const MODULES_DIR: &str = "modules";
pub const IMAGES_DIR: &str = "images";
pub const PLUGINS_DIR: &str = "plugins";
pub const DEFAULT_DOCTYPE: &str = "<!DOCTYPE html>";

pub const VOID_TAGS: &[&str] = &[
    "area", "base", "br", "col", "embed", "hr", "img", "input", "link", "meta", "source", "track",
    "wbr",
];

// Standard HTML tag names. A folder whose tag isn't here (and isn't a valid
// hyphenated custom element) is treated as a typo and rendered as <div>.
pub const KNOWN_HTML_TAGS: &[&str] = &[
    "a", "abbr", "address", "area", "article", "aside", "audio", "b", "base",
    "blockquote", "body", "br", "button", "canvas", "caption", "cite", "code",
    "col", "colgroup", "data", "datalist", "dd", "del", "details", "dfn",
    "dialog", "div", "dl", "dt", "em", "embed", "fieldset", "figcaption",
    "figure", "footer", "form", "h1", "h2", "h3", "h4", "h5", "h6", "head",
    "header", "hgroup", "hr", "html", "i", "iframe", "img", "input", "ins",
    "kbd", "label", "legend", "li", "link", "main", "map", "mark", "menu",
    "meta", "meter", "nav", "noscript", "object", "ol", "optgroup", "option",
    "output", "p", "picture", "pre", "progress", "q", "ruby", "s", "samp",
    "script", "section", "select", "slot", "small", "source", "span", "strong",
    "style", "sub", "summary", "sup", "svg", "table", "tbody", "td", "template",
    "textarea", "tfoot", "th", "thead", "time", "title", "tr", "track", "u",
    "ul", "var", "video", "wbr",
];
