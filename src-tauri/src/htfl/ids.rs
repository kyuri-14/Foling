// SPDX-License-Identifier: AGPL-3.0-or-later
// Copyright (C) 2026 大松雄斗

//! Fixed element ids.
//!
//! Every element inside `<body>` carries an id of the form `e17` in its
//! `config.yaml` (`auto_id`). It is assigned once — when the element is
//! created, or the first time Foling reads a folder that has none — and is
//! never changed or reused afterwards. The counter lives in `htfl.yaml`
//! (`next_auto_id`) and only grows.
//!
//! This replaces numbering elements by their line in the editor. A line number
//! shifts with every insert, so an id that *was* a line number broke anchors
//! and any reference held across an edit, and it overwrote ids the user had
//! chosen. A fixed id is stable, and an id the user sets now always wins in
//! the output.
//!
//! The ids start with a letter on purpose: `#12` is not a valid CSS selector
//! and `querySelector("#12")` throws, while `#e12` works everywhere.

use std::collections::HashMap;
use std::fs;
use std::path::{Component, Path, PathBuf};

use super::*;

/// `17` → `"e17"`.
pub fn format_auto_id(n: u32) -> String {
    format!("e{n}")
}

/// `"e17"` (or `"E17"`) → `17`. Anything else is not a fixed id.
pub fn parse_auto_id(s: &str) -> Option<u32> {
    let rest = s.strip_prefix(['e', 'E'])?;
    if rest.is_empty() || !rest.bytes().all(|b| b.is_ascii_digit()) {
        return None;
    }
    rest.parse::<u32>().ok().filter(|n| *n > 0)
}

/// The project a path belongs to: the nearest ancestor holding `htfl.yaml`
/// and the `HTML/` folder the path lies in.
pub fn project_root_of(path: &Path) -> Option<PathBuf> {
    let mut cur = Some(path);
    while let Some(p) = cur {
        let html = p.join(HTML_ROOT);
        if path.starts_with(&html) && html.is_dir() && p.join(PROJECT_FILE).is_file() {
            return Some(p.to_path_buf());
        }
        cur = p.parent();
    }
    None
}

/// Whether `node` is `<body>` or lies inside it — the elements that carry
/// fixed ids. `<head>` content and `<html>` itself do not.
pub fn is_in_body(root: &Path, node: &Path) -> bool {
    let Ok(rel) = node.strip_prefix(root.join(HTML_ROOT)) else {
        return false;
    };
    match rel.components().next() {
        Some(Component::Normal(first)) => split_prefix(&first.to_string_lossy())
            .1
            .eq_ignore_ascii_case("body"),
        _ => false,
    }
}

/// Reserve `count` consecutive ids and return the first, never below
/// `at_least`. The caller holds the filesystem lock.
fn reserve(root: &Path, count: u32, at_least: u32) -> Result<u32, String> {
    let mut cfg = read_project_config(root.to_string_lossy().into_owned())?;
    let counter = match cfg.next_auto_id {
        Some(n) if n > 0 => n,
        // No counter yet (a project from before fixed ids, or htfl.yaml was
        // rewritten by hand): start past every id already on disk so none is
        // handed out twice.
        _ => highest_id_on_disk(root) + 1,
    };
    let first = counter.max(at_least).max(1);
    cfg.next_auto_id = Some(first + count);
    // htfl.yaml is hand-edited too (variables, with comments): change the one
    // line rather than re-serializing the file on every element created.
    let path = root.join(PROJECT_FILE);
    let text = fs::read_to_string(&path).unwrap_or_default();
    let value = (first + count).to_string();
    match patch_key_line::<ProjectConfig>(&text, "next_auto_id", &value, &cfg) {
        Some(patched) => retry_io(|| fs::write(&path, &patched)).map_err(|e| e.to_string())?,
        None => write_yaml(&path, &cfg)?,
    }
    Ok(first)
}

