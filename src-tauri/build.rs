fn main() {
    configure_wsl_watcher_helper_asset();
    tauri_build::build()
}

fn configure_wsl_watcher_helper_asset() {
    println!("cargo:rustc-check-cfg=cfg(nexterm_wsl_watcher_helper_asset)");
    println!("cargo:rerun-if-env-changed=NEXTERM_WSL_WATCHER_HELPER");
    println!("cargo:rerun-if-changed=target/x86_64-unknown-linux-musl/release/nexterm-wsl-watcher");

    let manifest_dir =
        std::env::var("CARGO_MANIFEST_DIR").expect("CARGO_MANIFEST_DIR is set by Cargo");
    let explicit = std::env::var("NEXTERM_WSL_WATCHER_HELPER").ok();
    let default = std::path::Path::new(&manifest_dir)
        .join("target")
        .join("x86_64-unknown-linux-musl")
        .join("release")
        .join("nexterm-wsl-watcher");

    let Some(asset) = explicit
        .map(std::path::PathBuf::from)
        .or_else(|| default.exists().then_some(default))
    else {
        return;
    };
    if !asset.is_file() {
        return;
    }

    println!("cargo:rustc-cfg=nexterm_wsl_watcher_helper_asset");
    println!(
        "cargo:rustc-env=NEXTERM_WSL_WATCHER_HELPER_ASSET={}",
        asset.display()
    );
}
