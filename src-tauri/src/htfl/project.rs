// SPDX-License-Identifier: AGPL-3.0-or-later
// Copyright (C) 2026 大松雄斗

//! Project-level files: htfl.yaml, classes/, modules/, images/, scaffolding.

use std::fs;
use std::path::PathBuf;

use super::*;

pub fn read_project_config(project_root: String) -> Result<ProjectConfig, String> {
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

pub fn write_project_config(project_root: String, config: ProjectConfig) -> Result<(), String> {
    let p = PathBuf::from(&project_root).join(PROJECT_FILE);
    write_yaml(&p, &config)
}
pub fn init_project(project_root: String, doctype: Option<String>) -> Result<(), String> {
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
pub fn read_class_files(project_root: String) -> Result<Vec<ClassFile>, String> {
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

pub fn write_class_file(
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

pub fn delete_class_file(project_root: String, file_name: String) -> Result<(), String> {
    if file_name.contains('/') || file_name.contains('\\') {
        return Err("ファイル名にパス区切り文字は使えません".into());
    }
    let p = PathBuf::from(&project_root).join(CLASSES_DIR).join(&file_name);
    fs::remove_file(&p).map_err(|e| e.to_string())
}
pub fn read_modules(project_root: String) -> Result<Vec<ModuleFile>, String> {
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

pub fn write_module_file(
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

pub fn delete_module_file(project_root: String, file_name: String) -> Result<(), String> {
    if file_name.contains('/') || file_name.contains('\\') {
        return Err("ファイル名にパス区切り文字は使えません".into());
    }
    let p = PathBuf::from(&project_root).join(MODULES_DIR).join(&file_name);
    fs::remove_file(&p).map_err(|e| e.to_string())
}

/// Copy an external module file into the project's `modules/` folder after
/// validating that it parses as a module list. Returns the stored file name.
pub fn import_module_file(project_root: String, src_path: String) -> Result<String, String> {
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
pub fn read_image_folders(project_root: String) -> Result<Vec<ImageFolder>, String> {
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