/// Set the top-level line `key: value` in YAML `text` — replacing it when
/// present, appending it otherwise — and keep everything else byte for byte.
/// Returns the new text only if it parses back to exactly `want`; `None`
/// means the text could not be patched safely and the caller should write the
/// file normally.
fn patch_key_line<T>(text: &str, key: &str, value: &str, want: &T) -> Option<String>
where
    T: serde::Serialize + serde::de::DeserializeOwned,
{
    let prefix = format!("{key}:");
    let line = format!("{key}: {value}");
    let mut out = String::with_capacity(text.len() + line.len() + 1);
    let mut replaced = false;
    for l in text.split_inclusive('\n') {
        if !replaced && l.starts_with(&prefix) {
            out.push_str(&line);
            if l.ends_with('\n') {
                out.push('\n');
            }
            replaced = true;
        } else {
            out.push_str(l);
        }
    }
    if !replaced {
        if !out.is_empty() && !out.ends_with('\n') {
            out.push('\n');
        }
        out.push_str(&line);
        out.push('\n');
    }
    let expected = serde_json::to_value(want).ok()?;
    let parsed: T = serde_yml::from_str(&out).ok()?;
    (serde_json::to_value(&parsed).ok()? == expected).then_some(out)
}

fn highest_id_on_disk(root: &Path) -> u32 {
    fn walk(dir: &Path, max: &mut u32) {
        if let Ok(cfg) = read_node_config(dir) {
            if let Some(n) = cfg.auto_id.as_deref().and_then(parse_auto_id) {
                *max = (*max).max(n);
            }
        }
        if let Ok(names) = sibling_names(dir) {
            for name in names {
                walk(&dir.join(name), max);
            }
        }
    }
    let mut max = 0;
    walk(&root.join(HTML_ROOT), &mut max);
    max
}

/// A new fixed id for an element about to be created at `dir`, or `None` when
/// it lies outside `<body>` or outside any project (bare folders in tests).
/// Failing to reserve one never blocks creating the element: the next read of
/// the tree fills the gap. The caller holds the filesystem lock.
pub fn fresh_id_for(dir: &Path) -> Option<String> {
    let root = project_root_of(dir)?;
    if !is_in_body(&root, dir) {
        return None;
    }
    reserve(&root, 1, 1).ok().map(format_auto_id)
}

/// Give every element of a snapshot about to be restored under `parent` a new
/// fixed id — what pasting a copy or expanding a module needs, since the copy
/// is a different element from its source. Outside `<body>` the ids are
/// dropped. The caller holds the filesystem lock.
pub fn refresh_snapshot_ids(parent: &Path, snap: &mut NodeSnapshot) {
    fn count(s: &NodeSnapshot) -> u32 {
        1 + s.children.iter().map(count).sum::<u32>()
    }
    fn clear(s: &mut NodeSnapshot) {
        s.config.auto_id = None;
        for c in &mut s.children {
            clear(c);
        }
    }
    fn assign(s: &mut NodeSnapshot, next: &mut u32) {
        s.config.auto_id = Some(format_auto_id(*next));
        *next += 1;
        for c in &mut s.children {
            assign(c, next);
        }
    }
    clear(snap);
    let Some(root) = project_root_of(parent) else {
        return;
    };
    if !is_in_body(&root, &parent.join(&snap.name)) {
        return;
    }
    if let Ok(mut next) = reserve(&root, count(snap), 1) {
        assign(snap, &mut next);
    }
}

/// Record `id` in an element's config.yaml.
///
/// The line is appended (or the existing `auto_id:` line replaced) rather than
/// the file re-serialized, so giving an existing project its ids shows up as
/// one added line per file instead of every hand-written file being reformatted
/// and losing its comments. Falls back to a normal write when the text cannot
/// be patched safely. A file that does not parse is refused: it is the user's
/// to fix, and writing over it would destroy what it holds.
pub fn store_auto_id(dir: &Path, id: &str) -> Result<(), String> {
    let path = dir.join(CONFIG_FILE);
    let text = if path.exists() {
        fs::read_to_string(&path).map_err(|e| e.to_string())?
    } else {
        String::new()
    };
    let current: NodeConfig = if text.trim().is_empty() {
        NodeConfig::default()
    } else {
        serde_yml::from_str(&text).map_err(|e| format!("{}: {e}", path.display()))?
    };
    let mut want = current.clone();
    want.auto_id = Some(id.to_string());
    if let Some(patched) = patch_key_line(&text, "auto_id", id, &want) {
        return retry_io(|| fs::write(&path, &patched)).map_err(|e| e.to_string());
    }
    write_yaml(&path, &want)
}

