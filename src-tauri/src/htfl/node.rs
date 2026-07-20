// SPDX-License-Identifier: AGPL-3.0-or-later
// Copyright (C) 2026 大松雄斗

//! Single-element operations: config.yaml read/write, create/rename/delete,
//! subtree snapshot/restore.

use serde::Serialize;
use std::fs;
use std::path::{Path, PathBuf};

use super::*;

pub fn read_node_config(node_path: &Path) -> Result<NodeConfig, String> {
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

pub fn write_yaml<T: Serialize>(path: &Path, value: &T) -> Result<(), String> {
    let s = serde_yml::to_string(value).map_err(|e| e.to_string())?;
    fs::write(path, s).map_err(|e| e.to_string())
}
pub fn read_node(node_path: String) -> Result<NodeConfig, String> {
    read_node_config(Path::new(&node_path))
}

pub fn write_node(node_path: String, config: NodeConfig) -> Result<(), String> {
    let _fs_guard = super::lock::fs_guard();
    let dir = PathBuf::from(&node_path);
    fs::create_dir_all(&dir).map_err(|e| e.to_string())?;
    write_yaml(&dir.join(CONFIG_FILE), &config)
}
/// Seed common "link-bearing" tags with the attribute that makes them
/// actually functional — otherwise a fresh `<a>` etc. has nothing to attach
/// to and feels broken in the preview.
pub fn default_config_for_tag(tag: &str) -> NodeConfig {
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
pub fn create_node(parent_path: String, name: String) -> Result<String, String> {
    let _fs_guard = super::lock::fs_guard();
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

pub fn delete_node(node_path: String) -> Result<(), String> {
    let _fs_guard = super::lock::fs_guard();
    let p = PathBuf::from(&node_path);
    retry_io(|| fs::remove_dir_all(&p)).map_err(|e| e.to_string())
}

pub fn rename_node(old_path: String, new_name: String) -> Result<String, String> {
    let _fs_guard = super::lock::fs_guard();
    let old = PathBuf::from(&old_path);
    let parent = old
        .parent()
        .ok_or_else(|| "親フォルダが見つかりません".to_string())?;
    let new_path = parent.join(&new_name);
    retry_io(|| fs::rename(&old, &new_path)).map_err(|e| e.to_string())?;
    Ok(new_path.to_string_lossy().into_owned())
}
pub fn snapshot_subtree(node_path: String) -> Result<NodeSnapshot, String> {
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

pub fn restore_subtree(parent_path: String, snapshot: NodeSnapshot) -> Result<String, String> {
    let _fs_guard = super::lock::fs_guard();
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