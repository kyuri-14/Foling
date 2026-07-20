// SPDX-License-Identifier: AGPL-3.0-or-later
// Copyright (C) 2026 大松雄斗

//! Transport-independent MCP dispatch.
//!
//! Speaks the three methods that matter — `initialize`, `tools/list`,
//! `tools/call` — plus `ping`, over plain JSON-RPC 2.0. There is no MCP SDK
//! dependency because at this size there is nothing to gain from one: the wire
//! format is a few hundred lines of `serde_json`, and both transports
//! (`foling-mcp` over stdio, the editor over HTTP) feed the same [`Server`].

use serde_json::{json, Value};

use super::tools;
use super::workspace::Workspace;

/// The MCP revision we implement. A client that asks for a different one gets
/// its own version echoed back when it looks like a valid revision string —
/// the methods used here have been stable across revisions, and refusing would
/// break clients for no benefit.
const PROTOCOL_VERSION: &str = "2025-06-18";

/// Sent to the client at initialize time. Agents read this before touching a
/// tool, so it earns its length by heading off the two mistakes that HTFL's
/// model invites: editing `<head>` as if it were in the tree, and inventing
/// folder names.
const INSTRUCTIONS: &str = "\
Foling edits HTFL projects: an HTML document stored as a folder tree, one folder \
per element, each holding a config.yaml with that element's classes, attributes, \
text, CSS and JS.