/// Make sure every element in `<body>` has a fixed id and that no two share
/// one.
///
/// Elements without an id get the next free ones, in tree order. When an id
/// is duplicated — a folder copied in the file explorer, say — the element
/// whose config.yaml is oldest keeps it and the others get new ones, so the
/// original keeps its name and the copy is what changes.
///
/// `tree` is updated in place so the caller can hand it on without reading it
/// again. The caller holds the filesystem lock. Returns how many ids were
/// assigned; problems (a broken htfl.yaml, a read-only folder) leave the ids
/// missing rather than failing the read.
pub fn assign_missing_ids(root: &Path, tree: &mut TreeNode) -> usize {
    if !root.join(PROJECT_FILE).is_file() {
        return 0;
    }
    let Some(body) = tree
        .children
        .iter_mut()
        .find(|c| c.display_name.eq_ignore_ascii_case("body"))
    else {
        return 0;
    };

    fn list(n: &TreeNode, out: &mut Vec<(PathBuf, Option<u32>)>) {
        out.push((
            PathBuf::from(&n.path),
            n.config.auto_id.as_deref().and_then(parse_auto_id),
        ));
        for c in &n.children {
            list(c, out);
        }
    }
    let mut nodes = Vec::new();
    list(body, &mut nodes);

    let age = |p: &Path| {
        fs::metadata(p.join(CONFIG_FILE))
            .and_then(|m| m.modified())
            .ok()
    };
    let mut holders: HashMap<u32, usize> = HashMap::new();
    let mut needs: Vec<usize> = Vec::new();
    for (i, (path, id)) in nodes.iter().enumerate() {
        let Some(n) = id else {
            needs.push(i);
            continue;
        };
        match holders.get(n).copied() {
            None => {
                holders.insert(*n, i);
            }
            Some(j) => {
                let this_is_older =
                    matches!((age(path), age(&nodes[j].0)), (Some(a), Some(b)) if a < b);
                if this_is_older {
                    holders.insert(*n, i);
                    needs.push(j);
                } else {
                    needs.push(i);
                }
            }
        }
    }
    // A config.yaml that does not parse would be overwritten; leave it alone.
    needs.retain(|&i| read_node_config(&nodes[i].0).is_ok());
    if needs.is_empty() {
        return 0;
    }
    needs.sort_unstable();

    let highest = holders.keys().copied().max().unwrap_or(0);
    let Ok(first) = reserve(root, needs.len() as u32, highest + 1) else {
        return 0;
    };
    let mut assigned: HashMap<usize, String> = HashMap::new();
    for (k, &i) in needs.iter().enumerate() {
        let id = format_auto_id(first + k as u32);
        if store_auto_id(&nodes[i].0, &id).is_ok() {
            assigned.insert(i, id);
        }
    }

    // Mirror into the in-memory tree, walking the same preorder as `list`.
    fn apply(n: &mut TreeNode, at: &mut usize, assigned: &HashMap<usize, String>) {
        if let Some(id) = assigned.get(at) {
            n.config.auto_id = Some(id.clone());
            n.has_config = true;
        }
        *at += 1;
        for c in &mut n.children {
            apply(c, at, assigned);
        }
    }
    let mut at = 0;
    apply(body, &mut at, &assigned);
    assigned.len()
}

/// [`assign_missing_ids`] for callers that do not read the tree themselves —
/// the MCP server when it starts against a project.
pub fn ensure_auto_ids(root: &Path) -> Result<usize, String> {
    let _fs_guard = super::lock::fs_guard();
    let html_root = root.join(HTML_ROOT);
    if !html_root.is_dir() {
        return Ok(0);
    }
    let mut tree = build_tree(&html_root).map_err(|e| e.to_string())?;
    Ok(assign_missing_ids(root, &mut tree))
}

#[cfg(test)]
mod tests {
    use super::*;

    fn project(label: &str) -> PathBuf {
        let dir = std::env::temp_dir().join(format!(
            "foling_ids_{label}_{}_{}",
            std::process::id(),
            std::time::SystemTime::now()
                .duration_since(std::time::UNIX_EPOCH)
                .unwrap()
                .as_nanos()
        ));
        init_project(dir.to_string_lossy().into_owned(), None).unwrap();
        dir
    }

    fn body(root: &Path) -> PathBuf {
        root.join(HTML_ROOT).join("02_body")
    }

    fn auto_id(dir: &Path) -> Option<String> {
        read_node_config(dir).unwrap().auto_id
    }

    #[test]
    fn parse_and_format_round_trip() {
        assert_eq!(format_auto_id(17), "e17");
        assert_eq!(parse_auto_id("e17"), Some(17));
        assert_eq!(parse_auto_id("E3"), Some(3));
        for bad in ["e", "e0", "17", "e1x", "x17", ""] {
            assert_eq!(parse_auto_id(bad), None, "{bad}");
        }
    }

