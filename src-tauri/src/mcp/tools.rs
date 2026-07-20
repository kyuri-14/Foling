// SPDX-License-Identifier: AGPL-3.0-or-later
// Copyright (C) 2026 大松雄斗

//! The tool surface Foling exposes to an agent.
//!
//! Every tool is a thin call into [`crate::htfl`] — the same functions the
//! editor's Tauri commands use. That is the whole point of the MCP layer: an
//! agent gets `NN_` numbering, `config.yaml` shape and build semantics enforced
//! by the application rather than reimplemented (and drifted) in a prompt.
//!
//! Deliberately *not* exposed: arbitrary file writes, terminal launching,
//! browser launching and plugin-script reads. An agent driving Foling should be
//! able to build a page, not to run commands on the user's machine.
//!
//! Tool names, descriptions and schemas are in English: they are read by the
//! model, not by the user, and English is this project's source language for UI
//! strings too.

use std::collections::HashSet;
use std::fmt::Write as _;
use std::path::Path;

use serde_json::{json, Value};

use super::workspace::Workspace;
use crate::htfl;

pub struct Tool {
    pub name: &'static str,
    pub description: &'static str,
    pub input_schema: Value,
}

/// Reference argument, shared by most tools.
fn ref_schema(desc: &str) -> Value {
    json!({ "type": "string", "description": desc })
}