Working rules:
- Call htfl_get_tree first. Elements are addressed either by line number (\"L12\", \
which is also the id the build emits) or by path relative to HTML/ \
(\"02_body/01_header\"). Both are accepted everywhere.
- Never create or rename folders yourself. htfl_insert_element assigns the NN_ \
ordinal; line numbers shift when you insert, so re-read the tree after \
structural edits.
- <head> is a project setting, not a tree element. Page title, meta description, \
OGP and favicon go through htfl_update_project, not htfl_insert_element.
- Element CSS (the `css` field) is a list of declarations without a selector or \
braces, e.g. \"padding: 1rem;\". Shared classes go in classes/*.css via \
htfl_write_class_file.
- Run htfl_build when done. It writes nothing and reports the mistakes that \
would otherwise pass silently: unknown tags falling back to <div>, classes with \
no definition, content on void elements, empty href/src.";

pub struct Server {
    workspace: Workspace,
}

impl Server {
    pub fn new(workspace: Workspace) -> Self {
        Self { workspace }
    }

    pub fn workspace(&self) -> &Workspace {
        &self.workspace
    }

    /// Handle one decoded JSON-RPC message. `None` means "no reply" — which is
    /// correct for notifications, and the reason this returns an Option rather
    /// than always producing a response object.
    pub fn handle(&self, msg: &Value) -> Option<Value> {
        let id = msg.get("id").cloned();
        let method = msg.get("method").and_then(Value::as_str)?;
        let params = msg.get("params").cloned().unwrap_or_else(|| json!({}));

        // A message with no `id` is a notification: act on it, say nothing.
        if id.is_none() {
            return None;
        }
        let id = id.unwrap_or(Value::Null);

        let result = match method {
            "initialize" => Ok(self.initialize(&params)),
            "ping" => Ok(json!({})),
            "tools/list" => Ok(self.tools_list()),
            "tools/call" => return Some(self.tools_call(id, &params)),
            other => Err((-32601, format!("method not found: {other}"))),
        };

        Some(match result {
            Ok(result) => success(id, result),
            Err((code, message)) => failure(id, code, message),
        })
    }

    /// Convenience for line-oriented transports: decode, dispatch, re-encode.
    pub fn handle_line(&self, line: &str) -> Option<String> {
        let msg: Value = match serde_json::from_str(line) {
            Ok(v) => v,
            Err(e) => {
                return serde_json::to_string(&failure(
                    Value::Null,
                    -32700,
                    format!("parse error: {e}"),
                ))
                .ok()
            }
        };
        let response = self.handle(&msg)?;
        serde_json::to_string(&response).ok()
    }

    fn initialize(&self, params: &Value) -> Value {
        let version = params
            .get("protocolVersion")
            .and_then(Value::as_str)
            .filter(|v| looks_like_revision(v))
            .unwrap_or(PROTOCOL_VERSION);
        json!({
            "protocolVersion": version,
            "capabilities": { "tools": { "listChanged": false } },
            "serverInfo": {
                "name": "foling",
                "title": "Foling — HTFL editor",
                "version": env!("CARGO_PKG_VERSION"),
            },
            "instructions": INSTRUCTIONS,
        })
    }

    fn tools_list(&self) -> Value {
        let tools: Vec<Value> = tools::list()
            .into_iter()
            .map(|t| {
                json!({
                    "name": t.name,
                    "description": t.description,
                    "inputSchema": t.input_schema,
                })
            })
            .collect();
        json!({ "tools": tools })
    }

    fn tools_call(&self, id: Value, params: &Value) -> Value {
        let name = match params.get("name").and_then(Value::as_str) {
            Some(n) => n,
            None => return failure(id, -32602, "missing tool name".into()),
        };
        let args = params
            .get("arguments")
            .cloned()
            .unwrap_or_else(|| json!({}));

        // Tool failures come back as a *result* carrying isError, not as a
        // protocol error: the model is supposed to read the message and try
        // again, which it cannot do if the transport swallows it.
        match tools::call(&self.workspace, name, &args) {
            Ok(text) => success(id, json!({ "content": [text_block(&text)], "isError": false })),
            Err(e) => success(id, json!({ "content": [text_block(&e)], "isError": true })),
        }
    }
}

fn text_block(text: &str) -> Value {
    json!({ "type": "text", "text": text })
}

fn success(id: Value, result: Value) -> Value {
    json!({ "jsonrpc": "2.0", "id": id, "result": result })
}

fn failure(id: Value, code: i64, message: String) -> Value {
    json!({ "jsonrpc": "2.0", "id": id, "error": { "code": code, "message": message } })
}

/// `YYYY-MM-DD`, the shape every MCP revision string has taken.
fn looks_like_revision(v: &str) -> bool {
    v.len() == 10
        && v.as_bytes()[4] == b'-'
        && v.as_bytes()[7] == b'-'
        && v.bytes().filter(|b| b.is_ascii_digit()).count() == 8
}

#[cfg(test)]
mod tests {
    use super::*;
    use crate::htfl;

    fn server(label: &str) -> (Server, std::path::PathBuf) {
        let dir = std::env::temp_dir().join(format!(
            "foling_rpc_{label}_{}_{}",
            std::process::id(),
            std::time::SystemTime::now()
                .duration_since(std::time::UNIX_EPOCH)
                .unwrap()
                .as_nanos()
        ));
        htfl::init_project(dir.to_string_lossy().into_owned(), None).unwrap();
        let ws = Workspace::open(&dir, false).unwrap();
        (Server::new(ws), dir)
    }

    #[test]
    fn initialize_advertises_tools_and_echoes_a_valid_revision() {
        let (s, dir) = server("init");
        let r = s
            .handle(&json!({
                "jsonrpc": "2.0", "id": 1, "method": "initialize",
                "params": { "protocolVersion": "2024-11-05" }
            }))
            .unwrap();
        assert_eq!(r["result"]["protocolVersion"], "2024-11-05");
        assert!(r["result"]["capabilities"]["tools"].is_object());
        assert_eq!(r["result"]["serverInfo"]["name"], "foling");

        // A nonsense version falls back to ours rather than being echoed.
        let r = s
            .handle(&json!({
                "jsonrpc": "2.0", "id": 2, "method": "initialize",
                "params": { "protocolVersion": "banana" }
            }))
            .unwrap();
        assert_eq!(r["result"]["protocolVersion"], PROTOCOL_VERSION);
        let _ = std::fs::remove_dir_all(&dir);
    }

    #[test]
    fn notifications_get_no_reply() {
        let (s, dir) = server("notify");
        assert!(s
            .handle(&json!({ "jsonrpc": "2.0", "method": "notifications/initialized" }))
            .is_none());
        let _ = std::fs::remove_dir_all(&dir);
    }

    #[test]
    fn unknown_method_is_a_protocol_error() {
        let (s, dir) = server("unknown");
        let r = s
            .handle(&json!({ "jsonrpc": "2.0", "id": 9, "method": "resources/list" }))
            .unwrap();
        assert_eq!(r["error"]["code"], -32601);
        let _ = std::fs::remove_dir_all(&dir);
    }

    #[test]
    fn tool_failure_is_a_result_not_a_protocol_error() {
        let (s, dir) = server("toolerr");
        let r = s
            .handle(&json!({
                "jsonrpc": "2.0", "id": 3, "method": "tools/call",
                "params": { "name": "htfl_get_element", "arguments": { "ref": "L999" } }
            }))
            .unwrap();
        assert!(r.get("error").is_none(), "must not be a protocol error: {r}");
        assert_eq!(r["result"]["isError"], true);
        assert!(r["result"]["content"][0]["text"]
            .as_str()
            .unwrap()
            .contains("line 999"));
        let _ = std::fs::remove_dir_all(&dir);
    }

    #[test]
    fn tools_list_matches_the_tool_registry() {
        let (s, dir) = server("list");
        let r = s
            .handle(&json!({ "jsonrpc": "2.0", "id": 4, "method": "tools/list" }))
            .unwrap();
        let listed = r["result"]["tools"].as_array().unwrap();
        assert_eq!(listed.len(), tools::list().len());
        for t in listed {
            assert!(t["name"].is_string());
            assert!(t["inputSchema"]["type"] == "object");
        }
        let _ = std::fs::remove_dir_all(&dir);
    }

    #[test]
    fn malformed_json_produces_a_parse_error() {
        let (s, dir) = server("parse");
        let out = s.handle_line("{not json").unwrap();
        assert!(out.contains("-32700"), "{out}");
        let _ = std::fs::remove_dir_all(&dir);
    }
}