    #[test]
    fn created_elements_get_sequential_ids_that_are_never_reused() {
        let root = project("seq");
        // Reading the tree gives the existing <body> its id first.
        read_tree(root.to_string_lossy().into_owned()).unwrap();
        assert_eq!(auto_id(&body(&root)).as_deref(), Some("e1"));

        let b = body(&root).to_string_lossy().into_owned();
        let a = create_node(b.clone(), "01_header".into()).unwrap();
        let m = create_node(b.clone(), "02_main".into()).unwrap();
        assert_eq!(auto_id(Path::new(&a)).as_deref(), Some("e2"));
        assert_eq!(auto_id(Path::new(&m)).as_deref(), Some("e3"));

        // Deleting e3 does not free the number.
        delete_node(m).unwrap();
        let f = create_node(b, "02_footer".into()).unwrap();
        assert_eq!(auto_id(Path::new(&f)).as_deref(), Some("e4"));
        let cfg = read_project_config(root.to_string_lossy().into_owned()).unwrap();
        assert_eq!(cfg.next_auto_id, Some(5));
        let _ = fs::remove_dir_all(&root);
    }

    #[test]
    fn handing_out_ids_keeps_a_hand_written_htfl_yaml_intact() {
        let root = project("yaml");
        let p = root.join(PROJECT_FILE);
        let text = "# site settings\ndoctype: <!DOCTYPE html>\nvariables:\n  brand: '#ff0000' # main colour\n";
        fs::write(&p, text).unwrap();
        create_node(body(&root).to_string_lossy().into_owned(), "01_p".into()).unwrap();
        let after = fs::read_to_string(&p).unwrap();
        assert!(after.starts_with(text), "only a line is added: {after}");
        assert!(after.ends_with("next_auto_id: 2\n"), "{after}");
        create_node(body(&root).to_string_lossy().into_owned(), "02_p".into()).unwrap();
        let again = fs::read_to_string(&p).unwrap();
        assert_eq!(again, format!("{text}next_auto_id: 3\n"));
        let _ = fs::remove_dir_all(&root);
    }

    #[test]
    fn head_elements_get_no_fixed_id() {
        let root = project("head");
        let head = root.join(HTML_ROOT).join("01_head");
        let link = create_node(head.to_string_lossy().into_owned(), "03_link".into()).unwrap();
        assert_eq!(auto_id(Path::new(&link)), None);
        let _ = fs::remove_dir_all(&root);
    }

    #[test]
    fn reading_an_older_project_assigns_ids_in_tree_order_and_keeps_its_text() {
        let root = project("migrate");
        let b = body(&root);
        fs::create_dir_all(b.join("01_header").join("01_h1")).unwrap();
        fs::create_dir_all(b.join("02_main")).unwrap();
        let hand_written = "# hand-written, keep me\ncontent: Hello\ncss: |\n  color: red;\n";
        fs::write(b.join("01_header").join(CONFIG_FILE), hand_written).unwrap();

        let tree = read_tree(root.to_string_lossy().into_owned()).unwrap();
        // body e1 → header e2 → h1 e3 → main e4: preorder, like the tree.
        assert_eq!(auto_id(&b).as_deref(), Some("e1"));
        assert_eq!(auto_id(&b.join("01_header")).as_deref(), Some("e2"));
        assert_eq!(auto_id(&b.join("01_header").join("01_h1")).as_deref(), Some("e3"));
        assert_eq!(auto_id(&b.join("02_main")).as_deref(), Some("e4"));
        // The in-memory tree handed back already carries them.
        let tb = tree.children.iter().find(|c| c.display_name == "body").unwrap();
        assert_eq!(tb.children[0].config.auto_id.as_deref(), Some("e2"));

        // The hand-written file only gained a line: comment and layout intact.
        let after = fs::read_to_string(b.join("01_header").join(CONFIG_FILE)).unwrap();
        assert_eq!(after, format!("{hand_written}auto_id: e2\n"));

        // A second read changes nothing.
        read_tree(root.to_string_lossy().into_owned()).unwrap();
        assert_eq!(
            fs::read_to_string(b.join("01_header").join(CONFIG_FILE)).unwrap(),
            after
        );
        let _ = fs::remove_dir_all(&root);
    }

