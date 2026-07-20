// SPDX-License-Identifier: AGPL-3.0-or-later
// Copyright (C) 2026 大松雄斗

//! `foling-mcp` — Foling's MCP server over stdio.
//!
//! Point an agent CLI at it and the agent can edit an HTFL project through the
//! same operations the editor uses. The editor does not need to be running; if
//! it is, reload the tree afterwards (PLUGINS → reload tree).
//!
//! ```text
//! foling-mcp --project "C:\path\to\my-site"
//! ```
//!
//! In an agent CLI's `.mcp.json`:
//!
//! ```json
//! { "mcpServers": { "foling": {
//!     "command": "foling-mcp",
//!     "args": ["--project", "C:\\path\\to\\my-site"] } } }
//! ```
//!
//! Transport is newline-delimited JSON-RPC: one message per line on stdin, one
//! response per line on stdout. **stdout carries protocol only** — every
//! diagnostic goes to stderr, because a stray `println!` here corrupts the
//! session in a way that is genuinely painful to debug.

use std::ffi::OsString;
use std::io::{BufRead, Write};
use std::path::PathBuf;
use std::process::ExitCode;

use foling_lib::mcp::{Server, Workspace};

const USAGE: &str = "\
foling-mcp — MCP server for HTFL projects (Foling)

USAGE:
    foling-mcp [--project <dir>] [--read-only]

OPTIONS:
    -p, --project <dir>   HTFL project folder (the one containing htfl.yaml).
                          Defaults to the current directory.
        --read-only       Serve the read tools only; refuse every mutation.
    -h, --help            Show this message.
    -V, --version         Show the version.
";

struct Args {
    project: PathBuf,
    read_only: bool,
}

/// Parsed from `args_os`, never from `args`: a project path on this author's
/// machine contains Japanese characters, and lossy conversion would mangle it.
fn parse_args() -> Result<Option<Args>, String> {
    let mut project: Option<PathBuf> = None;
    let mut read_only = false;
    let mut it = std::env::args_os().skip(1);

    while let Some(raw) = it.next() {
        match raw.to_str() {
            Some("-h") | Some("--help") => {
                print!("{USAGE}");
                return Ok(None);
            }
            Some("-V") | Some("--version") => {
                println!("foling-mcp {}", env!("CARGO_PKG_VERSION"));
                return Ok(None);
            }
            Some("--read-only") => read_only = true,
            Some("-p") | Some("--project") => {
                let value: OsString = it
                    .next()
                    .ok_or_else(|| "--project needs a directory".to_string())?;
                project = Some(PathBuf::from(value));
            }
            // A bare path is accepted so `foling-mcp .` does the obvious thing.
            _ if project.is_none() && !starts_with_dash(&raw) => {
                project = Some(PathBuf::from(raw));
            }
            other => {
                return Err(format!(
                    "unrecognised argument: {}",
                    other.unwrap_or("<non-unicode>")
                ))
            }
        }
    }

    let project = match project {
        Some(p) => p,
        None => std::env::current_dir().map_err(|e| e.to_string())?,
    };
    Ok(Some(Args { project, read_only }))
}

fn starts_with_dash(s: &OsString) -> bool {
    s.to_string_lossy().starts_with('-')
}

fn main() -> ExitCode {
    let args = match parse_args() {
        Ok(Some(a)) => a,
        Ok(None) => return ExitCode::SUCCESS,
        Err(e) => {
            eprintln!("foling-mcp: {e}\n\n{USAGE}");
            return ExitCode::FAILURE;
        }
    };

    let workspace = match Workspace::open(&args.project, args.read_only) {
        Ok(w) => w,
        Err(e) => {
            eprintln!("foling-mcp: {e}");
            return ExitCode::FAILURE;
        }
    };
    eprintln!(
        "foling-mcp {} serving {}{}",
        env!("CARGO_PKG_VERSION"),
        workspace.root().display(),
        if args.read_only { " (read-only)" } else { "" }
    );

    let server = Server::new(workspace);
    let stdin = std::io::stdin();
    let mut stdout = std::io::stdout();

    for line in stdin.lock().lines() {
        let line = match line {
            Ok(l) => l,
            // A decode error on one line should not end the session; the client
            // will time out that request and can carry on.
            Err(e) => {
                eprintln!("foling-mcp: stdin read error: {e}");
                continue;
            }
        };
        if line.trim().is_empty() {
            continue;
        }
        if let Some(response) = server.handle_line(&line) {
            if writeln!(stdout, "{response}").is_err() || stdout.flush().is_err() {
                // The client closed the pipe — that is a normal shutdown.
                break;
            }
        }
    }
    ExitCode::SUCCESS
}