pub fn list() -> Vec<Tool> {
    vec![
        Tool {
            name: "htfl_get_tree",
            description:
                "Show the element tree as indented text with line numbers. Line numbers are \
                 the element ids the build emits and match what the user sees in the editor, \
                 so this is the cheapest way to orient yourself before editing. Each row shows \
                 the tag, applied classes (.foo), a text-content preview, and ~css / ~js \
                 markers when the element carries its own styles or script.",
            input_schema: json!({
                "type": "object",
                "properties": {
                    "ref": ref_schema("Subtree to show, as a line number (\"L12\") or a path relative to HTML/ (\"02_body/01_header\"). Defaults to <body>."),
                    "depth": { "type": "integer", "minimum": 1, "description": "Maximum levels to descend. Omit for the whole subtree." }
                }
            }),
        },
        Tool {
            name: "htfl_get_element",
            description:
                "Read one element's full config.yaml: tag, id, classes, attributes, text \
                 content, per-element CSS and per-element JS.",
            input_schema: json!({
                "type": "object",
                "properties": { "ref": ref_schema("Line number (\"L12\") or path relative to HTML/.") },
                "required": ["ref"]
            }),
        },
        Tool {
            name: "htfl_get_project",
            description:
                "Read project settings from htfl.yaml: doctype, template variables, output \
                 mode, CSS reset, and the project-level <head> (title, description, OGP, \
                 favicon). <head> is a project setting in HTFL, not part of the element tree.",
            input_schema: json!({ "type": "object", "properties": {} }),
        },
        Tool {
            name: "htfl_list_classes",
            description: "List the CSS files under classes/ with the class names each defines.",
            input_schema: json!({ "type": "object", "properties": {} }),
        },
        Tool {
            name: "htfl_read_class_file",
            description: "Read one CSS file from classes/ verbatim.",
            input_schema: json!({
                "type": "object",
                "properties": { "file": { "type": "string", "description": "File name, e.g. \"01_foundation.css\"." } },
                "required": ["file"]
            }),
        },
        Tool {
            name: "htfl_list_modules",
            description:
                "List reusable modules available to this project. A module is a captured \
                 subtree plus the class definitions it uses; expand one with htfl_expand_module.",
            input_schema: json!({ "type": "object", "properties": {} }),
        },
        Tool {
            name: "htfl_list_images",
            description: "List images under images/, grouped by folder, as paths usable in src/url().",
            input_schema: json!({ "type": "object", "properties": {} }),
        },
        Tool {
            name: "htfl_insert_element",
            description:
                "Create a child element. The NN_ folder ordinal is assigned automatically and \
                 following siblings are renumbered only when inserting mid-list. Unknown tag \
                 names render as <div>; names containing '-' are treated as custom elements.",
            input_schema: json!({
                "type": "object",
                "properties": {
                    "parent": ref_schema("Parent element: line number or path relative to HTML/."),
                    "tag": { "type": "string", "description": "HTML tag name, e.g. \"section\"." },
                    "position": { "type": "integer", "minimum": 1, "description": "1-based position among the parent's children. Omit to append last." },
                    "content": { "type": "string", "description": "Optional text content for the new element." },
                    "classes": { "type": "array", "items": { "type": "string" }, "description": "Optional classes to apply." },
                    "css": { "type": "string", "description": "Optional per-element CSS declarations, one per line (e.g. \"padding: 1rem;\")." },
                    "attributes": { "type": "object", "description": "Optional HTML attributes." }
                },
                "required": ["parent", "tag"]
            }),
        },
        Tool {
            name: "htfl_update_element",
            description:
                "Patch one element's config. Only the fields you supply change; attributes are \
                 merged (pass null as a value to remove one). Pass null for content/css/js to \
                 clear them. To change an element's tag use htfl_rename_element.",
            input_schema: json!({
                "type": "object",
                "properties": {
                    "ref": ref_schema("Line number or path relative to HTML/."),
                    "content": { "type": ["string", "null"], "description": "Text content. null clears it." },
                    "css": { "type": ["string", "null"], "description": "Per-element CSS declarations, one per line. null clears it." },
                    "js": { "type": ["string", "null"], "description": "Per-element JavaScript; `el` is bound to this element. Not emitted when output_mode is \"ssr\". null clears it." },
                    "classes": { "type": "array", "items": { "type": "string" }, "description": "Replaces the applied class list." },
                    "available_classes": { "type": "array", "items": { "type": "string" }, "description": "Replaces the element's class palette (superset of classes)." },
                    "attributes": { "type": "object", "description": "Merged into existing attributes; a null value removes that attribute." },
                    "id": { "type": ["string", "null"], "description": "Explicit id. Ignored inside <body>, where the build numbers ids by line." }
                },
                "required": ["ref"]
            }),
        },
        Tool {
            name: "htfl_rename_element",
            description: "Change an element's tag, keeping its ordinal, config and children.",
            input_schema: json!({
                "type": "object",
                "properties": {
                    "ref": ref_schema("Line number or path relative to HTML/."),
                    "tag": { "type": "string", "description": "New HTML tag name." }
                },
                "required": ["ref", "tag"]
            }),
        },
        Tool {
            name: "htfl_move_element",
            description:
                "Move an element to a new parent and/or position, taking its subtree with it. \
                 Moving within the same parent reorders it.",
            input_schema: json!({
                "type": "object",
                "properties": {
                    "ref": ref_schema("Element to move."),
                    "parent": ref_schema("Destination parent. Omit to reorder within the current parent."),
                    "position": { "type": "integer", "minimum": 1, "description": "1-based position among the destination's children. Omit to append last." }
                },
                "required": ["ref"]
            }),
        },
        Tool {
            name: "htfl_delete_element",
            description: "Delete an element and its entire subtree. This is not undoable from the agent side.",
            input_schema: json!({
                "type": "object",
                "properties": { "ref": ref_schema("Element to delete. <body> itself cannot be deleted.") },
                "required": ["ref"]
            }),
        },
        Tool {
            name: "htfl_expand_module",
            description:
                "Expand a reusable module into the tree as a child of `parent`. The module's \
                 subtree is created and its bundled class definitions are appended to \
                 classes/99_modules.css, once per module regardless of how many instances exist.",
            input_schema: json!({
                "type": "object",
                "properties": {
                    "parent": ref_schema("Parent element to expand into."),
                    "module": { "type": "string", "description": "Module name, as listed by htfl_list_modules." },
                    "position": { "type": "integer", "minimum": 1, "description": "1-based position among the parent's children. Omit to append last." }
                },
                "required": ["parent", "module"]
            }),
        },
        Tool {
            name: "htfl_write_class_file",
            description:
                "Write a CSS file under classes/ (created if absent). These are the project's \
                 shared class definitions, inlined into <style> at build time. Whole-file \
                 write: read it first if you mean to append.",
            input_schema: json!({
                "type": "object",
                "properties": {
                    "file": { "type": "string", "description": "File name, e.g. \"02_component.css\". Ordering follows the name, so keep the NN_ prefix convention." },
                    "content": { "type": "string", "description": "Complete new file content." }
                },
                "required": ["file", "content"]
            }),
        },
        Tool {
            name: "htfl_update_project",
            description:
                "Patch project settings in htfl.yaml. Only supplied fields change. Use this for \
                 the page <title>, meta description and OGP tags — they live in the project \
                 <head>, not in the element tree.",
            input_schema: json!({
                "type": "object",
                "properties": {
                    "doctype": { "type": "string" },
                    "output_mode": { "type": "string", "enum": ["ssr", "ssr+js"], "description": "\"ssr\" omits the per-element JS layer so the page works with JavaScript disabled. Default \"ssr+js\"." },
                    "css_reset": { "type": "boolean", "description": "Whether to prepend Foling's built-in CSS reset. Default true." },
                    "variables": { "type": "object", "description": "Merged into template variables, usable as $name in CSS and attributes. A null value removes one." },
                    "lang": { "type": "string", "description": "The <html lang> attribute." },
                    "head": {
                        "type": "object",
                        "description": "Merged into the project <head>. A null value clears that tag.",
                        "properties": {
                            "charset": { "type": ["string", "null"] },
                            "viewport": { "type": ["string", "null"] },
                            "title": { "type": ["string", "null"] },
                            "description": { "type": ["string", "null"] },
                            "og_title": { "type": ["string", "null"] },
                            "og_description": { "type": ["string", "null"] },
                            "og_image": { "type": ["string", "null"] },
                            "favicon": { "type": ["string", "null"] },
                            "theme_color": { "type": ["string", "null"] }
                        }
                    }
                }
            }),
        },
        Tool {
            name: "htfl_build",
            description:
                "Build the project to HTML and report diagnostics: tags that will silently fall \
                 back to <div>, classes applied but never defined, content on void elements, \
                 and empty required attributes. Writes nothing — run it after edits to check \
                 your work.",
            input_schema: json!({
                "type": "object",
                "properties": {
                    "include_html": { "type": "boolean", "description": "Also return the generated HTML. Off by default because it is large." }
                }
            }),
        },
        Tool {
            name: "htfl_export_html",
            description: "Build the project and write it to a standalone .html file inside the project folder.",
            input_schema: json!({
                "type": "object",
                "properties": { "dest": { "type": "string", "description": "Destination path relative to the project root, e.g. \"dist/index.html\". The folder must already exist." } },
                "required": ["dest"]
            }),
        },
    ]
}

