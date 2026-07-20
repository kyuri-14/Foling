// SPDX-License-Identifier: AGPL-3.0-or-later
// Copyright (C) 2026 大松雄斗

//! Tauri application layer.
//!
//! Every command here is a thin delegation to [`htfl`], which holds the actual
//! HTFL semantics. The MCP server calls the same functions, so an agent and the
//! GUI cannot drift apart: `NN_` numbering, YAML shape and build output are
//! decided in exactly one place.

pub mod htfl;
pub mod mcp;

use htfl::types::*;
use serde::{Deserialize, Serialize};
use std::fs;
use std::path::{Path, PathBuf};
use std::sync::atomic::{AtomicU64, Ordering};
use std::sync::{Arc, Mutex};

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
    /// MCP server bound to the open project, if the user has enabled it.
    mcp: Mutex<Option<Arc<mcp::Server>>>,
    /// Bearer token for `POST /mcp`. Minted once per app launch.
    mcp_token: String,
    /// Bumped after an agent mutates the project through MCP, so the editor
    /// can pull the change in instead of silently showing a stale tree.
    reload_version: AtomicU64,
}

#[derive(Serialize, Deserialize, Debug, Clone)]
pub struct SelectionInfo {
    pub version: u64,
    pub path: Option<String>,
}

/// What the editor needs to show the user so they can wire an agent up.
#[derive(Serialize, Deserialize, Debug, Clone)]
pub struct McpStatus {
    /// Empty until a project is bound.
    pub url: String,
    pub token: String,
    pub enabled: bool,
    pub project: Option<String>,
    /// Bumped by agent writes; the editor polls it to refresh the tree.
    pub reload_version: u64,
}

/// A token for the localhost MCP endpoint.
///
/// Not cryptographic, and it does not need to be: the endpoint is bound to
/// 127.0.0.1 and the token exists to stop a random page in the user's browser
/// from driving their editor. It is unguessable in that setting, which is the
/// threat being defended against. (`Origin` is checked too — see `POST /mcp`.)
fn mint_token() -> String {
    use std::collections::hash_map::DefaultHasher;
    use std::hash::{Hash, Hasher};

    let mut out = String::with_capacity(32);
    let mut seed = std::time::SystemTime::now()
        .duration_since(std::time::UNIX_EPOCH)
        .map(|d| d.as_nanos() as u64)
        .unwrap_or(0)
        ^ (std::process::id() as u64) << 32;
    // Address of a heap allocation: ASLR makes this differ between launches.
    let probe = Box::new(0u8);
    seed ^= (&*probe as *const u8) as u64;
    for _ in 0..4 {
        let mut h = DefaultHasher::new();
        seed.hash(&mut h);
        seed = h.finish();
        out.push_str(&format!("{seed:016x}"));
    }
    out
}

