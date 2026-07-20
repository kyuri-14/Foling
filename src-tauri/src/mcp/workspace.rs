// SPDX-License-Identifier: AGPL-3.0-or-later
// Copyright (C) 2026 大松雄斗

//! The project boundary an MCP session is confined to, and the addressing
//! scheme agents use to name elements.
//!
//! Two things happen here, and both are load-bearing.
//!
//! **Scoping.** A session is opened against one project root. Every reference
//! an agent supplies is resolved *relative* to that root and then verified to
//! still be inside it after canonicalization, so neither `..` nor a symlink can
//! walk out. Absolute paths are never accepted and never returned — which, as a
//! bonus on this author's machine, keeps a CP932 console from ever having to
//! render a UTF-8 path containing Japanese characters.
//!
//! **Addressing.** An element can be named two ways:
//!
//!   * `L12` — its line number in the editor, which is also the `id` the build
//!     emits. `<body>` is line 1 and numbering walks its subtree in preorder.
//!     This is what an agent sees in `htfl_get_tree` output and what a user
//!     sees on screen, so the two can talk about the same element.
//!   * `02_body/01_header` — a path relative to `HTML/`. Stable across edits
//!     elsewhere in the tree, where a line number is not.
//!
//! Every tool accepts both and every tool reports both.

use std::path::{Component, Path, PathBuf};

use crate::htfl;

pub struct Workspace {
    root: PathBuf,
    read_only: bool,
}

impl Workspace {
    /// Open `root` as the session's project. Fails if it is not a directory or
    /// has no `HTML/` tree — better to refuse than to scaffold a project
    /// somewhere the user did not intend.
    pub fn open(root: &Path, read_only: bool) -> Result<Self, String> {
        let canon = root
            .canonicalize()
            .map_err(|e| format!("project root not found: {} ({e})", root.display()))?;
        if !canon.is_dir() {
            return Err(format!("project root is not a directory: {}", root.display()));
        }
        if !canon.join(htfl::HTML_ROOT).is_dir() {
            return Err(format!(
                "not an HTFL project (no {}/ directory): {}",
                htfl::HTML_ROOT,
                root.display()
            ));
        }
        htfl::set_lock_scope(Some(&canon));
        Ok(Self {
            root: canon,
            read_only,
        })
    }

    pub fn root(&self) -> &Path {
        &self.root
    }

    pub fn read_only(&self) -> bool {
        self.read_only
    }

    /// Reject a mutation early, with a message that says why rather than
    /// letting it fail later as a confusing filesystem error.
    pub fn require_writable(&self) -> Result<(), String> {
        if self.read_only {
            return Err("this Foling MCP session is read-only".into());
        }
        Ok(())
    }

    pub fn html_root(&self) -> PathBuf {
        self.root.join(htfl::HTML_ROOT)
    }

    /// The `<body>` element's folder — where line numbering starts.
    pub fn body_dir(&self) -> Result<PathBuf, String> {
        let html = self.html_root();
        for name in htfl::sibling_names(&html).map_err(|e| e.to_string())? {
            let (_, tag) = htfl::split_prefix(&name);
            if tag.eq_ignore_ascii_case("body") {
                return Ok(html.join(name));
            }
        }
        Err("no <body> element in this project".into())
    }

    /// Elements in line order: index 0 is `<body>` (line 1), then its subtree
    /// in preorder — the same walk the builder numbers `id` with.
    pub fn line_index(&self) -> Result<Vec<PathBuf>, String> {
        fn walk(dir: &Path, out: &mut Vec<PathBuf>) -> Result<(), String> {
            out.push(dir.to_path_buf());
            for name in htfl::sibling_names(dir).map_err(|e| e.to_string())? {
                walk(&dir.join(name), out)?;
            }
            Ok(())
        }
        let mut out = Vec::new();
        walk(&self.body_dir()?, &mut out)?;
        Ok(out)
    }