/// Whether a tool writes to the project. The in-app transport uses this to
/// decide when the open editor needs to re-read the tree from disk.
pub fn is_mutating(name: &str) -> bool {
    matches!(
        name,
        "htfl_insert_element"
            | "htfl_update_element"
            | "htfl_rename_element"
            | "htfl_move_element"
            | "htfl_delete_element"
            | "htfl_expand_module"
            | "htfl_write_class_file"
            | "htfl_update_project"
            | "htfl_export_html"
    )
}

/// Dispatch a `tools/call`. The returned string is shown to the agent verbatim.
pub fn call(ws: &Workspace, name: &str, args: &Value) -> Result<String, String> {
    match name {
        "htfl_get_tree" => get_tree(ws, args),
        "htfl_get_element" => get_element(ws, args),
        "htfl_get_project" => get_project(ws),
        "htfl_list_classes" => list_classes(ws),
        "htfl_read_class_file" => read_class_file(ws, args),
        "htfl_list_modules" => list_modules(ws),
        "htfl_list_images" => list_images(ws),
        "htfl_insert_element" => insert_element(ws, args),
        "htfl_update_element" => update_element(ws, args),
        "htfl_rename_element" => rename_element(ws, args),
        "htfl_move_element" => move_element(ws, args),
        "htfl_delete_element" => delete_element(ws, args),
        "htfl_expand_module" => expand_module(ws, args),
        "htfl_write_class_file" => write_class_file(ws, args),
        "htfl_update_project" => update_project(ws, args),
        "htfl_build" => build(ws, args),
        "htfl_export_html" => export_html(ws, args),
        other => Err(format!("unknown tool: {other}")),
    }
}

// ---------- argument helpers ----------

fn req_str<'a>(args: &'a Value, key: &str) -> Result<&'a str, String> {
    args.get(key)
        .and_then(Value::as_str)
        .ok_or_else(|| format!("missing required argument '{key}'"))
}

fn opt_str<'a>(args: &'a Value, key: &str) -> Option<&'a str> {
    args.get(key).and_then(Value::as_str)
}

/// 1-based `position` argument → 0-based index for [`htfl`].
fn opt_position(args: &Value) -> Option<usize> {
    args.get("position")
        .and_then(Value::as_u64)
        .filter(|n| *n > 0)
        .map(|n| (n - 1) as usize)
}

fn opt_strings(args: &Value, key: &str) -> Option<Vec<String>> {
    args.get(key)?.as_array().map(|a| {
        a.iter()
            .filter_map(|v| v.as_str().map(str::to_string))
            .collect()
    })
}

/// Distinguishes "absent" (leave alone) from "null" (clear) from a value.
enum Patch<T> {
    Absent,
    Clear,
    Set(T),
}

fn str_patch(args: &Value, key: &str) -> Patch<String> {
    match args.get(key) {
        None => Patch::Absent,
        Some(Value::Null) => Patch::Clear,
        Some(v) => match v.as_str() {
            Some(s) => Patch::Set(s.to_string()),
            None => Patch::Absent,
        },
    }
}

fn apply_str_patch(field: &mut Option<String>, patch: Patch<String>) -> bool {
    match patch {
        Patch::Absent => false,
        Patch::Clear => {
            *field = None;
            true
        }
        Patch::Set(s) => {
            *field = Some(s);
            true
        }
    }
}

/// How an element is named back to the agent: both addressing forms at once.
fn describe(ws: &Workspace, path: &Path) -> String {
    match ws.line_of(path) {
        Some(line) => format!("L{line} ({})", ws.display_ref(path)),
        None => ws.display_ref(path),
    }
}

// ---------- read tools ----------

fn preview(text: &str, limit: usize) -> String {
    let one_line = text.split_whitespace().collect::<Vec<_>>().join(" ");
    if one_line.chars().count() <= limit {
        one_line
    } else {
        let cut: String = one_line.chars().take(limit).collect();
        format!("{cut}…")
    }
}

