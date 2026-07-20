// SPDX-License-Identifier: AGPL-3.0-or-later
// Copyright (C) 2026 大松雄斗

//! Encode an existing .html document into an HTFL folder tree.

use std::fs;
use std::path::{Path, PathBuf};

use super::*;

// ---------- HTML import (encode .html → HTFL folders) ----------

pub fn inline_style_to_lines(style: &str) -> String {
    style
        .split(';')
        .map(|d| d.trim())
        .filter(|d| !d.is_empty())
        .map(|d| format!("{};", d))
        .collect::<Vec<_>>()
        .join("\n")
}

pub fn apply_attrs(el: &scraper::node::Element, cfg: &mut NodeConfig) {
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

pub fn write_imported_element(
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
pub fn import_html(html_path: String, dest_root: String) -> Result<String, String> {
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