    #[test]
    fn a_copied_folder_gets_a_new_id_and_the_original_keeps_its_own() {
        let root = project("dup");
        let b = body(&root);
        let orig = PathBuf::from(
            create_node(b.to_string_lossy().into_owned(), "01_section".into()).unwrap(),
        );
        read_tree(root.to_string_lossy().into_owned()).unwrap();
        let original_id = auto_id(&orig).unwrap();

        // Copy the folder the way a file explorer would — same config.yaml,
        // written later — and place it *before* the original.
        std::thread::sleep(std::time::Duration::from_millis(20));
        let copy = b.join("00_section");
        fs::create_dir_all(&copy).unwrap();
        fs::write(copy.join(CONFIG_FILE), fs::read(orig.join(CONFIG_FILE)).unwrap()).unwrap();

        read_tree(root.to_string_lossy().into_owned()).unwrap();
        assert_eq!(auto_id(&orig).as_deref(), Some(original_id.as_str()));
        let copy_id = auto_id(&copy).unwrap();
        assert_ne!(copy_id, original_id);
        let _ = fs::remove_dir_all(&root);
    }

    #[test]
    fn a_config_that_does_not_parse_is_left_alone() {
        let root = project("broken");
        let el = body(&root).join("01_div");
        fs::create_dir_all(&el).unwrap();
        let broken = "content: \"unterminated\n";
        fs::write(el.join(CONFIG_FILE), broken).unwrap();
        read_tree(root.to_string_lossy().into_owned()).unwrap();
        assert_eq!(fs::read_to_string(el.join(CONFIG_FILE)).unwrap(), broken);
        let _ = fs::remove_dir_all(&root);
    }

    #[test]
    fn saving_an_element_never_changes_its_fixed_id() {
        let root = project("write");
        let el = create_node(body(&root).to_string_lossy().into_owned(), "01_p".into()).unwrap();
        let id = auto_id(Path::new(&el)).unwrap();
        // A config sent without the id (or with another one) keeps the stored id.
        let cfg = NodeConfig {
            content: Some("x".into()),
            ..Default::default()
        };
        write_node(el.clone(), cfg).unwrap();
        assert_eq!(auto_id(Path::new(&el)).as_deref(), Some(id.as_str()));
        let other = NodeConfig {
            auto_id: Some("e999".into()),
            ..Default::default()
        };
        write_node(el.clone(), other).unwrap();
        assert_eq!(auto_id(Path::new(&el)).as_deref(), Some(id.as_str()));
        let _ = fs::remove_dir_all(&root);
    }

    #[test]
    fn writing_stale_project_settings_does_not_wind_the_counter_back() {
        let root = project("counter");
        let key = root.to_string_lossy().into_owned();
        let stale = read_project_config(key.clone()).unwrap();
        create_node(body(&root).to_string_lossy().into_owned(), "01_p".into()).unwrap();
        let before = read_project_config(key.clone()).unwrap().next_auto_id;
        write_project_config(key.clone(), stale).unwrap();
        assert_eq!(read_project_config(key).unwrap().next_auto_id, before);
        let _ = fs::remove_dir_all(&root);
    }

    #[test]
    fn pasting_gets_new_ids_and_undo_restores_the_old_ones() {
        let root = project("restore");
        let b = body(&root);
        let el = create_node(b.to_string_lossy().into_owned(), "01_div".into()).unwrap();
        create_node(el.clone(), "01_span".into()).unwrap();
        let snap = snapshot_subtree(el.clone()).unwrap();
        let (div_id, span_id) = (
            snap.config.auto_id.clone().unwrap(),
            snap.children[0].config.auto_id.clone().unwrap(),
        );

        // Paste a copy: every element in it is a new element.
        let mut copy = snap.clone();
        copy.name = "02_div".into();
        let pasted = restore_subtree(b.to_string_lossy().into_owned(), copy, true).unwrap();
        let p = Path::new(&pasted);
        assert_ne!(auto_id(p).unwrap(), div_id);
        assert_ne!(auto_id(&p.join("01_span")).unwrap(), span_id);

        // Undo a delete: the same element comes back under its own id.
        delete_node(el.clone()).unwrap();
        let back = restore_subtree(b.to_string_lossy().into_owned(), snap, false).unwrap();
        assert_eq!(auto_id(Path::new(&back)).as_deref(), Some(div_id.as_str()));
        let _ = fs::remove_dir_all(&root);
    }
}