fn get_tree(ws: &Workspace, args: &Value) -> Result<String, String> {
    let start = match opt_str(args, "ref") {
        Some(r) => ws.resolve(r)?,
        None => ws.body_dir()?,
    };
    let max_depth = args
        .get("depth")
        .and_then(Value::as_u64)
        .map(|d| d as usize)
        .unwrap_or(usize::MAX);

    let mut out = String::new();
    let _ = writeln!(
        out,
        "{} — line numbers are element ids; use them or the path form as `ref`.",
        ws.display_ref(&start)
    );

    fn walk(
        ws: &Workspace,
        dir: &Path,
        depth: usize,
        max_depth: usize,
        out: &mut String,
    ) -> Result<(), String> {
        let cfg = htfl::read_node(dir.to_string_lossy().into_owned()).unwrap_or_default();
        let tag = ws.tag_of(dir);

        let mut row = String::new();
        if !cfg.classes.is_empty() {
            let _ = write!(row, " .{}", cfg.classes.join("."));
        }
        if let Some(src) = cfg.attributes.get("src").filter(|s| !s.is_empty()) {
            let _ = write!(row, " [{}]", preview(src, 40));
        }
        if let Some(href) = cfg.attributes.get("href").filter(|s| !s.is_empty()) {
            let _ = write!(row, " →{}", preview(href, 40));
        }
        if let Some(c) = cfg.content.as_deref().filter(|c| !c.trim().is_empty()) {
            let _ = write!(row, " \"{}\"", preview(c, 40));
        }
        if cfg.css.as_deref().map(|s| !s.trim().is_empty()).unwrap_or(false) {
            row.push_str(" ~css");
        }
        if cfg.js.as_deref().map(|s| !s.trim().is_empty()).unwrap_or(false) {
            row.push_str(" ~js");
        }

        match ws.line_of(dir) {
            Some(line) => {
                let _ = writeln!(out, "{line:>4}  {}{tag}{row}", "  ".repeat(depth));
            }
            None => {
                let _ = writeln!(out, "   -  {}{tag}{row}", "  ".repeat(depth));
            }
        }

        if depth + 1 > max_depth {
            let n = htfl::sibling_names(dir).map_err(|e| e.to_string())?.len();
            if n > 0 {
                let _ = writeln!(out, "      {}… {n} more", "  ".repeat(depth + 1));
            }
            return Ok(());
        }
        for name in htfl::sibling_names(dir).map_err(|e| e.to_string())? {
            walk(ws, &dir.join(name), depth + 1, max_depth, out)?;
        }
        Ok(())
    }

    walk(ws, &start, 0, max_depth, &mut out)?;
    Ok(out)
}

fn get_element(ws: &Workspace, args: &Value) -> Result<String, String> {
    let path = ws.resolve(req_str(args, "ref")?)?;
    let cfg = htfl::read_node(path.to_string_lossy().into_owned())?;
    let children = htfl::sibling_names(&path).map_err(|e| e.to_string())?;

    let mut out = String::new();
    let _ = writeln!(
        out,
        "{}  tag: {}  children: {}",
        describe(ws, &path),
        ws.tag_of(&path),
        children.len()
    );
    let yaml = serde_yml::to_string(&cfg).map_err(|e| e.to_string())?;
    if yaml.trim() == "{}" || yaml.trim().is_empty() {
        out.push_str("(no config set)\n");
    } else {
        out.push_str("---\n");
        out.push_str(&yaml);
    }
    Ok(out)
}

fn get_project(ws: &Workspace) -> Result<String, String> {
    let cfg = htfl::read_project_config(ws.root().to_string_lossy().into_owned())?;
    let html_cfg = htfl::read_node(ws.html_root().to_string_lossy().into_owned())?;
    let lang = html_cfg
        .attributes
        .get("lang")
        .cloned()
        .unwrap_or_else(|| "ja".into());
    let yaml = serde_yml::to_string(&cfg).map_err(|e| e.to_string())?;
    Ok(format!("html lang: {lang}\n---\n{yaml}"))
}

/// Class names defined anywhere in `classes/`. Used both by htfl_list_classes
/// and by the build diagnostics.
fn defined_classes(ws: &Workspace) -> Result<HashSet<String>, String> {
    let mut out = HashSet::new();
    for f in htfl::read_class_files(ws.root().to_string_lossy().into_owned())? {
        collect_selectors(&f.content, &mut out);
    }
    Ok(out)
}

/// Pull `.class-name` tokens out of CSS text. Crude on purpose: it only has to
/// be good enough to tell "this class has a definition somewhere" from "this
/// class is a typo", and over-collecting is the safe direction.
///
/// Comments are stripped first, because a header comment naming the file
/// (`/* 01_foundation.css — … */`) otherwise contributes a phantom `.css` class
/// to every listing.
fn collect_selectors(css: &str, out: &mut HashSet<String>) {
    let bytes: Vec<char> = strip_comments(css).chars().collect();
    let mut i = 0;
    while i < bytes.len() {
        if bytes[i] == '.' {
            let start = i + 1;
            let mut end = start;
            while end < bytes.len()
                && (bytes[end].is_ascii_alphanumeric() || bytes[end] == '-' || bytes[end] == '_')
            {
                end += 1;
            }
            // A leading digit means it was a decimal number (e.g. `0.5rem`).
            if end > start && !bytes[start].is_ascii_digit() {
                out.insert(bytes[start..end].iter().collect());
            }
            i = end;
        } else {
            i += 1;
        }
    }
}

/// Remove `/* … */` blocks. An unterminated comment swallows the rest, which
/// matches how a browser would read it.
fn strip_comments(css: &str) -> String {
    let mut out = String::with_capacity(css.len());
    let mut rest = css;
    while let Some(start) = rest.find("/*") {
        out.push_str(&rest[..start]);
        match rest[start + 2..].find("*/") {
            Some(end) => rest = &rest[start + 2 + end + 2..],
            None => return out,
        }
    }
    out.push_str(rest);
    out
}

fn list_classes(ws: &Workspace) -> Result<String, String> {
    let files = htfl::read_class_files(ws.root().to_string_lossy().into_owned())?;
    if files.is_empty() {
        return Ok("no CSS files under classes/\n".into());
    }
    let mut out = String::new();
    for f in files {
        let mut names: HashSet<String> = HashSet::new();
        collect_selectors(&f.content, &mut names);
        let mut names: Vec<String> = names.into_iter().collect();
        names.sort();
        let _ = writeln!(out, "{} ({} bytes)", f.name, f.content.len());
        if names.is_empty() {
            out.push_str("  (no class selectors)\n");
        } else {
            let _ = writeln!(out, "  .{}", names.join(" ."));
        }
    }
    Ok(out)
}