    /// Resolve an agent-supplied reference to an on-disk directory.
    pub fn resolve(&self, reference: &str) -> Result<PathBuf, String> {
        let r = reference.trim();
        if let Some(line) = parse_line_ref(r) {
            let index = self.line_index()?;
            let path = index
                .get(line.saturating_sub(1) as usize)
                .ok_or_else(|| {
                    format!("no element at line {line} (the tree has {} lines)", index.len())
                })?;
            return Ok(path.clone());
        }
        let path = self.resolve_relative(r)?;
        if !path.is_dir() {
            return Err(format!("no element at '{}'", self.display_ref(&path)));
        }
        Ok(path)
    }

    /// Path-form reference → absolute path, confined to `HTML/`.
    fn resolve_relative(&self, reference: &str) -> Result<PathBuf, String> {
        let html = self.html_root();
        let cleaned = reference.replace('\\', "/");
        let cleaned = cleaned.trim_matches('/');
        // Accept both "02_body/…" and a fully qualified "HTML/02_body/…".
        let cleaned = cleaned
            .strip_prefix(&format!("{}/", htfl::HTML_ROOT))
            .unwrap_or(cleaned);
        if cleaned.is_empty() || cleaned == htfl::HTML_ROOT {
            return Ok(html);
        }

        let mut path = html.clone();
        for seg in cleaned.split('/') {
            if seg.is_empty() || seg == "." || seg == ".." || seg.contains(':') {
                return Err(format!("invalid element reference: '{reference}'"));
            }
            path.push(seg);
        }
        // Canonicalize before trusting it: a junction or symlink inside the
        // project could otherwise point anywhere on disk.
        let canon = path
            .canonicalize()
            .map_err(|_| format!("no element at '{reference}'"))?;
        let html_canon = html.canonicalize().map_err(|e| e.to_string())?;
        if !canon.starts_with(&html_canon) {
            return Err(format!("reference escapes the project: '{reference}'"));
        }
        Ok(canon)
    }

    /// Resolve a *destination* path (which need not exist yet) inside the
    /// project root. Used by export, where the file is about to be created.
    pub fn resolve_new_file(&self, reference: &str) -> Result<PathBuf, String> {
        let cleaned = reference.replace('\\', "/");
        let cleaned = cleaned.trim_matches('/');
        if cleaned.is_empty() {
            return Err("empty destination path".into());
        }
        let mut path = self.root.clone();
        for seg in cleaned.split('/') {
            if seg.is_empty() || seg == "." || seg == ".." || seg.contains(':') {
                return Err(format!("invalid destination path: '{reference}'"));
            }
            path.push(seg);
        }
        // The parent must exist and be inside the project; the leaf need not.
        let parent = path
            .parent()
            .ok_or_else(|| format!("invalid destination path: '{reference}'"))?;
        let parent_canon = parent
            .canonicalize()
            .map_err(|_| format!("destination folder does not exist: '{reference}'"))?;
        if !parent_canon.starts_with(&self.root) {
            return Err(format!("destination escapes the project: '{reference}'"));
        }
        Ok(parent_canon.join(path.file_name().unwrap_or_default()))
    }

    /// Path-form reference for `path`, relative to `HTML/`. `<html>` itself
    /// renders as `HTML`.
    pub fn display_ref(&self, path: &Path) -> String {
        let html = self.html_root();
        match path.strip_prefix(&html) {
            Ok(rel) if rel.as_os_str().is_empty() => htfl::HTML_ROOT.to_string(),
            Ok(rel) => rel
                .components()
                .filter_map(|c| match c {
                    Component::Normal(s) => Some(s.to_string_lossy().into_owned()),
                    _ => None,
                })
                .collect::<Vec<_>>()
                .join("/"),
            // Outside HTML/ — should not happen for resolved refs, but never
            // leak an absolute path if it does.
            Err(_) => path
                .file_name()
                .map(|n| n.to_string_lossy().into_owned())
                .unwrap_or_default(),
        }
    }

