// SPDX-License-Identifier: AGPL-3.0-or-later
// Copyright (C) 2026 大松雄斗

use serde::{Deserialize, Serialize};
use std::collections::BTreeMap;
use std::fs;
use std::path::{Path, PathBuf};
use std::sync::atomic::{AtomicU64, Ordering};
use std::sync::{Arc, Mutex, OnceLock};

// Global filesystem lock. Serializes tree mutations (create/rename/delete) and
// full-tree reads (build_tree via build_html / read_tree) so a debounced
// rebuild never enumerates a directory while another op renames it — on
// Windows that races into ERROR_ACCESS_DENIED (os error 5).
fn fs_lock() -> &'static Mutex<()> {
    static LOCK: OnceLock<Mutex<()>> = OnceLock::new();
    LOCK.get_or_init(|| Mutex::new(()))
}

// Acquire the FS lock, recovering from poisoning (a prior panic shouldn't
// brick every later file op).
macro_rules! fs_guard {
    () => {
        let _fs_guard = fs_lock().lock().unwrap_or_else(|p| p.into_inner());
    };
}

// Retry a filesystem op on transient Windows locks (error 5 = access denied,
// 32 = sharing violation) caused by AV / Search indexer / Explorer briefly
// holding a handle. 12 attempts with linear backoff totals ~2s before giving up.
fn retry_io<T>(mut f: impl FnMut() -> std::io::Result<T>) -> std::io::Result<T> {
    let mut attempt = 0u32;
    loop {
        match f() {
            Ok(v) => return Ok(v),
            Err(e) => {
                let code = e.raw_os_error().unwrap_or(0);
                if (code == 5 || code == 32) && attempt < 12 {
                    std::thread::sleep(std::time::Duration::from_millis(
                        25 * u64::from(attempt + 1),
                    ));
                    attempt += 1;
                    continue;
                }
                return Err(e);
            }
        }
    }
}

const CONFIG_FILE: &str = "config.yaml";
const PROJECT_FILE: &str = "htfl.yaml";
const HTML_ROOT: &str = "HTML";
const CLASSES_DIR: &str = "classes";
const MODULES_DIR: &str = "modules";
const IMAGES_DIR: &str = "images";
const PLUGINS_DIR: &str = "plugins";
const DEFAULT_DOCTYPE: &str = "<!DOCTYPE html>";

const VOID_TAGS: &[&str] = &[
    "area", "base", "br", "col", "embed", "hr", "img", "input", "link", "meta", "source", "track",
    "wbr",
];