fn read_class_file(ws: &Workspace, args: &Value) -> Result<String, String> {
    let want = req_str(args, "file")?;
    htfl::read_class_files(ws.root().to_string_lossy().into_owned())?
        .into_iter()
        .find(|f| f.name == want)
        .map(|f| f.content)
        .ok_or_else(|| format!("no such class file: '{want}'"))
}

fn list_modules(ws: &Workspace) -> Result<String, String> {
    let files = htfl::read_modules(ws.root().to_string_lossy().into_owned())?;
    let mut out = String::new();
    for f in &files {
        let _ = writeln!(out, "{}", f.name);
        for m in &f.modules {
            let kids = m.snapshot.children.len();
            let (_, tag) = htfl::split_prefix(&m.snapshot.name);
            let _ = writeln!(
                out,
                "  {} — root <{tag}>, {kids} child element(s), {} bytes of bundled CSS",
                m.name,
                m.css.len()
            );
        }
    }
    if out.is_empty() {
        out.push_str("no modules in this project\n");
    }
    Ok(out)
}

fn list_images(ws: &Workspace) -> Result<String, String> {
    let folders = htfl::read_image_folders(ws.root().to_string_lossy().into_owned())?;
    let mut out = String::new();
    for f in &folders {
        let _ = writeln!(out, "{}/", f.name);
        for img in &f.images {
            let _ = writeln!(out, "  images/{img}");
        }
    }
    if out.is_empty() {
        out.push_str("no images in this project\n");
    }
    Ok(out)
}

// ---------- write tools ----------

fn insert_element(ws: &Workspace, args: &Value) -> Result<String, String> {
    ws.require_writable()?;
    let parent = ws.resolve(req_str(args, "parent")?)?;
    let tag = req_str(args, "tag")?;
    let created = htfl::insert_child(&parent, tag, opt_position(args))?;

    // Seed the config in the same call so a new element does not need a second
    // round trip just to get its text or classes.
    let mut cfg = htfl::read_node(created.to_string_lossy().into_owned())?;
    let mut touched = apply_str_patch(&mut cfg.content, str_patch(args, "content"));
    touched |= apply_str_patch(&mut cfg.css, str_patch(args, "css"));
    if let Some(classes) = opt_strings(args, "classes") {
        cfg.available_classes = classes.clone();
        cfg.classes = classes;
        touched = true;
    }
    if let Some(map) = args.get("attributes").and_then(Value::as_object) {
        for (k, v) in map {
            match v {
                Value::Null => {
                    cfg.attributes.remove(k);
                }
                _ => {
                    cfg.attributes.insert(
                        k.clone(),
                        v.as_str().map(str::to_string).unwrap_or_else(|| v.to_string()),
                    );
                }
            }
        }
        touched = true;
    }
    if touched {
        htfl::write_node(created.to_string_lossy().into_owned(), cfg)?;
    }

    let resolved = htfl::resolve_tag(tag);
    let note = if resolved != tag.to_ascii_lowercase() {
        format!("  (note: '{tag}' is not a known HTML tag and will render as <{resolved}>)")
    } else {
        String::new()
    };
    Ok(format!("created {}{note}\n", describe(ws, &created)))
}

fn update_element(ws: &Workspace, args: &Value) -> Result<String, String> {
    ws.require_writable()?;
    let path = ws.resolve(req_str(args, "ref")?)?;
    let key = path.to_string_lossy().into_owned();
    let mut cfg = htfl::read_node(key.clone())?;

    let mut changed: Vec<&str> = Vec::new();
    if apply_str_patch(&mut cfg.content, str_patch(args, "content")) {
        changed.push("content");
    }
    if apply_str_patch(&mut cfg.css, str_patch(args, "css")) {
        changed.push("css");
    }
    if apply_str_patch(&mut cfg.js, str_patch(args, "js")) {
        changed.push("js");
    }
    if apply_str_patch(&mut cfg.id, str_patch(args, "id")) {
        changed.push("id");
    }
    if let Some(classes) = opt_strings(args, "classes") {
        // Keep the palette a superset, so the editor still offers every class
        // the element has ever used.
        for c in &classes {
            if !cfg.available_classes.contains(c) {
                cfg.available_classes.push(c.clone());
            }
        }
        cfg.classes = classes;
        changed.push("classes");
    }
    if let Some(av) = opt_strings(args, "available_classes") {
        cfg.available_classes = av;
        changed.push("available_classes");
    }
    if let Some(map) = args.get("attributes").and_then(Value::as_object) {
        for (k, v) in map {
            match v {
                Value::Null => {
                    cfg.attributes.remove(k);
                }
                _ => {
                    cfg.attributes.insert(
                        k.clone(),
                        v.as_str().map(str::to_string).unwrap_or_else(|| v.to_string()),
                    );
                }
            }
        }
        changed.push("attributes");
    }

    if changed.is_empty() {
        return Ok(format!("{} — nothing to change\n", describe(ws, &path)));
    }
    htfl::write_node(key, cfg)?;
    Ok(format!(
        "updated {} ({})\n",
        describe(ws, &path),
        changed.join(", ")
    ))
}

