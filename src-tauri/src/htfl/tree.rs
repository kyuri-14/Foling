// SPDX-License-Identifier: AGPL-3.0-or-later
// Copyright (C) 2026 大松雄斗

//! Folder tree: `NN_tag` naming, ordering and enumeration.

use std::fs;
use std::path::{Path, PathBuf};

use super::*;

/// Strip everything a folder name may not contain. Mirrors the editor's
/// `sanitizeTagForFolder` so a tag typed in the tree and a tag requested over
/// MCP land on byte-identical folder names.
pub fn sanitize_tag(t: &str) -> String {
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

pub fn split_prefix(name: &str) -> (Option<u32>, &str) {
    if let Some((prefix, rest)) = name.split_once('_') {
        if let Ok(n) = prefix.parse::<u32>() {
            return (Some(n), rest);
        }
    }
    (None, name)
}
pub fn build_tree(path: &Path) -> std::io::Result<TreeNode> {
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
pub fn read_tree(project_root: String) -> Result<TreeNode, String> {
    let _fs_guard = super::lock::fs_guard();
    let root = PathBuf::from(&project_root);
    let html_root = root.join(HTML_ROOT);
    if !html_root.exists() {
        fs::create_dir_all(&html_root).map_err(|e| e.to_string())?;
    }
    build_tree(&html_root).map_err(|e| e.to_string())
}

// ---------- `NN_tag` numbering ----------
//
// Until now this lived only in the frontend (`rowsToParsedTree` in
// treeModel.ts), which was fine while the editor was the sole writer. The MCP
// server is a second writer, so the rule moves here and both callers share it:
//
//   • a new child appended to a parent takes `max(sibling NN) + 1`;
//   • an insert in the middle shifts only the siblings *after* it, walking
//     backwards so no two folders ever want the same name mid-rename. Mass
//     renumbering is deliberately avoided — on Windows every extra rename is
//     another chance for Explorer / AV / the search indexer to answer with
//     ERROR_ACCESS_DENIED;
//   • deletes leave gaps. Ordering is by NN, so a gap is harmless and costs
//     zero renames.

/// Folder name for ordinal `nn` and `tag`, e.g. `(3, "section")` → `03_section`.
pub fn folder_name(nn: u32, tag: &str) -> String {
    format!("{:02}_{}", nn, sanitize_tag(tag))
}

/// Child folder names of `parent`, in the order the builder will emit them.
pub fn sibling_names(parent: &Path) -> std::io::Result<Vec<String>> {
    let mut entries: Vec<(Option<u32>, String)> = Vec::new();
    if parent.is_dir() {
        for entry in fs::read_dir(parent)? {
            let entry = entry?;
            if entry.path().is_dir() {
                let name = entry.file_name().to_string_lossy().into_owned();
                let (nn, _) = split_prefix(&name);
                entries.push((nn, name));
            }
        }
    }
    entries.sort_by(|a, b| match (a.0, b.0) {
        (Some(x), Some(y)) => x.cmp(&y).then_with(|| a.1.cmp(&b.1)),
        (Some(_), None) => std::cmp::Ordering::Less,
        (None, Some(_)) => std::cmp::Ordering::Greater,
        (None, None) => a.1.cmp(&b.1),
    });
    Ok(entries.into_iter().map(|(_, n)| n).collect())
}

/// The ordinal an appended child should take: one past the highest in use.
pub fn next_nn(parent: &Path) -> std::io::Result<u32> {
    let mut max = 0u32;
    for name in sibling_names(parent)? {
        if let (Some(n), _) = split_prefix(&name) {
            if n > max {
                max = n;
            }
        }
    }
    Ok(max + 1)
}

/// Bump every sibling from `from_index` onwards by one ordinal, so `from_index`
/// is left free for a new element. Returns the ordinal that was vacated.
///
/// Renames run last-to-first: `03 → 04` happens before `02 → 03`, so the
/// destination name is always unoccupied. Unnumbered folders (no `NN_` prefix)
/// sort after everything and are never touched.
fn shift_siblings_down(parent: &Path, from_index: usize) -> Result<Option<u32>, String> {
    let names = sibling_names(parent).map_err(|e| e.to_string())?;
    let vacated = match names.get(from_index) {
        Some(n) => match split_prefix(n).0 {
            Some(nn) => nn,
            // The element at this position has no ordinal, so there is nothing
            // meaningful to insert "before". Caller falls back to appending.
            None => return Ok(None),
        },
        None => return Ok(None),
    };
    for name in names[from_index..].iter().rev() {
        let (nn, tag) = split_prefix(name);
        let Some(nn) = nn else { continue };
        let dest = parent.join(folder_name(nn + 1, tag));
        retry_io(|| fs::rename(parent.join(name), &dest)).map_err(|e| {
            format!("並び順の更新に失敗しました ({name}): {e}")
        })?;
    }
    Ok(Some(vacated))
}

/// Create a child element folder under `parent`, seeded with the defaults for
/// its tag. `position` is a 0-based index among the existing siblings; `None`
/// (or an index past the end) appends. Returns the created folder path.
pub fn insert_child(
    parent: &Path,
    tag: &str,
    position: Option<usize>,
) -> Result<PathBuf, String> {
    let _fs_guard = super::lock::fs_guard();
    if !parent.is_dir() {
        return Err(format!("親要素が見つかりません: {}", parent.display()));
    }
    let count = sibling_names(parent).map_err(|e| e.to_string())?.len();
    let nn = match position.filter(|i| *i < count) {
        Some(i) => shift_siblings_down(parent, i)?,
        None => None,
    };
    let nn = match nn {
        Some(n) => n,
        None => next_nn(parent).map_err(|e| e.to_string())?,
    };

    let dir = parent.join(folder_name(nn, tag));
    if dir.exists() {
        return Err(format!("既に存在します: {}", dir.display()));
    }
    retry_io(|| fs::create_dir_all(&dir)).map_err(|e| e.to_string())?;
    let sanitized = sanitize_tag(tag);
    let (_, tag_part) = split_prefix(&sanitized);
    write_yaml(&dir.join(CONFIG_FILE), &default_config_for_tag(tag_part))?;
    Ok(dir)
}

/// Change an element's tag while keeping its ordinal, its config and its
/// children. Returns the new folder path (unchanged if the tag already matched).
pub fn retag(node: &Path, new_tag: &str) -> Result<PathBuf, String> {
    let _fs_guard = super::lock::fs_guard();
    let name = node
        .file_name()
        .map(|n| n.to_string_lossy().into_owned())
        .ok_or_else(|| "要素のパスが不正です".to_string())?;
    let parent = node
        .parent()
        .ok_or_else(|| "親フォルダが見つかりません".to_string())?;
    let (nn, _) = split_prefix(&name);
    let new_name = match nn {
        Some(n) => folder_name(n, new_tag),
        // Unnumbered folders keep being unnumbered; only the tag changes.
        None => sanitize_tag(new_tag),
    };
    if new_name == name {
        return Ok(node.to_path_buf());
    }
    let dest = parent.join(&new_name);
    if dest.exists() {
        return Err(format!("既に存在します: {}", dest.display()));
    }
    retry_io(|| fs::rename(node, &dest)).map_err(|e| e.to_string())?;
    Ok(dest)
}

/// Move an element under `new_parent` at `position` (0-based; `None` appends),
/// keeping its tag, config and subtree. Moving within the same parent reorders.
pub fn move_node(
    node: &Path,
    new_parent: &Path,
    position: Option<usize>,
) -> Result<PathBuf, String> {
    let _fs_guard = super::lock::fs_guard();
    if !new_parent.is_dir() {
        return Err(format!("移動先が見つかりません: {}", new_parent.display()));
    }
    // Refuse to move an element inside its own subtree — that would orphan it.
    let canon_node = node.canonicalize().map_err(|e| e.to_string())?;
    let canon_dest = new_parent.canonicalize().map_err(|e| e.to_string())?;
    if canon_dest.starts_with(&canon_node) {
        return Err("要素を自分自身の内側へは移動できません".into());
    }

    let name = node
        .file_name()
        .map(|n| n.to_string_lossy().into_owned())
        .ok_or_else(|| "要素のパスが不正です".to_string())?;
    let (_, tag) = split_prefix(&name);
    let tag = tag.to_string();

    let names = sibling_names(new_parent).map_err(|e| e.to_string())?;
    let count = names.len();

    // Reordering within one parent: the element vacates its own slot as it
    // moves, so a *downward* move has to aim one slot further than the caller
    // asked for. Without this, "put it third" lands it second. Moving upward
    // needs no adjustment — the slots below it have not shifted yet.
    let same_parent = canon_node.parent() == Some(canon_dest.as_path());
    let current_index = names.iter().position(|n| *n == name);
    let position = match (same_parent, current_index, position) {
        (true, Some(from), Some(to)) if from < to => Some(to + 1),
        _ => position,
    };

    // Vacate the destination slot first; the source still occupies its own, so
    // an in-parent reorder must re-read siblings afterwards.
    let nn = match position.filter(|i| *i < count) {
        Some(i) => shift_siblings_down(new_parent, i)?,
        None => None,
    };
    let nn = match nn {
        Some(n) => n,
        None => next_nn(new_parent).map_err(|e| e.to_string())?,
    };

    // The shift above may have renamed the node itself (same-parent reorder).
    let src = if node.exists() {
        node.to_path_buf()
    } else {
        let (old_nn, _) = split_prefix(&name);
        let bumped = old_nn
            .map(|n| new_parent.join(folder_name(n + 1, &tag)))
            .filter(|p| p.exists())
            .ok_or_else(|| format!("移動元が見つかりません: {}", node.display()))?;
        bumped
    };

    let dest = new_parent.join(folder_name(nn, &tag));
    if dest == src {
        return Ok(dest);
    }
    if dest.exists() {
        return Err(format!("既に存在します: {}", dest.display()));
    }
    retry_io(|| fs::rename(&src, &dest)).map_err(|e| e.to_string())?;
    Ok(dest)
}

#[cfg(test)]
mod tests {
    use super::*;

    fn temp_parent(label: &str) -> PathBuf {
        let dir = std::env::temp_dir().join(format!(
            "foling_nn_{label}_{}_{}",
            std::process::id(),
            std::time::SystemTime::now()
                .duration_since(std::time::UNIX_EPOCH)
                .unwrap()
                .as_nanos()
        ));
        fs::create_dir_all(&dir).unwrap();
        dir
    }

    #[test]
    fn folder_name_zero_pads_and_sanitizes() {
        assert_eq!(folder_name(3, "section"), "03_section");
        assert_eq!(folder_name(12, "div"), "12_div");
        // Matches the editor: illegal characters are dropped, not rejected.
        assert_eq!(folder_name(1, "my widget!"), "01_mywidget");
        assert_eq!(folder_name(1, "日本語"), "01_tag");
    }

    #[test]
    fn append_takes_max_plus_one_even_with_gaps() {
        let p = temp_parent("append");
        for n in ["01_header", "05_main"] {
            fs::create_dir_all(p.join(n)).unwrap();
        }
        let created = insert_child(&p, "footer", None).unwrap();
        assert_eq!(created.file_name().unwrap(), "06_footer");
        let _ = fs::remove_dir_all(&p);
    }

    #[test]
    fn insert_in_middle_shifts_only_following_siblings() {
        let p = temp_parent("insert");
        for n in ["01_header", "02_main", "03_footer"] {
            fs::create_dir_all(p.join(n)).unwrap();
        }
        // Insert at index 1 → takes 02, pushing main/footer to 03/04.
        let created = insert_child(&p, "nav", Some(1)).unwrap();
        assert_eq!(created.file_name().unwrap(), "02_nav");
        assert_eq!(
            sibling_names(&p).unwrap(),
            vec!["01_header", "02_nav", "03_main", "04_footer"]
        );
        let _ = fs::remove_dir_all(&p);
    }

    #[test]
    fn retag_keeps_ordinal_and_subtree() {
        let p = temp_parent("retag");
        let node = p.join("02_div");
        fs::create_dir_all(node.join("01_span")).unwrap();
        let moved = retag(&node, "section").unwrap();
        assert_eq!(moved.file_name().unwrap(), "02_section");
        assert!(moved.join("01_span").is_dir(), "children came along");
        let _ = fs::remove_dir_all(&p);
    }

    #[test]
    fn move_between_parents_appends() {
        let p = temp_parent("move");
        let a = p.join("01_header");
        let b = p.join("02_main");
        fs::create_dir_all(a.join("01_nav")).unwrap();
        fs::create_dir_all(b.join("01_p")).unwrap();
        let moved = move_node(&a.join("01_nav"), &b, None).unwrap();
        assert_eq!(moved.file_name().unwrap(), "02_nav");
        assert!(!a.join("01_nav").exists(), "source is gone");
        let _ = fs::remove_dir_all(&p);
    }

    /// Tag names in sibling order — what the user actually sees in the tree.
    fn order(parent: &Path) -> Vec<String> {
        sibling_names(parent)
            .unwrap()
            .iter()
            .map(|n| split_prefix(n).1.to_string())
            .collect()
    }

    #[test]
    fn reorder_within_a_parent_lands_on_the_requested_position() {
        let p = temp_parent("reorder");
        for n in ["01_aside", "02_header", "03_article", "04_footer"] {
            fs::create_dir_all(p.join(n)).unwrap();
        }
        // "Make aside the 3rd child" (0-based index 2). Moving downward, the
        // element vacates its own slot on the way — the naive implementation
        // lands it 2nd.
        let moved = move_node(&p.join("01_aside"), &p, Some(2)).unwrap();
        assert_eq!(order(&p), vec!["header", "article", "aside", "footer"]);
        assert_eq!(split_prefix(moved.file_name().unwrap().to_str().unwrap()).1, "aside");

        // Moving back up to 1st needs no such adjustment.
        move_node(&moved, &p, Some(0)).unwrap();
        assert_eq!(order(&p), vec!["aside", "header", "article", "footer"]);
        let _ = fs::remove_dir_all(&p);
    }

    #[test]
    fn reorder_to_the_end_appends() {
        let p = temp_parent("reorder_end");
        for n in ["01_aside", "02_header", "03_article"] {
            fs::create_dir_all(p.join(n)).unwrap();
        }
        move_node(&p.join("01_aside"), &p, None).unwrap();
        assert_eq!(order(&p), vec!["header", "article", "aside"]);
        let _ = fs::remove_dir_all(&p);
    }

    #[test]
    fn move_into_own_subtree_is_refused() {
        let p = temp_parent("cycle");
        let outer = p.join("01_div");
        let inner = outer.join("01_span");
        fs::create_dir_all(&inner).unwrap();
        assert!(move_node(&outer, &inner, None).is_err());
        let _ = fs::remove_dir_all(&p);
    }
}