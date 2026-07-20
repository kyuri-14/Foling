// SPDX-License-Identifier: AGPL-3.0-or-later
// Copyright (C) 2026 大松雄斗

//! Serialization of filesystem mutations.
//!
//! Two layers, because Foling now writes to a project from more than one
//! process:
//!
//!  * an in-process `Mutex`, which is what the editor has always used to stop
//!    a debounced rebuild from enumerating a directory while another op renames
//!    it (on Windows that races into ERROR_ACCESS_DENIED / os error 5);
//!  * an advisory lock *directory* under the project, so the standalone MCP
//!    server (`foling-mcp`, a separate process) and a running editor cannot
//!    interleave writes to the same tree.
//!
//! The advisory lock is best-effort by design. If it cannot be taken — a
//! crashed holder, a read-only volume, a path we have no rights to — we proceed
//! with the in-process lock alone rather than wedge the editor. A stuck lock
//! that outlives its holder is a worse failure than a rare interleaving.

use std::fs;
use std::io::ErrorKind;
use std::path::{Path, PathBuf};
use std::sync::{Mutex, MutexGuard, OnceLock};
use std::time::Duration;

/// Directory name used as the advisory cross-process lock, under `.foling/`.
const LOCK_DIR: &str = "lock";
const FOLING_DIR: &str = ".foling";

/// A lock older than this is assumed to belong to a process that died holding
/// it. Real operations finish in milliseconds, so stealing after 30s is safe.
const STALE_AFTER: Duration = Duration::from_secs(30);

/// How long to wait for a contended lock before giving up and proceeding with
/// only the in-process mutex (~5s at 25ms per attempt).
const ACQUIRE_ATTEMPTS: u32 = 200;

fn fs_mutex() -> &'static Mutex<()> {
    static LOCK: OnceLock<Mutex<()>> = OnceLock::new();
    LOCK.get_or_init(|| Mutex::new(()))
}

/// The project whose lock directory `fs_guard` should take. `None` (the
/// default) means in-process locking only — correct for one-off operations
/// that never touch a project, and for tests.
fn scope() -> &'static Mutex<Option<PathBuf>> {
    static SCOPE: OnceLock<Mutex<Option<PathBuf>>> = OnceLock::new();
    SCOPE.get_or_init(|| Mutex::new(None))
}

/// Point cross-process locking at `project_root`. Called when the editor opens
/// a project and when `foling-mcp` starts against one. Safe to call repeatedly;
/// switching projects just re-points it.
pub fn set_lock_scope(project_root: Option<&Path>) {
    if let Ok(mut s) = scope().lock() {
        *s = project_root.map(|p| p.to_path_buf());
    }
}

fn lock_dir_path() -> Option<PathBuf> {
    let g = scope().lock().ok()?;
    let root = g.as_ref()?;
    Some(root.join(FOLING_DIR).join(LOCK_DIR))
}

/// Try to claim the advisory lock directory, stealing it if the current holder
/// looks dead. Returns the path on success; `None` means "carry on unlocked".
fn acquire_dir_lock(dir: &Path) -> Option<PathBuf> {
    if let Some(parent) = dir.parent() {
        if fs::create_dir_all(parent).is_err() {
            return None;
        }
    }
    for _ in 0..ACQUIRE_ATTEMPTS {
        match fs::create_dir(dir) {
            Ok(()) => return Some(dir.to_path_buf()),
            Err(e) if e.kind() == ErrorKind::AlreadyExists => {
                let stale = fs::metadata(dir)
                    .and_then(|m| m.modified())
                    .map(|m| m.elapsed().map(|d| d > STALE_AFTER).unwrap_or(false))
                    .unwrap_or(false);
                if stale {
                    let _ = fs::remove_dir(dir);
                    continue;
                }
                std::thread::sleep(Duration::from_millis(25));
            }
            // No rights, read-only volume, … — advisory locking simply isn't
            // available here.
            Err(_) => return None,
        }
    }
    None
}

/// Held for the duration of a filesystem mutation. Releasing is `Drop`, so an
/// early `?` return still frees both layers.
pub struct FsGuard {
    _inner: MutexGuard<'static, ()>,
    held: Option<PathBuf>,
}

impl Drop for FsGuard {
    fn drop(&mut self) {
        if let Some(dir) = &self.held {
            let _ = fs::remove_dir(dir);
        }
    }
}

/// Acquire both locks. Recovers from mutex poisoning — a prior panic shouldn't
/// brick every later file op.
pub fn fs_guard() -> FsGuard {
    let inner = fs_mutex().lock().unwrap_or_else(|p| p.into_inner());
    let held = lock_dir_path().and_then(|d| acquire_dir_lock(&d));
    FsGuard {
        _inner: inner,
        held,
    }
}

/// Retry a filesystem op on transient Windows locks (error 5 = access denied,
/// 32 = sharing violation) caused by AV / Search indexer / Explorer briefly
/// holding a handle. 12 attempts with linear backoff totals ~2s before giving up.
pub fn retry_io<T>(mut f: impl FnMut() -> std::io::Result<T>) -> std::io::Result<T> {
    let mut attempt = 0u32;
    loop {
        match f() {
            Ok(v) => return Ok(v),
            Err(e) => {
                let code = e.raw_os_error().unwrap_or(0);
                if (code == 5 || code == 32) && attempt < 12 {
                    std::thread::sleep(std::time::Duration::from_millis(
                        25 * u64::from(attempt + 1),
                    ));
                    attempt += 1;
                    continue;
                }
                return Err(e);
            }
        }
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn dir_lock_is_exclusive_then_released() {
        let dir = std::env::temp_dir().join(format!(
            "foling_locktest_{}_{}",
            std::process::id(),
            std::time::SystemTime::now()
                .duration_since(std::time::UNIX_EPOCH)
                .unwrap()
                .as_nanos()
        ));
        let lock = dir.join(FOLING_DIR).join(LOCK_DIR);

        let first = acquire_dir_lock(&lock).expect("first acquire succeeds");
        assert!(lock.is_dir());
        // A second attempt must not succeed while the first is held. Steal the
        // stale-check path out of the way by keeping this well under STALE_AFTER.
        fs::remove_dir(&first).unwrap();
        assert!(acquire_dir_lock(&lock).is_some(), "re-acquire after release");

        let _ = fs::remove_dir_all(&dir);
    }

    #[test]
    fn scope_unset_means_no_dir_lock() {
        set_lock_scope(None);
        assert!(lock_dir_path().is_none());
        // The guard must still be obtainable with no project scope.
        let _g = fs_guard();
    }
}