    /// Line number for `path`, if it is inside `<body>`.
    pub fn line_of(&self, path: &Path) -> Option<u32> {
        let index = self.line_index().ok()?;
        index
            .iter()
            .position(|p| p == path)
            .map(|i| (i + 1) as u32)
    }

    /// The tag an element resolves to, from its folder name (`03_a` → `a`)
    /// unless `config.yaml` overrides it.
    pub fn tag_of(&self, path: &Path) -> String {
        let name = path
            .file_name()
            .map(|n| n.to_string_lossy().into_owned())
            .unwrap_or_default();
        let (_, folder_tag) = htfl::split_prefix(&name);
        htfl::read_node(path.to_string_lossy().into_owned())
            .ok()
            .and_then(|c| c.tag)
            .unwrap_or_else(|| folder_tag.to_string())
    }
}

/// `L12` / `l12` / `12` → 12. Anything else is a path-form reference.
fn parse_line_ref(r: &str) -> Option<u32> {
    let digits = r.strip_prefix(['L', 'l']).unwrap_or(r);
    if digits.is_empty() || !digits.bytes().all(|b| b.is_ascii_digit()) {
        return None;
    }
    digits.parse::<u32>().ok().filter(|n| *n > 0)
}

#[cfg(test)]
mod tests {
    use super::*;

    fn scaffold(label: &str) -> PathBuf {
        let dir = std::env::temp_dir().join(format!(
            "foling_ws_{label}_{}_{}",
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
    fn line_refs_and_path_refs_name_the_same_element() {
        let dir = scaffold("refs");
        let ws = Workspace::open(&dir, false).unwrap();
        let body = ws.body_dir().unwrap();
        let header = htfl::insert_child(&body, "header", None).unwrap();

        // body is line 1, its first child line 2.
        assert_eq!(ws.resolve("L2").unwrap(), header);
        assert_eq!(ws.resolve("02_body/01_header").unwrap(), header);
        assert_eq!(ws.resolve("HTML/02_body/01_header").unwrap(), header);
        assert_eq!(ws.display_ref(&header), "02_body/01_header");
        assert_eq!(ws.line_of(&header), Some(2));

        let _ = std::fs::remove_dir_all(&dir);
    }

    #[test]
    fn preorder_matches_the_builders_id_numbering() {
        let dir = scaffold("order");
        let ws = Workspace::open(&dir, false).unwrap();
        let body = ws.body_dir().unwrap();
        let header = htfl::insert_child(&body, "header", None).unwrap();
        htfl::insert_child(&header, "nav", None).unwrap();
        htfl::insert_child(&body, "main", None).unwrap();

        // body(1) → header(2) → nav(3) → main(4): depth-first, not breadth.
        let refs: Vec<String> = ws
            .line_index()
            .unwrap()
            .iter()
            .map(|p| ws.display_ref(p))
            .collect();
        assert_eq!(
            refs,
            vec![
                "02_body",
                "02_body/01_header",
                "02_body/01_header/01_nav",
                "02_body/02_main",
            ]
        );
        let _ = std::fs::remove_dir_all(&dir);
    }

    #[test]
    fn references_cannot_escape_the_project() {
        let dir = scaffold("escape");
        let ws = Workspace::open(&dir, false).unwrap();
        for bad in ["../..", "02_body/../../../etc", "C:/Windows", "/etc/passwd"] {
            assert!(ws.resolve(bad).is_err(), "{bad} must be rejected");
        }
        let _ = std::fs::remove_dir_all(&dir);
    }

    #[test]
    fn read_only_sessions_refuse_mutations() {
        let dir = scaffold("ro");
        let ws = Workspace::open(&dir, true).unwrap();
        assert!(ws.require_writable().is_err());
        let _ = std::fs::remove_dir_all(&dir);
    }
}