fn rename_element(ws: &Workspace, args: &Value) -> Result<String, String> {
    ws.require_writable()?;
    let path = ws.resolve(req_str(args, "ref")?)?;
    let tag = req_str(args, "tag")?;
    if path == ws.body_dir()? || path == ws.html_root() {
        return Err("<body> and <html> cannot be renamed".into());
    }
    let moved = htfl::retag(&path, tag)?;
    Ok(format!("renamed to {}\n", describe(ws, &moved)))
}

fn move_element(ws: &Workspace, args: &Value) -> Result<String, String> {
    ws.require_writable()?;
    let path = ws.resolve(req_str(args, "ref")?)?;
    if path == ws.body_dir()? || path == ws.html_root() {
        return Err("<body> and <html> cannot be moved".into());
    }
    let parent = match opt_str(args, "parent") {
        Some(p) => ws.resolve(p)?,
        None => path
            .parent()
            .ok_or_else(|| "element has no parent".to_string())?
            .to_path_buf(),
    };
    let moved = htfl::move_node(&path, &parent, opt_position(args))?;
    Ok(format!("moved to {}\n", describe(ws, &moved)))
}

fn delete_element(ws: &Workspace, args: &Value) -> Result<String, String> {
    ws.require_writable()?;
    let path = ws.resolve(req_str(args, "ref")?)?;
    if path == ws.body_dir()? || path == ws.html_root() {
        return Err("<body> and <html> cannot be deleted".into());
    }
    let label = describe(ws, &path);
    let removed = htfl::sibling_names(&path).map(|c| c.len()).unwrap_or(0);
    htfl::delete_node(path.to_string_lossy().into_owned())?;
    Ok(format!(
        "deleted {label} and its subtree ({removed} direct child element(s))\n"
    ))
}

fn expand_module(ws: &Workspace, args: &Value) -> Result<String, String> {
    ws.require_writable()?;
    let parent = ws.resolve(req_str(args, "parent")?)?;
    let want = req_str(args, "module")?;
    let root_key = ws.root().to_string_lossy().into_owned();

    let module = htfl::read_modules(root_key.clone())?
        .into_iter()
        .flat_map(|f| f.modules)
        .find(|m| m.name == want)
        .ok_or_else(|| format!("no module named '{want}'"))?;

    // Reserve the slot with a correctly numbered placeholder folder, then
    // restore the module's subtree under that name, so a module lands in the
    // requested position with the same NN_ discipline as any other element.
    let (_, root_tag) = htfl::split_prefix(&module.snapshot.name);
    let placeholder = htfl::insert_child(&parent, root_tag, opt_position(args))?;
    htfl::delete_node(placeholder.to_string_lossy().into_owned())?;
    let mut snapshot = module.snapshot.clone();
    snapshot.name = placeholder
        .file_name()
        .map(|n| n.to_string_lossy().into_owned())
        .unwrap_or(snapshot.name);
    let created = htfl::restore_subtree(parent.to_string_lossy().into_owned(), snapshot)?;

    // Bundled class definitions are appended verbatim (compound selectors like
    // `.drawer.is-open .drawer-panel` must survive) between markers, so
    // expanding the same module again never duplicates its styles.
    let mut css_note = String::from("no bundled CSS");
    if !module.css.trim().is_empty() {
        let target = "99_modules.css";
        let marker = format!("/* >>> module: {} */", module.name);
        let mut content = htfl::read_class_files(root_key.clone())?
            .into_iter()
            .find(|f| f.name == target)
            .map(|f| f.content)
            .unwrap_or_default();
        if content.contains(&marker) {
            css_note = format!("CSS already present in classes/{target}");
        } else {
            if !content.is_empty() && !content.ends_with('\n') {
                content.push('\n');
            }
            content.push_str(&format!(
                "{marker}\n{}\n/* <<< module: {} */\n",
                module.css.trim(),
                module.name
            ));
            htfl::write_class_file(root_key, target.to_string(), content)?;
            css_note = format!("CSS appended to classes/{target}");
        }
    }

    Ok(format!(
        "expanded '{want}' at {} ({css_note})\n",
        describe(ws, Path::new(&created))
    ))
}

fn write_class_file(ws: &Workspace, args: &Value) -> Result<String, String> {
    ws.require_writable()?;
    let file = req_str(args, "file")?;
    let content = req_str(args, "content")?;
    if !file.to_ascii_lowercase().ends_with(".css") {
        return Err("class files must end in .css".into());
    }
    htfl::write_class_file(
        ws.root().to_string_lossy().into_owned(),
        file.to_string(),
        content.to_string(),
    )?;
    Ok(format!("wrote classes/{file} ({} bytes)\n", content.len()))
}