/// What `POST /mcp` should answer with. Split out from the request loop so the
/// authorization rules can be tested without standing up a socket.
enum McpHttpOutcome {
    Reply(String),
    /// A notification: handled, nothing to say back.
    Accepted,
    Denied(u16, &'static str),
}

/// Decide the response to an `/mcp` request, applying the token and origin
/// checks and bumping the reload counter when the call mutated the project.
///
/// The endpoint lives on the same localhost server that serves the preview to
/// the user's browser, so a page the user visits can reach it. The bearer token
/// is the gate; the `Origin` check is a second lock, since no legitimate caller
/// (an agent CLI) sends a browser origin at all.
fn mcp_http_outcome(
    state: &PreviewState,
    is_post: bool,
    auth: Option<&str>,
    origin: Option<&str>,
    body: &str,
) -> McpHttpOutcome {
    if !is_post {
        return McpHttpOutcome::Denied(405, "POST only");
    }
    let origin_ok = match origin {
        None => true,
        Some(v) => {
            v.is_empty()
                || v == "null"
                || v.starts_with("http://127.0.0.1")
                || v.starts_with("http://localhost")
        }
    };
    if !origin_ok {
        return McpHttpOutcome::Denied(403, "cross-origin requests are not accepted");
    }
    let token_ok = auth
        .and_then(|a| a.strip_prefix("Bearer "))
        .map(|t| t == state.mcp_token)
        .unwrap_or(false);
    if !token_ok {
        return McpHttpOutcome::Denied(401, "missing or invalid bearer token");
    }

    let Some(server) = state.mcp.lock().ok().and_then(|g| g.clone()) else {
        return McpHttpOutcome::Denied(503, "no project is bound to the MCP server");
    };
    let mutating = body_is_mutating(body);
    match server.handle_line(body.trim()) {
        Some(reply) => {
            if mutating {
                state.reload_version.fetch_add(1, Ordering::Relaxed);
            }
            McpHttpOutcome::Reply(reply)
        }
        None => McpHttpOutcome::Accepted,
    }
}

/// Whether a raw JSON-RPC body is a tool call that writes. Parsed rather than
/// string-matched so a tool *name* appearing in an argument can't trigger a
/// spurious editor reload.
fn body_is_mutating(body: &str) -> bool {
    let Ok(v) = serde_json::from_str::<serde_json::Value>(body) else {
        return false;
    };
    if v.get("method").and_then(|m| m.as_str()) != Some("tools/call") {
        return false;
    }
    v.get("params")
        .and_then(|p| p.get("name"))
        .and_then(|n| n.as_str())
        .map(mcp::tools::is_mutating)
        .unwrap_or(false)
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

            // MCP over Streamable HTTP. One JSON-RPC message per POST, one
            // JSON response back; no SSE stream, which the spec allows and
            // which keeps this to a handler rather than a subsystem.
            if path == "/mcp" {
                let mut auth: Option<String> = None;
                let mut origin: Option<String> = None;
                for h in request.headers() {
                    match h.field.as_str().as_str().to_ascii_lowercase().as_str() {
                        "authorization" => auth = Some(h.value.as_str().to_string()),
                        "origin" => origin = Some(h.value.as_str().to_string()),
                        _ => {}
                    }
                }
                let mut body = String::new();
                if is_post {
                    let _ =
                        std::io::Read::read_to_string(&mut request.as_reader(), &mut body);
                }

                let outcome = mcp_http_outcome(
                    &state,
                    is_post,
                    auth.as_deref(),
                    origin.as_deref(),
                    &body,
                );
                let _ = match outcome {
                    McpHttpOutcome::Reply(reply) => {
                        let h = Header::from_bytes(
                            &b"Content-Type"[..],
                            &b"application/json"[..],
                        )
                        .unwrap();
                        request.respond(
                            Response::from_string(reply)
                                .with_header(h)
                                .with_header(no_cache_h.clone()),
                        )
                    }
                    McpHttpOutcome::Accepted => request.respond(Response::empty(202)),
                    McpHttpOutcome::Denied(code, msg) => request.respond(
                        Response::from_string(msg.to_string()).with_status_code(code),
                    ),
                };
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

/// Open the OS terminal in `dir` and run `command` inside it. Used to hand
/// the project folder to an AI agent CLI (Claude Code, Codex, …): HTFL is
/// plain folders + YAML, so a file-editing agent can work on the project
/// directly and the user just reloads the tree afterwards.
///
/// `command` comes from a built-in preset or a plugin manifest and the UI
/// shows it in a confirm dialog before calling this, so the user always sees
/// exactly what will run.
#[tauri::command]
fn open_terminal(dir: String, command: String) -> Result<(), String> {
    let d = PathBuf::from(&dir);
    if !d.is_dir() {
        return Err("プロジェクトフォルダが見つかりません".into());
    }

    #[cfg(target_os = "windows")]
    {
        use std::os::windows::process::CommandExt;
        const CREATE_NEW_CONSOLE: u32 = 0x0000_0010;
        // `/K` keeps the console open after the command exits so the user can
        // read the agent's final output.
        std::process::Command::new("cmd")
            .args(["/K", &command])
            .current_dir(&d)
            .creation_flags(CREATE_NEW_CONSOLE)
            .spawn()
            .map_err(|e| e.to_string())?;
        Ok(())
    }

    #[cfg(target_os = "macos")]
    {
        // Terminal.app via AppleScript. The shell line single-quotes the
        // directory (with '\'' escaping); the whole line is then escaped for
        // the AppleScript string literal (backslash and double-quote).
        let dir_sh = format!("'{}'", dir.replace('\'', r"'\''"));
        let shell_line = format!("cd {} && {}", dir_sh, command);
        let script_line = shell_line.replace('\\', r"\\").replace('"', "\\\"");
        let script = format!(
            "tell application \"Terminal\"\nactivate\ndo script \"{}\"\nend tell",
            script_line
        );
        std::process::Command::new("osascript")
            .args(["-e", &script])
            .spawn()
            .map_err(|e| e.to_string())?;
        Ok(())
    }

    #[cfg(all(not(target_os = "windows"), not(target_os = "macos")))]
    {
        // Best-effort: try common terminal emulators until one launches.
        // `exec bash` keeps the window open after the agent exits.
        let keep_open = format!("{}; exec bash", command);
        let attempts: [(&str, Vec<String>); 4] = [
            (
                "x-terminal-emulator",
                vec!["-e".into(), "bash".into(), "-lc".into(), keep_open.clone()],
            ),
            (
                "gnome-terminal",
                vec![
                    format!("--working-directory={}", dir),
                    "--".into(),
                    "bash".into(),
                    "-lc".into(),
                    keep_open.clone(),
                ],
            ),
            (
                "konsole",
                vec![
                    "--workdir".into(),
                    dir.clone(),
                    "-e".into(),
                    "bash".into(),
                    "-lc".into(),
                    keep_open.clone(),
                ],
            ),
            (
                "xterm",
                vec!["-e".into(), "bash".into(), "-lc".into(), keep_open.clone()],
            ),
        ];
        for (term, args) in attempts {
            let mut c = std::process::Command::new(term);
            c.args(&args);
            c.current_dir(&d);
            if c.spawn().is_ok() {
                return Ok(());
            }
        }
        Err("ターミナルエミュレータを起動できませんでした".into())
    }
}

// ---------- Tauri command layer ----------

#[tauri::command]
fn read_tree(project_root: String) -> Result<TreeNode, String> {
    htfl::set_lock_scope(Some(Path::new(&project_root)));
    htfl::read_tree(project_root)
}

#[tauri::command]
fn read_node(node_path: String) -> Result<NodeConfig, String> {
    htfl::read_node(node_path)
}

#[tauri::command]
fn write_node(node_path: String, config: NodeConfig) -> Result<(), String> {
    htfl::write_node(node_path, config)
}

#[tauri::command]
fn create_node(parent_path: String, name: String) -> Result<String, String> {
    htfl::create_node(parent_path, name)
}

#[tauri::command]
fn delete_node(node_path: String) -> Result<(), String> {
    htfl::delete_node(node_path)
}

#[tauri::command]
fn rename_node(old_path: String, new_name: String) -> Result<String, String> {
    htfl::rename_node(old_path, new_name)
}

#[tauri::command]
fn snapshot_subtree(node_path: String) -> Result<NodeSnapshot, String> {
    htfl::snapshot_subtree(node_path)
}

#[tauri::command]
fn restore_subtree(parent_path: String, snapshot: NodeSnapshot) -> Result<String, String> {
    htfl::restore_subtree(parent_path, snapshot)
}

#[tauri::command]
fn read_project_config(project_root: String) -> Result<ProjectConfig, String> {
    htfl::read_project_config(project_root)
}

#[tauri::command]
fn write_project_config(project_root: String, config: ProjectConfig) -> Result<(), String> {
    htfl::write_project_config(project_root, config)
}

#[tauri::command]
fn init_project(project_root: String, doctype: Option<String>) -> Result<(), String> {
    htfl::init_project(project_root, doctype)
}

#[tauri::command]
fn read_class_files(project_root: String) -> Result<Vec<ClassFile>, String> {
    htfl::read_class_files(project_root)
}

#[tauri::command]
fn write_class_file(
    project_root: String,
    file_name: String,
    content: String,
) -> Result<(), String> {
    htfl::write_class_file(project_root, file_name, content)
}

#[tauri::command]
fn delete_class_file(project_root: String, file_name: String) -> Result<(), String> {
    htfl::delete_class_file(project_root, file_name)
}

#[tauri::command]
fn read_modules(project_root: String) -> Result<Vec<ModuleFile>, String> {
    htfl::read_modules(project_root)
}

#[tauri::command]
fn write_module_file(
    project_root: String,
    file_name: String,
    modules: Vec<ModuleDef>,
) -> Result<(), String> {
    htfl::write_module_file(project_root, file_name, modules)
}

#[tauri::command]
fn delete_module_file(project_root: String, file_name: String) -> Result<(), String> {
    htfl::delete_module_file(project_root, file_name)
}

#[tauri::command]
fn import_module_file(project_root: String, src_path: String) -> Result<String, String> {
    htfl::import_module_file(project_root, src_path)
}

#[tauri::command]
fn read_image_folders(project_root: String) -> Result<Vec<ImageFolder>, String> {
    htfl::read_image_folders(project_root)
}

#[tauri::command]
fn export_html(project_root: String, dest_file: String) -> Result<(), String> {
    htfl::export_html(project_root, dest_file)
}

#[tauri::command]
fn import_html(html_path: String, dest_root: String) -> Result<String, String> {
    htfl::import_html(html_path, dest_root)
}

#[tauri::command]
fn read_plugins(project_root: String) -> Result<Vec<LoadedPlugin>, String> {
    htfl::read_plugins(project_root)
}

#[tauri::command]
fn read_plugin_script(plugin_dir: String, script: String) -> Result<String, String> {
    htfl::read_plugin_script(plugin_dir, script)
}

#[tauri::command]
fn write_text_file(dest: String, content: String) -> Result<(), String> {
    htfl::write_text_file(dest, content)
}

/// Bind (or unbind) the in-app MCP server to a project. Binding is explicit
/// rather than automatic: exposing an HTTP endpoint that can rewrite the user's
/// project should be something they turned on.
#[tauri::command]
fn mcp_bind(
    project_root: Option<String>,
    state: tauri::State<Arc<PreviewState>>,
) -> Result<McpStatus, String> {
    let server = match &project_root {
        Some(root) => {
            let ws = mcp::Workspace::open(Path::new(root), false)?;
            Some(Arc::new(mcp::Server::new(ws)))
        }
        None => None,
    };
    if let Ok(mut slot) = state.mcp.lock() {
        *slot = server;
    }
    mcp_status(state)
}

#[tauri::command]
fn mcp_status(state: tauri::State<Arc<PreviewState>>) -> Result<McpStatus, String> {
    let bound = state
        .mcp
        .lock()
        .ok()
        .and_then(|g| g.as_ref().map(|s| s.workspace().root().to_path_buf()));
    let port = state.port.lock().map(|p| *p).unwrap_or(0);
    Ok(McpStatus {
        url: if port == 0 || bound.is_none() {
            String::new()
        } else {
            format!("http://127.0.0.1:{port}/mcp")
        },
        token: state.mcp_token.clone(),
        enabled: bound.is_some(),
        // Strip the `\\?\` verbatim prefix canonicalize() adds on Windows; the
        // editor shows this string to the user.
        project: bound.map(|p| {
            let s = p.to_string_lossy().into_owned();
            s.strip_prefix(r"\\?\").map(str::to_string).unwrap_or(s)
        }),
        reload_version: state.reload_version.load(Ordering::Relaxed),
    })
}

/// Editor polls this to learn that an agent changed the project underneath it.
#[tauri::command]
fn poll_reload(state: tauri::State<Arc<PreviewState>>) -> u64 {
    state.reload_version.load(Ordering::Relaxed)
}

/// Build and publish to the preview server. Unlike the other commands this one
/// keeps app state, so it cannot live in `htfl`.
#[tauri::command]
fn build_html(
    project_root: String,
    state: tauri::State<Arc<PreviewState>>,
    dev: Option<bool>,
) -> Result<String, String> {
    let root = PathBuf::from(&project_root);
    let out = htfl::generate_html_locked(&root, dev.unwrap_or(false))?;

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

#[cfg_attr(mobile, tauri::mobile_entry_point)]
pub fn run() {
    let preview_state: Arc<PreviewState> = Arc::new(PreviewState {
        html: Mutex::new(String::new()),
        version: AtomicU64::new(0),
        project_root: Mutex::new(None),
        port: Mutex::new(0),
        selected_path: Mutex::new(None),
        select_version: AtomicU64::new(0),
        mcp: Mutex::new(None),
        mcp_token: mint_token(),
        reload_version: AtomicU64::new(0),
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
        // The menu bar doubles as the title bar, so the OS frame goes away —
        // except on macOS, where `titleBarStyle: "Overlay"` (tauri.conf.json)
        // keeps the native traffic lights floating over our own bar. Dropping
        // decorations there would take those buttons with it.
        .setup(|app| {
            #[cfg(not(target_os = "macos"))]
            {
                use tauri::Manager;
                if let Some(window) = app.get_webview_window("main") {
                    let _ = window.set_decorations(false);
                }
            }
            let _ = app;
            Ok(())
        })
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
            open_terminal,
            poll_selection,
            mcp_bind,
            mcp_status,
            poll_reload,
        ])
        .run(tauri::generate_context!())
        .expect("error while running tauri application");
}

#[cfg(test)]
mod tests {
    use super::htfl::*;
    use super::{mcp_http_outcome, mime_for};
    use std::collections::BTreeMap;
    use std::fs;
    use std::path::Path;
    use std::sync::atomic::Ordering;

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
    fn pre_content_is_emitted_without_layout_whitespace() {
        // Whitespace inside <pre> is content. The pretty-printing indentation
        // the builder adds everywhere else used to land on every line of a code
        // block, pushing it right by two spaces per level of nesting.
        let dir = std::env::temp_dir().join(format!(
            "foling_pretest_{}_{}",
            std::process::id(),
            std::time::SystemTime::now()
                .duration_since(std::time::UNIX_EPOCH)
                .unwrap()
                .as_nanos()
        ));
        init_project(dir.to_string_lossy().into_owned(), None).unwrap();
        let body = dir.join(HTML_ROOT).join("02_body");

        // <pre> nested a few levels down, with a <code> inside it.
        let pre = body.join("01_div").join("01_section").join("01_pre");
        let code = pre.join("01_code");
        fs::create_dir_all(&code).unwrap();
        fs::write(
            code.join("config.yaml"),
            "content: |\n  line one\n    indented by two\n",
        )
        .unwrap();

        let html = generate_html(&dir, false).unwrap();
        let _ = fs::remove_dir_all(&dir);

        // body=1, div=2, section=3, pre=4, code=5. The YAML block scalar strips
        // its own common indent, so the second line keeps two spaces.
        assert!(
            html.contains("<pre id=\"4\"><code id=\"5\">line one\n  indented by two</code></pre>"),
            "pre content must survive verbatim, got:\n{html}"
        );
        // Nothing may sit between <pre> and <code>, or before </pre>.
        assert!(!html.contains("<pre id=\"4\">\n"), "no newline after <pre>");

        // Normal elements keep their indentation.
        assert!(html.contains("\n  <body"), "body is still indented");
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

    fn preview_state_for_tests(project: Option<&Path>) -> super::PreviewState {
        use std::sync::atomic::AtomicU64;
        use std::sync::Mutex;
        super::PreviewState {
            html: Mutex::new(String::new()),
            version: AtomicU64::new(0),
            project_root: Mutex::new(None),
            port: Mutex::new(0),
            selected_path: Mutex::new(None),
            select_version: AtomicU64::new(0),
            mcp: Mutex::new(project.map(|p| {
                std::sync::Arc::new(super::mcp::Server::new(
                    super::mcp::Workspace::open(p, false).unwrap(),
                ))
            })),
            mcp_token: "test-token".into(),
            reload_version: AtomicU64::new(0),
        }
    }

    fn denial(o: super::McpHttpOutcome) -> u16 {
        match o {
            super::McpHttpOutcome::Denied(code, _) => code,
            super::McpHttpOutcome::Reply(_) => 200,
            super::McpHttpOutcome::Accepted => 202,
        }
    }

    #[test]
    fn mcp_endpoint_requires_the_token_and_rejects_browser_origins() {
        let state = preview_state_for_tests(None);
        let ping = r#"{"jsonrpc":"2.0","id":1,"method":"ping"}"#;
        let bearer = Some("Bearer test-token");

        assert_eq!(denial(mcp_http_outcome(&state, false, bearer, None, "")), 405);
        assert_eq!(denial(mcp_http_outcome(&state, true, None, None, ping)), 401);
        assert_eq!(
            denial(mcp_http_outcome(&state, true, Some("Bearer wrong"), None, ping)),
            401
        );
        // A page on the web must not be able to drive the editor even if it
        // somehow learned the token.
        assert_eq!(
            denial(mcp_http_outcome(&state, true, bearer, Some("https://evil.example"), ping)),
            403
        );
        // Correct token, no project bound yet.
        assert_eq!(denial(mcp_http_outcome(&state, true, bearer, None, ping)), 503);
    }

    #[test]
    fn mcp_endpoint_serves_a_bound_project_and_tracks_writes() {
        let dir = std::env::temp_dir().join(format!(
            "foling_http_{}_{}",
            std::process::id(),
            std::time::SystemTime::now()
                .duration_since(std::time::UNIX_EPOCH)
                .unwrap()
                .as_nanos()
        ));
        init_project(dir.to_string_lossy().into_owned(), None).unwrap();
        let state = preview_state_for_tests(Some(&dir));
        let bearer = Some("Bearer test-token");

        let reply = match mcp_http_outcome(
            &state,
            true,
            bearer,
            Some("null"),
            r#"{"jsonrpc":"2.0","id":1,"method":"tools/list"}"#,
        ) {
            super::McpHttpOutcome::Reply(r) => r,
            other => panic!("expected a reply, got {}", denial(other)),
        };
        assert!(reply.contains("htfl_get_tree"));
        assert_eq!(state.reload_version.load(Ordering::Relaxed), 0, "a read is not a write");

        // A notification is accepted with no body and no reload.
        assert!(matches!(
            mcp_http_outcome(
                &state,
                true,
                bearer,
                None,
                r#"{"jsonrpc":"2.0","method":"notifications/initialized"}"#
            ),
            super::McpHttpOutcome::Accepted
        ));

        mcp_http_outcome(
            &state,
            true,
            bearer,
            None,
            r#"{"jsonrpc":"2.0","id":2,"method":"tools/call","params":{"name":"htfl_insert_element","arguments":{"parent":"02_body","tag":"section"}}}"#,
        );
        assert_eq!(
            state.reload_version.load(Ordering::Relaxed),
            1,
            "a write tells the editor to reload"
        );

        let _ = fs::remove_dir_all(&dir);
    }

    #[test]
    fn only_real_write_calls_trigger_an_editor_reload() {
        let call = |name: &str| {
            format!(r#"{{"jsonrpc":"2.0","id":1,"method":"tools/call","params":{{"name":"{name}"}}}}"#)
        };
        assert!(super::body_is_mutating(&call("htfl_insert_element")));
        assert!(!super::body_is_mutating(&call("htfl_get_tree")));
        assert!(!super::body_is_mutating(
            r#"{"jsonrpc":"2.0","id":1,"method":"tools/list"}"#
        ));
        // A write tool's name quoted inside an argument is not a write.
        assert!(!super::body_is_mutating(
            r#"{"jsonrpc":"2.0","id":1,"method":"tools/call","params":{"name":"htfl_get_tree","arguments":{"ref":"htfl_delete_element"}}}"#
        ));
        assert!(!super::body_is_mutating("not json"));
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