// Standard HTML tag names. A folder whose tag isn't here (and isn't a valid
// hyphenated custom element) is treated as a typo and rendered as <div>.
const KNOWN_HTML_TAGS: &[&str] = &[
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

// Resolve a desired tag name to the tag actually emitted. Unknown names fall
// back to <div> (custom elements — names containing `-` — are allowed as-is).
fn resolve_tag(name: &str) -> String {
    let t = name.to_ascii_lowercase();
    if t.is_empty() {
        return "div".to_string();
    }
    if t.contains('-') || KNOWN_HTML_TAGS.contains(&t.as_str()) {
        t
    } else {
        "div".to_string()
    }
}

// Default CSS reset prepended to the <style> block at build time. Zeros out
// browser-default margin / padding, drops list bullets, removes anchor
// underline, normalizes heading font-size so that the page starts from a
// blank slate. Disabled per-project via `ProjectConfig.css_reset = false`.
const HTFL_RESET_CSS: &str = r#"/* HTFL default reset (toggle via VIEW > CSS リセット) */
*, *::before, *::after { box-sizing: border-box; margin: 0; padding: 0; }
html, body { height: 100%; }
ul, ol { list-style: none; }
a { text-decoration: none; color: inherit; }
h1, h2, h3, h4, h5, h6 { font-size: inherit; font-weight: inherit; }
button, input, textarea, select {
  font: inherit; color: inherit; background: transparent;
  border: none; padding: 0;
}
img, picture, svg, video { display: block; max-width: 100%; }
table { border-collapse: collapse; border-spacing: 0; }
"#;

// Injected only for dev-mode builds. Highlights the hovered element and, on
// click, POSTs its `data-htfl-path` to /__select so the editor can jump to it.
const DEV_SELECT_SCRIPT: &str = r#"  <script data-htfl-dev>
(function(){
  var hovered = null;
  function tagged(t){ return t && t.closest ? t.closest('[data-htfl-path]') : null; }
  document.addEventListener('mouseover', function(e){
    var el = tagged(e.target);
    if (hovered && hovered !== el) hovered.style.removeProperty('outline');
    if (el) {
      el.style.setProperty('outline', '2px solid #4ad9ee', 'important');
      el.style.setProperty('outline-offset', '-2px', 'important');
      hovered = el;
    }
  }, true);
  document.addEventListener('mouseout', function(e){
    var el = tagged(e.target);
    if (el) el.style.removeProperty('outline');
  }, true);
  document.addEventListener('click', function(e){
    var el = tagged(e.target);
    if (!el) return;
    e.preventDefault(); e.stopPropagation();
    var p = el.getAttribute('data-htfl-path');
    try { fetch('/__select', { method: 'POST', body: p, cache: 'no-store' }); } catch(_){}
  }, true);
  var badge = document.createElement('div');
  badge.textContent = 'DEV: 要素クリックでエディタへ';
  badge.style.cssText = 'position:fixed;bottom:8px;right:8px;background:#1f3a5f;color:#fff;font:12px sans-serif;padding:4px 10px;border-radius:4px;z-index:2147483647;opacity:.85;pointer-events:none';
  function attach(){ if (document.body) document.body.appendChild(badge); }
  if (document.readyState !== 'loading') attach();
  else document.addEventListener('DOMContentLoaded', attach);
})();
  </script>
"#;

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

// Render the project-level head config into HTML <head> child tags.
fn render_head_tags(head: &HeadConfig, indent: &str) -> String {
    let mut s = String::new();
    let meta_name = |s: &mut String, name: &str, val: &Option<String>| {
        if let Some(v) = val {
            if !v.is_empty() {
                s.push_str(indent);
                s.push_str(&format!(
                    "<meta name=\"{}\" content=\"{}\" />\n",
                    name,
                    escape_attr(v)
                ));
            }
        }
    };
    let meta_prop = |s: &mut String, prop: &str, val: &Option<String>| {
        if let Some(v) = val {
            if !v.is_empty() {
                s.push_str(indent);
                s.push_str(&format!(
                    "<meta property=\"{}\" content=\"{}\" />\n",
                    prop,
                    escape_attr(v)
                ));
            }
        }
    };
    if let Some(cs) = &head.charset {
        if !cs.is_empty() {
            s.push_str(indent);
            s.push_str(&format!("<meta charset=\"{}\" />\n", escape_attr(cs)));
        }
    }
    meta_name(&mut s, "viewport", &head.viewport);
    if let Some(t) = &head.title {
        if !t.is_empty() {
            s.push_str(indent);
            s.push_str(&format!("<title>{}</title>\n", escape_html(t)));
        }
    }
    meta_name(&mut s, "description", &head.description);
    meta_name(&mut s, "theme-color", &head.theme_color);
    meta_prop(&mut s, "og:title", &head.og_title);
    meta_prop(&mut s, "og:description", &head.og_description);
    meta_prop(&mut s, "og:image", &head.og_image);
    if let Some(fav) = &head.favicon {
        if !fav.is_empty() {
            s.push_str(indent);
            s.push_str(&format!(
                "<link rel=\"icon\" href=\"{}\" />\n",
                escape_attr(fav)
            ));
        }
    }
    s
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

fn default_snippet_kind() -> String {
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
}

#[derive(Serialize, Deserialize, Debug, Clone)]
pub struct LoadedPlugin {
    /// Absolute path of the plugin directory.
    pub dir: String,
    /// Plugin folder name.
    pub dir_name: String,
    pub manifest: PluginManifest,
}

fn split_prefix(name: &str) -> (Option<u32>, &str) {
    if let Some((prefix, rest)) = name.split_once('_') {
        if let Ok(n) = prefix.parse::<u32>() {
            return (Some(n), rest);
        }
    }
    (None, name)
}

fn build_tree(path: &Path) -> std::io::Result<TreeNode> {
    let name = path
        .file_name()
        .map(|n| n.to_string_lossy().into_owned())
        .unwrap_or_default();
    let (order, display) = split_prefix(&name);
    let display_name = display.to_string();

    let mut entries: Vec<(Option<u32>, String, PathBuf)> = Vec::new();
    if path.is_dir() {
        for entry in fs::read_dir(path)? {
            let entry = entry?;
            let p = entry.path();
            if p.is_dir() {
                let cn = entry.file_name().to_string_lossy().into_owned();
                let (o, _) = split_prefix(&cn);
                entries.push((o, cn, p));
            }
        }
    }
    entries.sort_by(|a, b| match (a.0, b.0) {
        (Some(x), Some(y)) => x.cmp(&y).then_with(|| a.1.cmp(&b.1)),
        (Some(_), None) => std::cmp::Ordering::Less,
        (None, Some(_)) => std::cmp::Ordering::Greater,
        (None, None) => a.1.cmp(&b.1),
    });

    let mut children = Vec::with_capacity(entries.len());
    for (_, _, child_path) in entries {
        children.push(build_tree(&child_path)?);
    }

    let has_config = path.join(CONFIG_FILE).exists();
    let config = read_node_config(path).unwrap_or_default();

    Ok(TreeNode {
        name,
        display_name,
        path: path.to_string_lossy().into_owned(),
        order,
        has_config,
        config,
        children,
    })
}

fn read_node_config(node_path: &Path) -> Result<NodeConfig, String> {
    let p = node_path.join(CONFIG_FILE);
    if !p.exists() {
        return Ok(NodeConfig::default());
    }
    let s = fs::read_to_string(&p).map_err(|e| e.to_string())?;
    if s.trim().is_empty() {
        return Ok(NodeConfig::default());
    }
    serde_yml::from_str(&s).map_err(|e| e.to_string())
}

fn write_yaml<T: Serialize>(path: &Path, value: &T) -> Result<(), String> {
    let s = serde_yml::to_string(value).map_err(|e| e.to_string())?;
    fs::write(path, s).map_err(|e| e.to_string())
}

fn substitute_vars(text: &str, vars: &BTreeMap<String, String>) -> String {
    let mut out = String::with_capacity(text.len());
    let mut chars = text.chars().peekable();
    while let Some(c) = chars.next() {
        if c == '$' {
            let mut name = String::new();
            while let Some(&nc) = chars.peek() {
                if nc.is_ascii_alphanumeric() || nc == '_' || nc == '-' {
                    name.push(nc);
                    chars.next();
                } else {
                    break;
                }
            }
            if !name.is_empty() {
                if let Some(v) = vars.get(&name) {
                    out.push_str(v);
                    continue;
                }
                out.push('$');
                out.push_str(&name);
                continue;
            }
            out.push('$');
        } else {
            out.push(c);
        }
    }
    out
}

fn escape_html(s: &str) -> String {
    s.replace('&', "&amp;")
        .replace('<', "&lt;")
        .replace('>', "&gt;")
}

fn escape_attr(s: &str) -> String {
    s.replace('&', "&amp;")
        .replace('"', "&quot;")
        .replace('<', "&lt;")
}

#[allow(clippy::too_many_arguments)]
fn render_node(
    node: &TreeNode,
    vars: &BTreeMap<String, String>,
    depth: usize,
    out: &mut String,
    extra_head_styles: Option<&str>,
    // Pre-rendered project-level <head> tags (charset/title/meta/...), emitted
    // at the top of <head>.
    extra_head_tags: Option<&str>,
    scripts: &mut Vec<(String, String)>,
    js_counter: &mut u32,
    dev: bool,
    // Sequential id counter over the <body> subtree. Once numbering is active,
    // every element gets id="N" matching its line number in the editor tree.
    id_counter: &mut u32,
    number_ids: bool,
    // When false (SSR / static output), the per-element SCRIPT (js) layer is
    // not emitted, so the page works with JavaScript disabled.
    emit_scripts: bool,
) -> Result<(), String> {
    let cfg = read_node_config(Path::new(&node.path))?;
    let raw_tag = cfg
        .tag
        .clone()
        .unwrap_or_else(|| node.display_name.clone());
    // Unknown tag names fall back to <div> (matches the editor's warning).
    let tag = resolve_tag(&raw_tag);
    let pad = "  ".repeat(depth);
    // Numbering activates at <body> and stays on for its whole subtree, so the
    // emitted id matches the line number shown in the editor (body = line 1).
    let numbering = number_ids || tag == "body";

    out.push_str(&pad);
    out.push('<');
    out.push_str(&tag);

    // Dev mode: tag every element with its on-disk path so a click in the
    // preview can navigate the editor straight to it.
    if dev {
        out.push_str(&format!(
            " data-htfl-path=\"{}\"",
            escape_attr(&node.path)
        ));
    }

    // id = the element's line number within <body> (auto, overrides any
    // stored id). Elements outside <body> keep their explicit id if set.
    if numbering {
        *id_counter += 1;
        out.push_str(&format!(" id=\"{}\"", id_counter));
    } else if let Some(id) = &cfg.id {
        out.push_str(&format!(" id=\"{}\"", escape_attr(id)));
    }
    if !cfg.classes.is_empty() {
        out.push_str(&format!(
            " class=\"{}\"",
            escape_attr(&cfg.classes.join(" "))
        ));
    }
    for (k, v) in &cfg.attributes {
        let v = substitute_vars(v, vars);
        out.push_str(&format!(" {}=\"{}\"", k, escape_attr(&v)));
    }
    // Build inline style from `css` plus any explicitly-disabled inherited
    // properties (emitted as `propname: initial;` to negate inheritance).
    {
        let mut decls: Vec<String> = Vec::new();
        if let Some(css) = &cfg.css {
            let css = substitute_vars(css, vars);
            for line in css.lines() {
                let l = line.trim();
                if !l.is_empty() {
                    decls.push(l.to_string());
                }
            }
        }
        for prop in &cfg.disabled_inherits {
            let p = prop.trim();
            if !p.is_empty() {
                decls.push(format!("{}: initial;", p));
            }
        }
        if !decls.is_empty() {
            out.push_str(&format!(" style=\"{}\"", escape_attr(&decls.join(" "))));
        }
    }

    // If this element has JS (and we're emitting scripts), mint a stable id
    // and queue the script. In SSR/static mode this is skipped entirely.
    let js_trim = cfg.js.as_deref().map(str::trim).unwrap_or("");
    if emit_scripts && !js_trim.is_empty() {
        *js_counter += 1;
        let id = format!("h{}", js_counter);
        out.push_str(&format!(" data-htfl-id=\"{}\"", id));
        scripts.push((id, cfg.js.clone().unwrap_or_default()));
    }

    let is_void = VOID_TAGS.contains(&tag.as_str());
    if is_void {
        out.push_str(" />\n");
        return Ok(());
    }

    out.push('>');

    let has_children = !node.children.is_empty();
    let content_text = cfg.content.as_deref().unwrap_or("");
    let has_content = !content_text.is_empty();
    let inject_styles =
        tag == "head" && extra_head_styles.map(|s| !s.trim().is_empty()).unwrap_or(false);
    let inject_head_tags =
        tag == "head" && extra_head_tags.map(|s| !s.trim().is_empty()).unwrap_or(false);
    let has_head_links = tag == "head" && !cfg.links.is_empty();
    let inject_scripts_here = tag == "body";

    if has_content
        || has_children
        || inject_styles
        || inject_head_tags
        || has_head_links
        || inject_scripts_here
    {
        out.push('\n');

        // Project-level head tags first (charset should come early).
        if let Some(tags) = extra_head_tags.filter(|s| !s.trim().is_empty()) {
            for line in tags.lines() {
                if line.trim().is_empty() {
                    continue;
                }
                out.push_str(line);
                out.push('\n');
            }
        }

        if has_head_links {
            for link in &cfg.links {
                out.push_str(&"  ".repeat(depth + 1));
                out.push_str(&format!(
                    "<link rel=\"{}\" href=\"{}\"",
                    escape_attr(&link.rel),
                    escape_attr(&link.href)
                ));
                if let Some(t) = &link.link_type {
                    out.push_str(&format!(" type=\"{}\"", escape_attr(t)));
                }
                out.push_str(" />\n");
            }
        }

        // `inject_styles` already implies Some(non-empty); use `if let` so a
        // future change to that invariant can never turn into a panic here.
        if let Some(styles) = extra_head_styles.filter(|s| !s.trim().is_empty()) {
            out.push_str(&"  ".repeat(depth + 1));
            out.push_str("<style>\n");
            for line in styles.lines() {
                out.push_str(&"  ".repeat(depth + 2));
                out.push_str(line);
                out.push('\n');
            }
            out.push_str(&"  ".repeat(depth + 1));
            out.push_str("</style>\n");
        }

        if has_content {
            for line in content_text.lines() {
                out.push_str(&"  ".repeat(depth + 1));
                out.push_str(&escape_html(line));
                out.push('\n');
            }
        }
        for child in &node.children {
            render_node(
                child, vars, depth + 1, out, None, None, scripts, js_counter,
                dev, id_counter, numbering, emit_scripts,
            )?;
        }

        // Emit <script> just before </body> with all queued per-element JS
        if inject_scripts_here && !scripts.is_empty() {
            let ipad = "  ".repeat(depth + 1);
            let inner = "  ".repeat(depth + 2);
            let deeper = "  ".repeat(depth + 3);
            out.push_str(&ipad);
            out.push_str("<script>\n");
            for (id, js) in scripts.iter() {
                out.push_str(&inner);
                out.push_str("(function() {\n");
                out.push_str(&deeper);
                out.push_str(&format!(
                    "var el = document.querySelector('[data-htfl-id=\"{}\"]');\n",
                    id
                ));
                out.push_str(&deeper);
                out.push_str("if (!el) return;\n");
                for line in js.lines() {
                    out.push_str(&deeper);
                    out.push_str(line);
                    out.push('\n');
                }
                out.push_str(&inner);
                out.push_str("})();\n");
            }
            out.push_str(&ipad);
            out.push_str("</script>\n");
        }

        out.push_str(&pad);
        out.push_str(&format!("</{}>\n", tag));
    } else {
        out.push_str(&format!("</{}>\n", tag));
    }
    Ok(())
}

fn read_classes_css(
    classes_dir: &Path,
    vars: &BTreeMap<String, String>,
) -> Result<String, String> {
    if !classes_dir.is_dir() {
        return Ok(String::new());
    }
    let mut entries: Vec<_> = fs::read_dir(classes_dir)
        .map_err(|e| e.to_string())?
        .filter_map(|e| e.ok())
        .filter(|e| {
            e.path()
                .extension()
                .map(|x| x.eq_ignore_ascii_case("css"))
                .unwrap_or(false)
        })
        .collect();
    entries.sort_by_key(|e| e.file_name());
    let mut out = String::new();
    for e in entries {
        let content = fs::read_to_string(e.path()).map_err(|e| e.to_string())?;
        out.push_str(&format!(
            "/* === {} === */\n",
            e.file_name().to_string_lossy()
        ));
        out.push_str(&substitute_vars(&content, vars));
        if !content.ends_with('\n') {
            out.push('\n');
        }
    }
    Ok(out)
}

#[tauri::command]
fn read_tree(project_root: String) -> Result<TreeNode, String> {
    fs_guard!();
    let root = PathBuf::from(&project_root);
    let html_root = root.join(HTML_ROOT);
    if !html_root.exists() {
        fs::create_dir_all(&html_root).map_err(|e| e.to_string())?;
    }
    build_tree(&html_root).map_err(|e| e.to_string())
}

#[tauri::command]
fn read_node(node_path: String) -> Result<NodeConfig, String> {
    read_node_config(Path::new(&node_path))
}

#[tauri::command]
fn write_node(node_path: String, config: NodeConfig) -> Result<(), String> {
    fs_guard!();
    let dir = PathBuf::from(&node_path);
    fs::create_dir_all(&dir).map_err(|e| e.to_string())?;
    write_yaml(&dir.join(CONFIG_FILE), &config)
}

/// Seed common "link-bearing" tags with the attribute that makes them
/// actually functional — otherwise a fresh `<a>` etc. has nothing to attach
/// to and feels broken in the preview.
fn default_config_for_tag(tag: &str) -> NodeConfig {
    let mut cfg = NodeConfig::default();
    match tag {
        "a" | "area" => {
            cfg.attributes.insert("href".into(), "".into());
        }
        "img" => {
            cfg.attributes.insert("src".into(), "".into());
            cfg.attributes.insert("alt".into(), "".into());
        }
        "iframe" | "script" | "source" | "video" | "audio" | "embed" => {
            cfg.attributes.insert("src".into(), "".into());
        }
        "form" => {
            cfg.attributes.insert("action".into(), "".into());
            cfg.attributes.insert("method".into(), "get".into());
        }
        "input" => {
            cfg.attributes.insert("type".into(), "text".into());
            cfg.attributes.insert("name".into(), "".into());
        }
        "label" => {
            cfg.attributes.insert("for".into(), "".into());
        }
        _ => {}
    }
    cfg
}

#[tauri::command]
fn create_node(parent_path: String, name: String) -> Result<String, String> {
    fs_guard!();
    let dir = PathBuf::from(&parent_path).join(&name);
    if dir.exists() {
        return Err(format!("既に存在します: {}", dir.display()));
    }
    retry_io(|| fs::create_dir_all(&dir)).map_err(|e| e.to_string())?;
    // Derive the tag name from the folder name's portion after `_`
    // (e.g. "03_a" → "a") and seed sensible defaults for that tag.
    let (_, tag) = split_prefix(&name);
    let cfg = default_config_for_tag(tag);
    write_yaml(&dir.join(CONFIG_FILE), &cfg)?;
    Ok(dir.to_string_lossy().into_owned())
}

#[tauri::command]
fn delete_node(node_path: String) -> Result<(), String> {
    fs_guard!();
    let p = PathBuf::from(&node_path);
    retry_io(|| fs::remove_dir_all(&p)).map_err(|e| e.to_string())
}

#[tauri::command]
fn rename_node(old_path: String, new_name: String) -> Result<String, String> {
    fs_guard!();
    let old = PathBuf::from(&old_path);
    let parent = old
        .parent()
        .ok_or_else(|| "親フォルダが見つかりません".to_string())?;
    let new_path = parent.join(&new_name);
    retry_io(|| fs::rename(&old, &new_path)).map_err(|e| e.to_string())?;
    Ok(new_path.to_string_lossy().into_owned())
}

#[tauri::command]
fn snapshot_subtree(node_path: String) -> Result<NodeSnapshot, String> {
    fn walk(path: &Path) -> Result<NodeSnapshot, String> {
        let name = path
            .file_name()
            .map(|n| n.to_string_lossy().into_owned())
            .ok_or_else(|| "invalid path".to_string())?;
        let config = read_node_config(path)?;
        let mut children = Vec::new();
        if path.is_dir() {
            let mut entries: Vec<_> = fs::read_dir(path)
                .map_err(|e| e.to_string())?
                .filter_map(|e| e.ok())
                .filter(|e| e.path().is_dir())
                .collect();
            entries.sort_by_key(|e| e.file_name());
            for e in entries {
                children.push(walk(&e.path())?);
            }
        }
        Ok(NodeSnapshot {
            name,
            config,
            children,
        })
    }
    walk(Path::new(&node_path))
}

#[tauri::command]
fn restore_subtree(parent_path: String, snapshot: NodeSnapshot) -> Result<String, String> {
    fs_guard!();
    fn build(parent: &Path, snap: &NodeSnapshot) -> Result<PathBuf, String> {
        let new_path = parent.join(&snap.name);
        retry_io(|| fs::create_dir_all(&new_path)).map_err(|e| e.to_string())?;
        write_yaml(&new_path.join(CONFIG_FILE), &snap.config)?;
        for child in &snap.children {
            build(&new_path, child)?;
        }
        Ok(new_path)
    }
    let p = build(Path::new(&parent_path), &snapshot)?;
    Ok(p.to_string_lossy().into_owned())
}

#[tauri::command]
fn read_project_config(project_root: String) -> Result<ProjectConfig, String> {
    let p = PathBuf::from(&project_root).join(PROJECT_FILE);
    if !p.exists() {
        return Ok(ProjectConfig::default());
    }
    let s = fs::read_to_string(&p).map_err(|e| e.to_string())?;
    if s.trim().is_empty() {
        return Ok(ProjectConfig::default());
    }
    serde_yml::from_str(&s).map_err(|e| e.to_string())
}

#[tauri::command]
fn write_project_config(project_root: String, config: ProjectConfig) -> Result<(), String> {
    let p = PathBuf::from(&project_root).join(PROJECT_FILE);
    write_yaml(&p, &config)
}

#[tauri::command]
fn init_project(project_root: String, doctype: Option<String>) -> Result<(), String> {
    let root = PathBuf::from(&project_root);
    fs::create_dir_all(&root).map_err(|e| e.to_string())?;

    // htfl.yaml
    let proj_yaml = root.join(PROJECT_FILE);
    let mut cfg = if proj_yaml.exists() {
        let s = fs::read_to_string(&proj_yaml).map_err(|e| e.to_string())?;
        if s.trim().is_empty() {
            ProjectConfig::default()
        } else {
            serde_yml::from_str(&s).unwrap_or_default()
        }
    } else {
        ProjectConfig::default()
    };
    if let Some(d) = doctype {
        cfg.doctype = Some(d);
    } else if cfg.doctype.is_none() {
        cfg.doctype = Some(DEFAULT_DOCTYPE.to_string());
    }
    write_yaml(&proj_yaml, &cfg)?;

    // HTML/
    let html_root = root.join(HTML_ROOT);
    fs::create_dir_all(&html_root).map_err(|e| e.to_string())?;
    if !html_root.join(CONFIG_FILE).exists() {
        let mut html_cfg = NodeConfig::default();
        html_cfg
            .attributes
            .insert("lang".to_string(), "ja".to_string());
        write_yaml(&html_root.join(CONFIG_FILE), &html_cfg)?;
    }

    // 01_head/
    let head_dir = html_root.join("01_head");
    if !head_dir.exists() {
        fs::create_dir_all(&head_dir).map_err(|e| e.to_string())?;
        let mut head_cfg = NodeConfig::default();
        head_cfg
            .attributes
            .insert("dummy_skip".to_string(), String::new()); // ensures non-empty serialization for clarity
        head_cfg.attributes.remove("dummy_skip");
        write_yaml(&head_dir.join(CONFIG_FILE), &NodeConfig::default())?;
    }
    // meta charset under head
    let meta_dir = head_dir.join("01_meta");
    if !meta_dir.exists() {
        fs::create_dir_all(&meta_dir).map_err(|e| e.to_string())?;
        let mut meta_cfg = NodeConfig::default();
        meta_cfg.tag = Some("meta".to_string());
        meta_cfg
            .attributes
            .insert("charset".to_string(), "UTF-8".to_string());
        write_yaml(&meta_dir.join(CONFIG_FILE), &meta_cfg)?;
    }
    // title under head
    let title_dir = head_dir.join("02_title");
    if !title_dir.exists() {
        fs::create_dir_all(&title_dir).map_err(|e| e.to_string())?;
        let mut title_cfg = NodeConfig::default();
        title_cfg.tag = Some("title".to_string());
        title_cfg.content = Some("Untitled".to_string());
        write_yaml(&title_dir.join(CONFIG_FILE), &title_cfg)?;
    }

    // 02_body/
    let body_dir = html_root.join("02_body");
    if !body_dir.exists() {
        fs::create_dir_all(&body_dir).map_err(|e| e.to_string())?;
        write_yaml(&body_dir.join(CONFIG_FILE), &NodeConfig::default())?;
    }

    // classes/
    let classes = root.join(CLASSES_DIR);
    if !classes.exists() {
        fs::create_dir_all(&classes).map_err(|e| e.to_string())?;
        let stub = "/* 01_foundation.css — リセット・ベース */\n\nhtml, body {\n  margin: 0;\n  padding: 0;\n}\n";
        fs::write(classes.join("01_foundation.css"), stub).map_err(|e| e.to_string())?;
    }

    // images/
    let images = root.join(IMAGES_DIR);
    if !images.exists() {
        fs::create_dir_all(&images).map_err(|e| e.to_string())?;
        // .gitkeep style placeholder
        fs::write(images.join(".keep"), "").map_err(|e| e.to_string())?;
    }

    // plugins/
    let plugins = root.join(PLUGINS_DIR);
    if !plugins.exists() {
        fs::create_dir_all(&plugins).map_err(|e| e.to_string())?;
        fs::write(plugins.join(".keep"), "").map_err(|e| e.to_string())?;
    }

    Ok(())
}

#[tauri::command]
fn read_class_files(project_root: String) -> Result<Vec<ClassFile>, String> {
    let dir = PathBuf::from(&project_root).join(CLASSES_DIR);
    if !dir.is_dir() {
        return Ok(Vec::new());
    }
    let mut entries: Vec<_> = fs::read_dir(&dir)
        .map_err(|e| e.to_string())?
        .filter_map(|e| e.ok())
        .filter(|e| {
            e.path()
                .extension()
                .map(|x| x.eq_ignore_ascii_case("css"))
                .unwrap_or(false)
        })
        .collect();
    entries.sort_by_key(|e| e.file_name());
    let mut out = Vec::new();
    for e in entries {
        let content = fs::read_to_string(e.path()).map_err(|e| e.to_string())?;
        out.push(ClassFile {
            name: e.file_name().to_string_lossy().into_owned(),
            content,
        });
    }
    Ok(out)
}

#[tauri::command]
fn write_class_file(
    project_root: String,
    file_name: String,
    content: String,
) -> Result<(), String> {
    if file_name.contains('/') || file_name.contains('\\') {
        return Err("ファイル名にパス区切り文字は使えません".into());
    }
    let dir = PathBuf::from(&project_root).join(CLASSES_DIR);
    fs::create_dir_all(&dir).map_err(|e| e.to_string())?;
    fs::write(dir.join(&file_name), content).map_err(|e| e.to_string())
}

#[tauri::command]
fn delete_class_file(project_root: String, file_name: String) -> Result<(), String> {
    if file_name.contains('/') || file_name.contains('\\') {
        return Err("ファイル名にパス区切り文字は使えません".into());
    }
    let p = PathBuf::from(&project_root).join(CLASSES_DIR).join(&file_name);
    fs::remove_file(&p).map_err(|e| e.to_string())
}

#[tauri::command]
fn read_modules(project_root: String) -> Result<Vec<ModuleFile>, String> {
    let dir = PathBuf::from(&project_root).join(MODULES_DIR);
    if !dir.is_dir() {
        return Ok(Vec::new());
    }
    let mut entries: Vec<_> = fs::read_dir(&dir)
        .map_err(|e| e.to_string())?
        .filter_map(|e| e.ok())
        .filter(|e| {
            e.path()
                .extension()
                .map(|x| x.eq_ignore_ascii_case("yaml") || x.eq_ignore_ascii_case("yml"))
                .unwrap_or(false)
        })
        .collect();
    entries.sort_by_key(|e| e.file_name());
    let mut out = Vec::new();
    for e in entries {
        let content = fs::read_to_string(e.path()).map_err(|x| x.to_string())?;
        // A malformed module file must not crash the whole load — skip it.
        let modules: Vec<ModuleDef> = if content.trim().is_empty() {
            Vec::new()
        } else {
            match serde_yml::from_str(&content) {
                Ok(m) => m,
                Err(_) => continue,
            }
        };
        out.push(ModuleFile {
            name: e.file_name().to_string_lossy().into_owned(),
            modules,
        });
    }
    Ok(out)
}

#[tauri::command]
fn write_module_file(
    project_root: String,
    file_name: String,
    modules: Vec<ModuleDef>,
) -> Result<(), String> {
    if file_name.contains('/') || file_name.contains('\\') {
        return Err("ファイル名にパス区切り文字は使えません".into());
    }
    let dir = PathBuf::from(&project_root).join(MODULES_DIR);
    fs::create_dir_all(&dir).map_err(|e| e.to_string())?;
    let yaml = serde_yml::to_string(&modules).map_err(|e| e.to_string())?;
    retry_io(|| fs::write(dir.join(&file_name), &yaml)).map_err(|e| e.to_string())
}

#[tauri::command]
fn delete_module_file(project_root: String, file_name: String) -> Result<(), String> {
    if file_name.contains('/') || file_name.contains('\\') {
        return Err("ファイル名にパス区切り文字は使えません".into());
    }
    let p = PathBuf::from(&project_root).join(MODULES_DIR).join(&file_name);
    fs::remove_file(&p).map_err(|e| e.to_string())
}

/// Copy an external module file into the project's `modules/` folder after
/// validating that it parses as a module list. Returns the stored file name.
#[tauri::command]
fn import_module_file(project_root: String, src_path: String) -> Result<String, String> {
    let src = PathBuf::from(&src_path);
    let content = fs::read_to_string(&src).map_err(|e| e.to_string())?;
    serde_yml::from_str::<Vec<ModuleDef>>(&content)
        .map_err(|e| format!("モジュールファイルとして読み込めません: {e}"))?;
    let file_name = src
        .file_name()
        .map(|n| n.to_string_lossy().into_owned())
        .ok_or_else(|| "ファイル名が不正です".to_string())?;
    let dir = PathBuf::from(&project_root).join(MODULES_DIR);
    fs::create_dir_all(&dir).map_err(|e| e.to_string())?;
    fs::write(dir.join(&file_name), content).map_err(|e| e.to_string())?;
    Ok(file_name)
}

/// Enumerate `images/<folder>/<file>` so the editor can present them like
/// classes — pick a folder, see its images, click one to apply.
#[tauri::command]
fn read_image_folders(project_root: String) -> Result<Vec<ImageFolder>, String> {
    let images_dir = PathBuf::from(&project_root).join(IMAGES_DIR);
    if !images_dir.is_dir() {
        return Ok(Vec::new());
    }
    let mut subdirs: Vec<_> = fs::read_dir(&images_dir)
        .map_err(|e| e.to_string())?
        .filter_map(|e| e.ok())
        .filter(|e| e.path().is_dir())
        .collect();
    subdirs.sort_by_key(|e| e.file_name());

    let is_image_ext = |ext: Option<&str>| -> bool {
        matches!(
            ext.map(|s| s.to_ascii_lowercase()).as_deref(),
            Some("png") | Some("jpg") | Some("jpeg") | Some("gif")
                | Some("svg") | Some("webp") | Some("ico") | Some("avif") | Some("bmp")
        )
    };

    let mut out = Vec::with_capacity(subdirs.len());
    for sub in subdirs {
        let folder_name = sub.file_name().to_string_lossy().into_owned();
        let mut files: Vec<_> = fs::read_dir(sub.path())
            .map_err(|e| e.to_string())?
            .filter_map(|e| e.ok())
            .filter(|e| {
                let p = e.path();
                if !p.is_file() {
                    return false;
                }
                is_image_ext(p.extension().and_then(|s| s.to_str()))
            })
            .collect();
        files.sort_by_key(|e| e.file_name());
        let images = files
            .into_iter()
            .map(|f| {
                format!(
                    "{}/{}",
                    folder_name,
                    f.file_name().to_string_lossy()
                )
            })
            .collect();
        out.push(ImageFolder {
            name: folder_name,
            images,
        });
    }
    Ok(out)
}

// Pure HTML generation from a project (no side effects). Shared by the
// live preview (build_html) and the file exporter (export_html).
fn generate_html(root: &Path, dev: bool) -> Result<String, String> {
    let html_root = root.join(HTML_ROOT);
    let project_cfg = read_project_config(root.to_string_lossy().into_owned())?;
    let tree = build_tree(&html_root).map_err(|e| e.to_string())?;
    let html_cfg = read_node_config(&html_root)?;
    let lang = html_cfg
        .attributes
        .get("lang")
        .cloned()
        .unwrap_or_else(|| "ja".into());

    let doctype = project_cfg
        .doctype
        .clone()
        .unwrap_or_else(|| DEFAULT_DOCTYPE.to_string());

    let user_class_css =
        read_classes_css(&root.join(CLASSES_DIR), &project_cfg.variables)?;
    let css_reset_on = project_cfg.css_reset.unwrap_or(true);
    let class_css = if css_reset_on {
        format!("{}\n{}", HTFL_RESET_CSS, user_class_css)
    } else {
        user_class_css
    };

    // SSR/static mode omits the per-element SCRIPT (js) layer so the page
    // works with JavaScript disabled. Default ("ssr+js") emits it.
    let emit_scripts = project_cfg.output_mode.as_deref() != Some("ssr");

    // Project-level <head> tags (FILE → HEAD), pre-rendered for injection.
    let head_tags = project_cfg
        .head
        .as_ref()
        .map(|h| render_head_tags(h, "    "))
        .unwrap_or_default();

    let mut out = String::new();
    let mut scripts: Vec<(String, String)> = Vec::new();
    let mut js_counter: u32 = 0;
    let mut id_counter: u32 = 0;
    out.push_str(&doctype);
    out.push('\n');
    out.push_str(&format!("<html lang=\"{}\">\n", escape_attr(&lang)));
    for child in &tree.children {
        let (extra_styles, extra_tags) = if child.display_name == "head" {
            (Some(class_css.as_str()), Some(head_tags.as_str()))
        } else {
            (None, None)
        };
        render_node(
            child,
            &project_cfg.variables,
            1,
            &mut out,
            extra_styles,
            extra_tags,
            &mut scripts,
            &mut js_counter,
            dev,
            &mut id_counter,
            false,
            emit_scripts,
        )?;
    }
    if dev {
        out.push_str(DEV_SELECT_SCRIPT);
    }
    out.push_str("</html>\n");
    Ok(out)
}

#[tauri::command]
fn build_html(
    project_root: String,
    state: tauri::State<Arc<PreviewState>>,
    dev: Option<bool>,
) -> Result<String, String> {
    let root = PathBuf::from(&project_root);
    let out = {
        fs_guard!();
        generate_html(&root, dev.unwrap_or(false))?
    };

    // Push to the preview server so any open browser tab can pick it up.
    if let Ok(mut h) = state.html.lock() {
        *h = out.clone();
    }
    if let Ok(mut p) = state.project_root.lock() {
        *p = Some(root);
    }
    state.version.fetch_add(1, Ordering::Relaxed);

    Ok(out)
}

/// Decode (export) the current HTFL project to a standalone .html file.
#[tauri::command]
fn export_html(project_root: String, dest_file: String) -> Result<(), String> {
    let root = PathBuf::from(&project_root);
    let out = {
        fs_guard!();
        generate_html(&root, false)?
    };
    fs::write(&dest_file, out).map_err(|e| e.to_string())
}

// ---------- HTML import (encode .html → HTFL folders) ----------

fn sanitize_tag(t: &str) -> String {
    let s: String = t
        .chars()
        .filter(|c| c.is_ascii_alphanumeric() || *c == '-' || *c == '_')
        .collect();
    if s.is_empty() {
        "tag".to_string()
    } else {
        s
    }
}

fn inline_style_to_lines(style: &str) -> String {
    style
        .split(';')
        .map(|d| d.trim())
        .filter(|d| !d.is_empty())
        .map(|d| format!("{};", d))
        .collect::<Vec<_>>()
        .join("\n")
}

fn apply_attrs(el: &scraper::node::Element, cfg: &mut NodeConfig) {
    for (name, value) in el.attrs() {
        match name {
            "id" => cfg.id = Some(value.to_string()),
            "class" => {
                let cls: Vec<String> =
                    value.split_whitespace().map(|s| s.to_string()).collect();
                cfg.available_classes = cls.clone();
                cfg.classes = cls;
            }
            "style" => {
                let css = inline_style_to_lines(value);
                if !css.is_empty() {
                    cfg.css = Some(css);
                }
            }
            _ => {
                cfg.attributes.insert(name.to_string(), value.to_string());
            }
        }
    }
}

fn write_imported_element(
    el: scraper::ElementRef,
    folder: &Path,
    html_dir: Option<&Path>,
    imported_css: &mut String,
) -> Result<(), String> {
    let tag_name = el.value().name().to_ascii_lowercase();

    let mut cfg = NodeConfig::default();
    apply_attrs(el.value(), &mut cfg);

    // Direct text content (skip script/style — handled separately).
    if tag_name != "script" && tag_name != "style" {
        let mut text = String::new();
        for child in el.children() {
            if let Some(t) = child.value().as_text() {
                let s = t.trim();
                if !s.is_empty() {
                    if !text.is_empty() {
                        text.push(' ');
                    }
                    text.push_str(s);
                }
            }
        }
        if !text.is_empty() {
            cfg.content = Some(text);
        }
    }

    fs::create_dir_all(folder).map_err(|e| e.to_string())?;
    write_yaml(&folder.join(CONFIG_FILE), &cfg)?;

    let mut order: u32 = 1;
    for child in el.children() {
        let child_el = match scraper::ElementRef::wrap(child) {
            Some(c) => c,
            None => continue,
        };
        let ctag = child_el.value().name().to_ascii_lowercase();

        // <style> → classes/, skip element folder
        if ctag == "style" {
            let css: String = child_el.text().collect();
            imported_css.push_str(css.trim());
            imported_css.push('\n');
            continue;
        }

        // <link rel=stylesheet href=local.css> → classes/, skip folder
        if ctag == "link" {
            let rel = child_el.value().attr("rel").unwrap_or("");
            let href = child_el.value().attr("href").unwrap_or("");
            let is_local = !href.is_empty()
                && !href.starts_with("http")
                && !href.starts_with("//");
            if rel.contains("stylesheet") && is_local {
                if let Some(dir) = html_dir {
                    if let Ok(css) = fs::read_to_string(dir.join(href)) {
                        imported_css.push_str(&format!("/* {} */\n", href));
                        imported_css.push_str(&css);
                        imported_css.push('\n');
                        continue;
                    }
                }
            }
        }

        let child_folder =
            folder.join(format!("{:02}_{}", order, sanitize_tag(&ctag)));
        write_imported_element(child_el, &child_folder, html_dir, imported_css)?;
        order += 1;
    }
    Ok(())
}

/// Encode an existing .html (+ referenced local .css) into an HTFL project
/// under `dest_root`. Returns the created project root path.
#[tauri::command]
fn import_html(html_path: String, dest_root: String) -> Result<String, String> {
    let html_pathbuf = PathBuf::from(&html_path);
    let html_dir = html_pathbuf.parent().map(|p| p.to_path_buf());
    let content = fs::read_to_string(&html_pathbuf).map_err(|e| e.to_string())?;
    let doc = scraper::Html::parse_document(&content);

    let dest = PathBuf::from(&dest_root);
    fs::create_dir_all(&dest).map_err(|e| e.to_string())?;

    let mut imported_css = String::new();

    let html_sel = scraper::Selector::parse("html").unwrap();
    let html_el = doc
        .select(&html_sel)
        .next()
        .ok_or_else(|| "`<html>` 要素が見つかりません".to_string())?;

    let html_folder = dest.join(HTML_ROOT);
    fs::create_dir_all(&html_folder).map_err(|e| e.to_string())?;

    // <html> attributes → HTML/config.yaml
    let mut html_cfg = NodeConfig::default();
    apply_attrs(html_el.value(), &mut html_cfg);
    write_yaml(&html_folder.join(CONFIG_FILE), &html_cfg)?;

    let mut order: u32 = 1;
    for child in html_el.children() {
        let child_el = match scraper::ElementRef::wrap(child) {
            Some(c) => c,
            None => continue,
        };
        let ctag = child_el.value().name().to_ascii_lowercase();
        let folder = html_folder.join(format!("{:02}_{}", order, sanitize_tag(&ctag)));
        write_imported_element(
            child_el,
            &folder,
            html_dir.as_deref(),
            &mut imported_css,
        )?;
        order += 1;
    }

    // classes/
    let classes_dir = dest.join(CLASSES_DIR);
    fs::create_dir_all(&classes_dir).map_err(|e| e.to_string())?;
    if !imported_css.trim().is_empty() {
        fs::write(classes_dir.join("01_imported.css"), imported_css)
            .map_err(|e| e.to_string())?;
    }
    // images/
    fs::create_dir_all(dest.join(IMAGES_DIR)).map_err(|e| e.to_string())?;

    // htfl.yaml — imported pages assume browser defaults, so reset is off.
    let proj = ProjectConfig {
        doctype: Some(DEFAULT_DOCTYPE.to_string()),
        css_reset: Some(false),
        ..Default::default()
    };
    write_yaml(&dest.join(PROJECT_FILE), &proj)?;

    Ok(dest.to_string_lossy().into_owned())
}

// ---------- Plugin commands ----------

#[tauri::command]
fn read_plugins(project_root: String) -> Result<Vec<LoadedPlugin>, String> {
    let dir = PathBuf::from(&project_root).join(PLUGINS_DIR);
    if !dir.is_dir() {
        return Ok(Vec::new());
    }
    let mut subs: Vec<_> = fs::read_dir(&dir)
        .map_err(|e| e.to_string())?
        .filter_map(|e| e.ok())
        .filter(|e| e.path().is_dir())
        .collect();
    subs.sort_by_key(|e| e.file_name());

    let mut out = Vec::new();
    for sub in subs {
        let manifest_path = sub.path().join("plugin.yaml");
        if !manifest_path.exists() {
            continue;
        }
        let s = fs::read_to_string(&manifest_path).map_err(|e| e.to_string())?;
        let manifest: PluginManifest = serde_yml::from_str(&s).map_err(|e| {
            format!("{}: {}", sub.file_name().to_string_lossy(), e)
        })?;
        out.push(LoadedPlugin {
            dir: sub.path().to_string_lossy().into_owned(),
            dir_name: sub.file_name().to_string_lossy().into_owned(),
            manifest,
        });
    }
    Ok(out)
}

#[tauri::command]
fn read_plugin_script(plugin_dir: String, script: String) -> Result<String, String> {
    if script.contains("..") {
        return Err("不正なスクリプトパスです".into());
    }
    let p = PathBuf::from(&plugin_dir).join(&script);
    fs::read_to_string(&p).map_err(|e| e.to_string())
}

#[tauri::command]
fn write_text_file(dest: String, content: String) -> Result<(), String> {
    fs::write(&dest, content).map_err(|e| e.to_string())
}

// ---------- Preview server ----------
// A tiny local HTTP server keeps the latest generated HTML in memory and
// serves it (plus the project's static files) to whatever external browser
// the user picks. The page itself polls `/__version` every ~800 ms; when the
// number bumps the browser reloads — so any save in the editor is reflected
// almost immediately without a manual refresh.

pub struct PreviewState {
    html: Mutex<String>,
    version: AtomicU64,
    project_root: Mutex<Option<PathBuf>>,
    port: Mutex<u16>,
    /// Last element path the dev-preview reported as clicked.
    selected_path: Mutex<Option<String>>,
    /// Bumped on each dev-preview click so the editor can detect new picks.
    select_version: AtomicU64,
}

#[derive(Serialize, Deserialize, Debug, Clone)]
pub struct SelectionInfo {
    pub version: u64,
    pub path: Option<String>,
}

fn mime_for(path: &Path) -> &'static str {
    let ext = path
        .extension()
        .and_then(|e| e.to_str())
        .map(|s| s.to_ascii_lowercase());
    match ext.as_deref() {
        Some("html") | Some("htm") => "text/html; charset=utf-8",
        Some("css") => "text/css; charset=utf-8",
        Some("js") => "application/javascript; charset=utf-8",
        Some("json") => "application/json; charset=utf-8",
        Some("png") => "image/png",
        Some("jpg") | Some("jpeg") => "image/jpeg",
        Some("gif") => "image/gif",
        Some("svg") => "image/svg+xml",
        Some("webp") => "image/webp",
        Some("ico") => "image/x-icon",
        Some("woff") => "font/woff",
        Some("woff2") => "font/woff2",
        Some("ttf") => "font/ttf",
        Some("otf") => "font/otf",
        Some("mp4") => "video/mp4",
        Some("mp3") => "audio/mpeg",
        Some("wav") => "audio/wav",
        Some("txt") | Some("md") => "text/plain; charset=utf-8",
        _ => "application/octet-stream",
    }
}

const AUTORELOAD_SNIPPET: &str = r#"<script>
(function(){
  let lastV = 0;
  async function poll() {
    try {
      const r = await fetch('/__version', { cache: 'no-store' });
      if (r.ok) {
        const v = parseInt(await r.text(), 10);
        if (!Number.isNaN(v)) {
          if (lastV && v > lastV) { location.reload(); return; }
          lastV = v;
        }
      }
    } catch (e) {}
    setTimeout(poll, 800);
  }
  poll();
})();
</script>
"#;

fn inject_autoreload(html: &str) -> String {
    if let Some(idx) = html.rfind("</body>") {
        let mut out = String::with_capacity(html.len() + AUTORELOAD_SNIPPET.len());
        out.push_str(&html[..idx]);
        out.push_str(AUTORELOAD_SNIPPET);
        out.push_str(&html[idx..]);
        out
    } else if let Some(idx) = html.rfind("</html>") {
        let mut out = String::with_capacity(html.len() + AUTORELOAD_SNIPPET.len());
        out.push_str(&html[..idx]);
        out.push_str(AUTORELOAD_SNIPPET);
        out.push_str(&html[idx..]);
        out
    } else {
        format!("{}\n{}", html, AUTORELOAD_SNIPPET)
    }
}

fn start_preview_server(state: Arc<PreviewState>) -> std::io::Result<u16> {
    use tiny_http::{Header, Response, Server};

    let server = Server::http("127.0.0.1:0")
        .map_err(|e| std::io::Error::new(std::io::ErrorKind::Other, e.to_string()))?;
    let port = server
        .server_addr()
        .to_ip()
        .map(|a| a.port())
        .unwrap_or(0);

    std::thread::spawn(move || {
        let no_cache_h =
            Header::from_bytes(&b"Cache-Control"[..], &b"no-store"[..]).unwrap();
        for mut request in server.incoming_requests() {
            let raw = request.url().to_string();
            let path = raw.split('?').next().unwrap_or("/").to_string();
            let is_post = matches!(request.method(), tiny_http::Method::Post);

            // Dev-preview reports a clicked element here.
            if is_post && path == "/__select" {
                let mut body = String::new();
                let _ = std::io::Read::read_to_string(
                    &mut request.as_reader(),
                    &mut body,
                );
                if let Ok(mut sp) = state.selected_path.lock() {
                    *sp = Some(body);
                }
                state.select_version.fetch_add(1, Ordering::Relaxed);
                let _ = request.respond(Response::empty(204));
                continue;
            }

            let path = path.as_str();
            if path == "/" || path == "/index.html" {
                let html = state
                    .html
                    .lock()
                    .ok()
                    .map(|h| h.clone())
                    .unwrap_or_default();
                let placeholder = if html.is_empty() {
                    "<!doctype html><meta charset=utf-8><title>Foling preview</title>\
                     <body style=\"font-family:sans-serif;padding:2rem;color:#444\">\
                     <h2>まだビルドされていません</h2>\
                     <p>エディタで <strong>RUN</strong> を押すと表示されます。</p>"
                        .to_string()
                } else {
                    html
                };
                let body = inject_autoreload(&placeholder);
                let h = Header::from_bytes(
                    &b"Content-Type"[..],
                    &b"text/html; charset=utf-8"[..],
                )
                .unwrap();
                let _ = request.respond(
                    Response::from_string(body)
                        .with_header(h)
                        .with_header(no_cache_h.clone()),
                );
                continue;
            }

            if path == "/__version" {
                let v = state.version.load(Ordering::Relaxed);
                let _ = request.respond(
                    Response::from_string(v.to_string()).with_header(no_cache_h.clone()),
                );
                continue;
            }

            // Static file from project root (images / linked css / etc.)
            let root_opt = state.project_root.lock().ok().and_then(|g| g.clone());
            if let Some(root) = root_opt {
                let trimmed = path.trim_start_matches('/');
                if !trimmed.is_empty() && !trimmed.contains("..") {
                    let target = root.join(trimmed);
                    if let Ok(canon) = target.canonicalize() {
                        let root_canon = root.canonicalize().unwrap_or(root.clone());
                        if canon.starts_with(&root_canon) && canon.is_file() {
                            if let Ok(data) = fs::read(&canon) {
                                let mime = mime_for(&canon);
                                // Don't unwrap: a bad Content-Type would panic
                                // and kill the preview-server thread. Fall back
                                // to sending the bytes without the header.
                                let resp = Response::from_data(data);
                                let resp = match Header::from_bytes(
                                    &b"Content-Type"[..],
                                    mime.as_bytes(),
                                ) {
                                    Ok(h) => resp.with_header(h),
                                    Err(_) => resp,
                                };
                                let _ = request.respond(resp);
                                continue;
                            }
                        }
                    }
                }
            }
            let _ = request.respond(Response::empty(404));
        }
    });
    Ok(port)
}

#[tauri::command]
fn preview_url(state: tauri::State<Arc<PreviewState>>) -> String {
    let port = state.port.lock().map(|p| *p).unwrap_or(0);
    if port == 0 {
        return String::new();
    }
    format!("http://127.0.0.1:{}", port)
}

/// Editor polls this in dev mode to learn which element the user clicked
/// in the external preview browser.
#[tauri::command]
fn poll_selection(state: tauri::State<Arc<PreviewState>>) -> SelectionInfo {
    SelectionInfo {
        version: state.select_version.load(Ordering::Relaxed),
        path: state.selected_path.lock().ok().and_then(|g| g.clone()),
    }
}

#[tauri::command]
fn open_in_browser(url: String, browser_path: Option<String>) -> Result<(), String> {
    let mut cmd: std::process::Command;
    match browser_path.filter(|s| !s.trim().is_empty()) {
        Some(path) => {
            cmd = std::process::Command::new(path);
            cmd.arg(&url);
        }
        None => {
            #[cfg(target_os = "windows")]
            {
                // Use cmd's start so the OS picks the default browser.
                // The "" is the optional window-title arg required by `start`.
                cmd = std::process::Command::new("cmd");
                cmd.args(["/C", "start", "", &url]);
            }
            #[cfg(target_os = "macos")]
            {
                cmd = std::process::Command::new("open");
                cmd.arg(&url);
            }
            #[cfg(all(not(target_os = "windows"), not(target_os = "macos")))]
            {
                cmd = std::process::Command::new("xdg-open");
                cmd.arg(&url);
            }
        }
    }
    cmd.spawn().map_err(|e| e.to_string())?;
    Ok(())
}

#[cfg_attr(mobile, tauri::mobile_entry_point)]
pub fn run() {
    let preview_state: Arc<PreviewState> = Arc::new(PreviewState {
        html: Mutex::new(String::new()),
        version: AtomicU64::new(0),
        project_root: Mutex::new(None),
        port: Mutex::new(0),
        selected_path: Mutex::new(None),
        select_version: AtomicU64::new(0),
    });
    if let Ok(port) = start_preview_server(preview_state.clone()) {
        if let Ok(mut p) = preview_state.port.lock() {
            *p = port;
        }
    }

    tauri::Builder::default()
        .plugin(tauri_plugin_dialog::init())
        // Remember the main window's size / position / maximized state between
        // launches.
        .plugin(tauri_plugin_window_state::Builder::default().build())
        // Self-update via signed artifacts published to GitHub Releases.
        .plugin(tauri_plugin_updater::Builder::new().build())
        .plugin(tauri_plugin_process::init())
        .manage(preview_state)
        .invoke_handler(tauri::generate_handler![
            read_tree,
            read_node,
            write_node,
            create_node,
            delete_node,
            rename_node,
            snapshot_subtree,
            restore_subtree,
            read_project_config,
            write_project_config,
            init_project,
            read_class_files,
            write_class_file,
            delete_class_file,
            read_modules,
            write_module_file,
            delete_module_file,
            import_module_file,
            read_image_folders,
            build_html,
            export_html,
            import_html,
            read_plugins,
            read_plugin_script,
            write_text_file,
            preview_url,
            open_in_browser,
            poll_selection,
        ])
        .run(tauri::generate_context!())
        .expect("error while running tauri application");
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn module_def_yaml_roundtrip() {
        // A module file is a YAML sequence of ModuleDef — make sure the bundled
        // snapshot + css survive a write→read round-trip unchanged.
        let m = ModuleDef {
            name: "card".into(),
            snapshot: NodeSnapshot {
                name: "01_div".into(),
                config: NodeConfig::default(),
                children: vec![NodeSnapshot {
                    name: "01_p".into(),
                    config: NodeConfig::default(),
                    children: vec![],
                }],
            },
            css: ".card { color: red; }".into(),
        };
        let yaml = serde_yml::to_string(&vec![m]).unwrap();
        let back: Vec<ModuleDef> = serde_yml::from_str(&yaml).unwrap();
        assert_eq!(back.len(), 1);
        assert_eq!(back[0].name, "card");
        assert_eq!(back[0].css, ".card { color: red; }");
        assert_eq!(back[0].snapshot.name, "01_div");
        assert_eq!(back[0].snapshot.children.len(), 1);
        assert_eq!(back[0].snapshot.children[0].name, "01_p");
    }

    #[test]
    fn sample_modules_parse() {
        // The shipped sample module file must stay a valid module list holding
        // the three sample components, each with bundled css and a subtree.
        let mods: Vec<ModuleDef> =
            serde_yml::from_str(include_str!("../../examples/modules/samples.yaml"))
                .unwrap_or_else(|e| panic!("samples.yaml failed to parse: {e}"));
        let names: Vec<&str> = mods.iter().map(|m| m.name.as_str()).collect();
        assert_eq!(names, ["drawermenu", "slider", "modal"]);
        for m in &mods {
            assert!(!m.css.trim().is_empty(), "{} has bundled css", m.name);
            assert!(!m.snapshot.children.is_empty(), "{} has a subtree", m.name);
        }
    }

    #[test]
    fn sample_module_builds_to_html() {
        // End-to-end: scaffold a temp project, restore the drawermenu module
        // under <body> (as the editor's expansion does), inject its bundled
        // css, then build — and check the real HTML/JS/CSS comes out.
        let dir = std::env::temp_dir().join(format!(
            "foling_modtest_{}_{}",
            std::process::id(),
            std::time::SystemTime::now()
                .duration_since(std::time::UNIX_EPOCH)
                .unwrap()
                .as_nanos()
        ));
        let root = dir.to_string_lossy().into_owned();
        init_project(root.clone(), None).unwrap();

        let mods: Vec<ModuleDef> =
            serde_yml::from_str(include_str!("../../examples/modules/samples.yaml")).unwrap();
        let drawer = mods.iter().find(|m| m.name == "drawermenu").unwrap();
        let body = dir.join(HTML_ROOT).join("02_body");
        restore_subtree(body.to_string_lossy().into_owned(), drawer.snapshot.clone()).unwrap();

        let classes = dir.join(CLASSES_DIR);
        fs::create_dir_all(&classes).unwrap();
        fs::write(classes.join("99_modules.css"), &drawer.css).unwrap();

        let html = generate_html(&dir, false).unwrap();
        let _ = fs::remove_dir_all(&dir); // best-effort cleanup

        assert!(html.contains("class=\"drawer\""), "root class emitted");
        assert!(
            html.contains("aria-label=\"Open menu\""),
            "toggle attribute emitted"
        );
        assert!(html.contains("data-htfl-id="), "js element tagged");
        assert!(
            html.contains("el.classList.add('is-open')"),
            "per-element js emitted"
        );
        assert!(
            html.contains(".drawer.is-open .drawer-panel"),
            "compound-selector css preserved in <style>"
        );
    }

    #[test]
    fn module_def_css_defaults_when_missing() {
        // Older / hand-written module files may omit `css:` — it must default
        // to empty rather than failing to parse.
        let yaml = "- name: bare\n  snapshot:\n    name: 01_div\n    config: {}\n    children: []\n";
        let back: Vec<ModuleDef> = serde_yml::from_str(yaml).unwrap();
        assert_eq!(back.len(), 1);
        assert_eq!(back[0].css, "");
    }

    #[test]
    fn resolve_tag_known_unknown_custom() {
        assert_eq!(resolve_tag("section"), "section");
        assert_eq!(resolve_tag("DIV"), "div"); // lowercased
        assert_eq!(resolve_tag("totally-unknown"), "totally-unknown"); // custom (has '-')
        assert_eq!(resolve_tag("wat"), "div"); // unknown → div
        assert_eq!(resolve_tag(""), "div"); // empty → div
    }

    #[test]
    fn split_prefix_parses_nn() {
        assert_eq!(split_prefix("02_section"), (Some(2), "section"));
        assert_eq!(split_prefix("10_div"), (Some(10), "div"));
        assert_eq!(split_prefix("header"), (None, "header"));
        // non-numeric prefix is not an ordinal
        assert_eq!(split_prefix("x_y"), (None, "x_y"));
    }

    #[test]
    fn substitute_vars_replaces_known_keeps_unknown() {
        let mut vars = BTreeMap::new();
        vars.insert("colorMain".to_string(), "#39b54a".to_string());
        assert_eq!(
            substitute_vars("background: $colorMain;", &vars),
            "background: #39b54a;"
        );
        // unknown variable is left verbatim
        assert_eq!(substitute_vars("$nope end", &vars), "$nope end");
        // a lone '$' (no name) is preserved
        assert_eq!(substitute_vars("price $ 5", &vars), "price $ 5");
    }

    #[test]
    fn escape_helpers() {
        assert_eq!(escape_html("a<b>&c"), "a&lt;b&gt;&amp;c");
        assert_eq!(escape_attr("x\"y<z"), "x&quot;y&lt;z");
    }

    #[test]
    fn mime_for_common_extensions() {
        assert_eq!(mime_for(Path::new("a/b.png")), "image/png");
        assert_eq!(mime_for(Path::new("style.CSS")), "text/css; charset=utf-8");
        assert_eq!(mime_for(Path::new("x.unknownext")), "application/octet-stream");
        assert_eq!(mime_for(Path::new("noext")), "application/octet-stream");
    }

    #[test]
    fn output_mode_ssr_omits_scripts() {
        // emit_scripts gating: "ssr" → false, default/"ssr+js" → true.
        assert!(Some("ssr+js") != Some("ssr"));
        let ssr: Option<&str> = Some("ssr");
        let dflt: Option<&str> = None;
        let plus: Option<&str> = Some("ssr+js");
        assert!(!(ssr != Some("ssr"))); // ssr → emit_scripts false
        assert!(dflt != Some("ssr")); // default → true
        assert!(plus != Some("ssr")); // ssr+js → true
    }
}