fn update_project(ws: &Workspace, args: &Value) -> Result<String, String> {
    ws.require_writable()?;
    let root_key = ws.root().to_string_lossy().into_owned();
    let mut cfg = htfl::read_project_config(root_key.clone())?;
    let mut changed: Vec<String> = Vec::new();

    if let Some(d) = opt_str(args, "doctype") {
        cfg.doctype = Some(d.to_string());
        changed.push("doctype".into());
    }
    if let Some(m) = opt_str(args, "output_mode") {
        if m != "ssr" && m != "ssr+js" {
            return Err("output_mode must be \"ssr\" or \"ssr+js\"".into());
        }
        cfg.output_mode = Some(m.to_string());
        changed.push("output_mode".into());
    }
    if let Some(b) = args.get("css_reset").and_then(Value::as_bool) {
        cfg.css_reset = Some(b);
        changed.push("css_reset".into());
    }
    if let Some(map) = args.get("variables").and_then(Value::as_object) {
        for (k, v) in map {
            match v {
                Value::Null => {
                    cfg.variables.remove(k);
                }
                _ => {
                    cfg.variables.insert(
                        k.clone(),
                        v.as_str().map(str::to_string).unwrap_or_else(|| v.to_string()),
                    );
                }
            }
        }
        changed.push("variables".into());
    }
    if let Some(head) = args.get("head").and_then(Value::as_object) {
        let h = cfg.head.get_or_insert_with(Default::default);
        let mut set = |key: &str, field: &mut Option<String>| {
            if let Some(v) = head.get(key) {
                *field = v.as_str().map(str::to_string);
                changed.push(format!("head.{key}"));
            }
        };
        set("charset", &mut h.charset);
        set("viewport", &mut h.viewport);
        set("title", &mut h.title);
        set("description", &mut h.description);
        set("og_title", &mut h.og_title);
        set("og_description", &mut h.og_description);
        set("og_image", &mut h.og_image);
        set("favicon", &mut h.favicon);
        set("theme_color", &mut h.theme_color);
    }

    if !changed.is_empty() {
        htfl::write_project_config(root_key, cfg)?;
    }

    // <html lang> lives on the HTML/ node, not in htfl.yaml.
    if let Some(lang) = opt_str(args, "lang") {
        let key = ws.html_root().to_string_lossy().into_owned();
        let mut html_cfg = htfl::read_node(key.clone())?;
        html_cfg.attributes.insert("lang".into(), lang.to_string());
        htfl::write_node(key, html_cfg)?;
        changed.push("lang".into());
    }

    if changed.is_empty() {
        return Ok("nothing to change\n".into());
    }
    Ok(format!("updated project ({})\n", changed.join(", ")))
}

// ---------- build ----------

/// Walk `<body>` and report what the build will silently paper over. These are
/// exactly the mistakes an agent makes that produce a page which "builds fine"
/// and is still wrong.
fn diagnostics(ws: &Workspace) -> Result<Vec<String>, String> {
    let defined = defined_classes(ws)?;
    let mut out = Vec::new();

    for path in ws.line_index()? {
        let line = ws.line_of(&path).unwrap_or(0);
        let cfg = htfl::read_node(path.to_string_lossy().into_owned()).unwrap_or_default();
        let name = path
            .file_name()
            .map(|n| n.to_string_lossy().into_owned())
            .unwrap_or_default();
        let (_, folder_tag) = htfl::split_prefix(&name);
        let wanted = cfg.tag.clone().unwrap_or_else(|| folder_tag.to_string());
        let actual = htfl::resolve_tag(&wanted);

        if actual != wanted.to_ascii_lowercase() {
            out.push(format!(
                "L{line} <{wanted}> is not a known HTML tag — it will render as <{actual}>"
            ));
        }
        for c in &cfg.classes {
            if !defined.contains(c) {
                out.push(format!(
                    "L{line} class \"{c}\" is applied but not defined in classes/"
                ));
            }
        }
        if htfl::VOID_TAGS.contains(&actual.as_str()) {
            if cfg.content.as_deref().map(|c| !c.trim().is_empty()).unwrap_or(false) {
                out.push(format!(
                    "L{line} <{actual}> is a void element — its text content will not be emitted"
                ));
            }
            if !htfl::sibling_names(&path).map(|c| c.is_empty()).unwrap_or(true) {
                out.push(format!(
                    "L{line} <{actual}> is a void element — its child elements will not be emitted"
                ));
            }
        }
        // Attributes seeded empty by the editor are placeholders waiting to be
        // filled in; an agent that forgets leaves a dead link or broken image.
        for key in ["href", "src"] {
            if cfg.attributes.get(key).map(|v| v.trim().is_empty()).unwrap_or(false) {
                out.push(format!("L{line} <{actual}> has an empty {key} attribute"));
            }
        }
    }
    Ok(out)
}

fn build(ws: &Workspace, args: &Value) -> Result<String, String> {
    let html = htfl::generate_html_locked(ws.root(), false)?;
    let elements = ws.line_index()?.len();
    let diags = diagnostics(ws)?;

    let mut out = String::new();
    let _ = writeln!(
        out,
        "build ok — {} bytes, {elements} element(s) under <body>",
        html.len()
    );
    if diags.is_empty() {
        out.push_str("no diagnostics\n");
    } else {
        let _ = writeln!(out, "\n{} diagnostic(s):", diags.len());
        for d in &diags {
            let _ = writeln!(out, "  {d}");
        }
    }
    if args.get("include_html").and_then(Value::as_bool) == Some(true) {
        let _ = write!(out, "\n---\n{html}");
    }
    Ok(out)
}

fn export_html(ws: &Workspace, args: &Value) -> Result<String, String> {
    ws.require_writable()?;
    let dest_arg = req_str(args, "dest")?;
    let dest = ws.resolve_new_file(dest_arg)?;
    htfl::export_html(
        ws.root().to_string_lossy().into_owned(),
        dest.to_string_lossy().into_owned(),
    )?;
    Ok(format!("exported to {dest_arg}\n"))
}

