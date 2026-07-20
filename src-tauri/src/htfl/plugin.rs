// SPDX-License-Identifier: AGPL-3.0-or-later
// Copyright (C) 2026 大松雄斗

//! Plugin discovery (plugins/*/plugin.yaml) and exporter script loading.

use std::fs;
use std::path::PathBuf;

use super::*;

// ---------- Plugin commands ----------

pub fn read_plugins(project_root: String) -> Result<Vec<LoadedPlugin>, String> {
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

pub fn read_plugin_script(plugin_dir: String, script: String) -> Result<String, String> {
    if script.contains("..") {
        return Err("不正なスクリプトパスです".into());
    }
    let p = PathBuf::from(&plugin_dir).join(&script);
    fs::read_to_string(&p).map_err(|e| e.to_string())
}

pub fn write_text_file(dest: String, content: String) -> Result<(), String> {
    fs::write(&dest, content).map_err(|e| e.to_string())
}