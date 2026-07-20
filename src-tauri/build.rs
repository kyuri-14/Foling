// SPDX-License-Identifier: AGPL-3.0-or-later
// Copyright (C) 2026 大松雄斗

fn main() {
    // tauri-build embeds the app icon into the executable, but it does not ask
    // cargo to watch the icon files. Replace a logo and cargo sees no reason to
    // re-run this script, so the *old* icon stays in the binary until some
    // unrelated source change happens to force a rebuild — which presents
    // exactly as "the new icon didn't apply".
    //
    // Cargo watches a path recursively, so one line covers every platform.
    println!("cargo:rerun-if-changed=icons");

    tauri_build::build()
}