#[cfg(test)]
mod tests {
    use super::*;

    fn scaffold(label: &str) -> std::path::PathBuf {
        let dir = std::env::temp_dir().join(format!(
            "foling_tools_{label}_{}_{}",
            std::process::id(),
            std::time::SystemTime::now()
                .duration_since(std::time::UNIX_EPOCH)
                .unwrap()
                .as_nanos()
        ));
        htfl::init_project(dir.to_string_lossy().into_owned(), None).unwrap();
        dir
    }

    #[test]
    fn every_listed_tool_is_dispatchable() {
        // A tool advertised in tools/list but missing from `call` would only
        // fail once an agent tried it, mid-task.
        let dir = scaffold("dispatch");
        let ws = Workspace::open(&dir, false).unwrap();
        for tool in list() {
            let err = call(&ws, tool.name, &json!({}))
                .err()
                .unwrap_or_default();
            assert!(
                !err.starts_with("unknown tool"),
                "{} is listed but not dispatched",
                tool.name
            );
        }
        let _ = std::fs::remove_dir_all(&dir);
    }

    #[test]
    fn insert_then_read_back_round_trips() {
        let dir = scaffold("insert");
        let ws = Workspace::open(&dir, false).unwrap();
        let msg = call(
            &ws,
            "htfl_insert_element",
            &json!({
                "parent": "02_body",
                "tag": "section",
                "content": "Hello",
                "classes": ["hero"],
                "css": "padding: 2rem;"
            }),
        )
        .unwrap();
        assert!(msg.contains("L2"), "reports the new line number: {msg}");

        let el = call(&ws, "htfl_get_element", &json!({ "ref": "L2" })).unwrap();
        assert!(el.contains("tag: section"));
        assert!(el.contains("Hello"));
        assert!(el.contains("hero"));

        let tree = call(&ws, "htfl_get_tree", &json!({})).unwrap();
        assert!(tree.contains("section .hero"), "tree row: {tree}");
        assert!(tree.contains("~css"));
        let _ = std::fs::remove_dir_all(&dir);
    }

    #[test]
    fn update_merges_attributes_and_clears_with_null() {
        let dir = scaffold("update");
        let ws = Workspace::open(&dir, false).unwrap();
        call(&ws, "htfl_insert_element", &json!({ "parent": "02_body", "tag": "a" })).unwrap();

        call(
            &ws,
            "htfl_update_element",
            &json!({ "ref": "L2", "attributes": { "href": "/about", "title": "About" }, "content": "About us" }),
        )
        .unwrap();
        let el = call(&ws, "htfl_get_element", &json!({ "ref": "L2" })).unwrap();
        assert!(el.contains("/about") && el.contains("About us"));

        call(
            &ws,
            "htfl_update_element",
            &json!({ "ref": "L2", "attributes": { "title": null }, "content": null }),
        )
        .unwrap();
        let el = call(&ws, "htfl_get_element", &json!({ "ref": "L2" })).unwrap();
        assert!(!el.contains("About us"), "content cleared: {el}");
        assert!(!el.contains("title:"), "attribute removed: {el}");
        assert!(el.contains("/about"), "untouched attribute survived: {el}");
        let _ = std::fs::remove_dir_all(&dir);
    }

    #[test]
    fn build_reports_unknown_tags_and_undefined_classes() {
        let dir = scaffold("diag");
        let ws = Workspace::open(&dir, false).unwrap();
        call(
            &ws,
            "htfl_insert_element",
            &json!({ "parent": "02_body", "tag": "notatag", "classes": ["nowhere"] }),
        )
        .unwrap();
        let out = call(&ws, "htfl_build", &json!({})).unwrap();
        assert!(out.contains("build ok"));
        assert!(out.contains("not a known HTML tag"), "{out}");
        assert!(out.contains("not defined in classes/"), "{out}");
        let _ = std::fs::remove_dir_all(&dir);
    }

    #[test]
    fn body_cannot_be_deleted() {
        let dir = scaffold("guard");
        let ws = Workspace::open(&dir, false).unwrap();
        assert!(call(&ws, "htfl_delete_element", &json!({ "ref": "L1" })).is_err());
        let _ = std::fs::remove_dir_all(&dir);
    }

    #[test]
    fn read_only_session_blocks_writes_but_allows_reads() {
        let dir = scaffold("ro");
        let ws = Workspace::open(&dir, true).unwrap();
        assert!(call(&ws, "htfl_get_tree", &json!({})).is_ok());
        assert!(
            call(&ws, "htfl_insert_element", &json!({ "parent": "02_body", "tag": "div" }))
                .is_err()
        );
        let _ = std::fs::remove_dir_all(&dir);
    }

    #[test]
    fn selector_scan_ignores_decimals_and_comments() {
        let mut out = HashSet::new();
        collect_selectors(
            "/* 01_foundation.css — base */\n.card { padding: 0.5rem; margin: 1.25em; }",
            &mut out,
        );
        assert!(out.contains("card"));
        assert!(!out.contains("5rem"), "decimals are not class names: {out:?}");
        assert!(
            !out.contains("css"),
            "a filename in a comment is not a class: {out:?}"
        );
    }
}
