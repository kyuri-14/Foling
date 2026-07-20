// SPDX-License-Identifier: AGPL-3.0-or-later
// Copyright (C) 2026 大松雄斗

//! Model Context Protocol server for Foling.
//!
//! Foling already lets an agent loose on a project as plain files (PLUGINS →
//! AI). This module is the other half of that story: instead of an agent
//! guessing at folder names and YAML shapes, it calls the same functions the
//! editor calls, so `NN_` numbering, config validity and build semantics are
//! guaranteed by the application rather than by the model's memory.
//!
//! Two transports share one [`server::Server`]:
//!
//!   * `foling-mcp`, a standalone binary speaking newline-delimited JSON-RPC
//!     over stdio — what `.mcp.json` in an agent CLI points at. Works with the
//!     editor closed.
//!   * the running editor, which serves the same dispatch over HTTP on its
//!     preview server and refreshes the open tree after a write.

pub mod server;
pub mod tools;
pub mod workspace;

pub use server::Server;
pub use workspace::Workspace;
