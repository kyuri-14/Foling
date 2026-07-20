// SPDX-License-Identifier: AGPL-3.0-or-later
// Copyright (C) 2026 大松雄斗

//! HTML generation: tag resolution, variable substitution, escaping,
//! per-element rendering and whole-project assembly.

use std::collections::BTreeMap;
use std::fs;
use std::path::{Path, PathBuf};

use super::*;

// Resolve a desired tag name to the tag actually emitted. Unknown names fall
// back to <div> (custom elements — names containing `-` — are allowed as-is).
pub fn resolve_tag(name: &str) -> String {
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
pub const HTFL_RESET_CSS: &str = r#"/* HTFL default reset (toggle via VIEW > CSS リセット) */
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
pub const DEV_SELECT_SCRIPT: &str = r#"  <script data-htfl-dev>
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
// Render the project-level head config into HTML <head> child tags.
pub fn render_head_tags(head: &HeadConfig, indent: &str) -> String {
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
pub fn substitute_vars(text: &str, vars: &BTreeMap<String, String>) -> String {
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

pub fn escape_html(s: &str) -> String {
    s.replace('&', "&amp;")
        .replace('<', "&lt;")
        .replace('>', "&gt;")
}

pub fn escape_attr(s: &str) -> String {
    s.replace('&', "&amp;")
        .replace('"', "&quot;")
        .replace('<', "&lt;")
}
#[allow(clippy::too_many_arguments)]
pub fn render_node(
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
    // True once an ancestor is <pre>/<textarea>. Inside those, whitespace is
    // content: the pretty-printing indentation this function adds everywhere
    // else would show up on the page as leading spaces on every line.
    in_pre: bool,
) -> Result<(), String> {
    let cfg = read_node_config(Path::new(&node.path))?;
    let raw_tag = cfg
        .tag
        .clone()
        .unwrap_or_else(|| node.display_name.clone());
    // Unknown tag names fall back to <div> (matches the editor's warning).
    let tag = resolve_tag(&raw_tag);
    // Preformatted context: no layout whitespace may be emitted from here down.
    let pre_here = in_pre || tag == "pre" || tag == "textarea";
    let pad = if in_pre {
        String::new()
    } else {
        "  ".repeat(depth)
    };
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
        out.push_str(" />");
        if !in_pre {
            out.push('\n');
        }
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
        // The newline after an opening tag is layout, not content — and HTML
        // only forgives it directly after <pre>, not after a <code> nested in
        // one. Inside a preformatted element it would be a real line break.
        if !pre_here {
            out.push('\n');
        }

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
            if pre_here {
                // Verbatim: no indentation, and no trailing newline that would
                // render as a blank last line.
                for (i, line) in content_text.lines().enumerate() {
                    if i > 0 {
                        out.push('\n');
                    }
                    out.push_str(&escape_html(line));
                }
            } else {
                for line in content_text.lines() {
                    out.push_str(&"  ".repeat(depth + 1));
                    out.push_str(&escape_html(line));
                    out.push('\n');
                }
            }
        }
        for child in &node.children {
            render_node(
                child, vars, depth + 1, out, None, None, scripts, js_counter,
                dev, id_counter, numbering, emit_scripts, pre_here,
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

        // The closing tag gets no indentation inside a preformatted element —
        // that whitespace would land before </pre> and render as a blank line.
        if !pre_here {
            out.push_str(&pad);
        }
        out.push_str(&format!("</{}>", tag));
    } else {
        out.push_str(&format!("</{}>", tag));
    }
    // A line break after the closing tag is layout too.
    if !in_pre {
        out.push('\n');
    }
    Ok(())
}
pub fn read_classes_css(
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
// Pure HTML generation from a project (no side effects). Shared by the
// live preview (build_html) and the file exporter (export_html).
pub fn generate_html(root: &Path, dev: bool) -> Result<String, String> {
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
            false,
        )?;
    }
    if dev {
        out.push_str(DEV_SELECT_SCRIPT);
    }
    out.push_str("</html>\n");
    Ok(out)
}

/// [`generate_html`] under the filesystem lock. Callers that already hold the
/// lock (or are mid-transaction) want the bare version; everyone else wants
/// this one, so a rebuild never enumerates a tree another writer is renaming.
pub fn generate_html_locked(root: &Path, dev: bool) -> Result<String, String> {
    let _fs_guard = super::lock::fs_guard();
    generate_html(root, dev)
}

/// Decode (export) the current HTFL project to a standalone .html file.
pub fn export_html(project_root: String, dest_file: String) -> Result<(), String> {
    let root = PathBuf::from(&project_root);
    let out = {
        let _fs_guard = super::lock::fs_guard();
        generate_html(&root, false)?
    };
    fs::write(&dest_file, out).map_err(|e| e.to_string())
}