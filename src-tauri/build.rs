fn main() {
    configure_agent_asset();
    tauri_build::build()
}

/// nexterm-agent 的 musl 二进制探测逻辑与 watcher helper 一致:
/// 优先 `NEXTERM_AGENT` 环境变量,否则找默认 musl 产物路径;找到即内嵌。
fn configure_agent_asset() {
    println!("cargo:rustc-check-cfg=cfg(nexterm_agent_asset)");
    println!("cargo:rerun-if-env-changed=NEXTERM_AGENT");
    println!("cargo:rerun-if-changed=target/x86_64-unknown-linux-musl/release/nexterm-agent");

    let manifest_dir =
        std::env::var("CARGO_MANIFEST_DIR").expect("CARGO_MANIFEST_DIR is set by Cargo");
    let explicit = std::env::var("NEXTERM_AGENT").ok();
    let default = std::path::Path::new(&manifest_dir)
        .join("target")
        .join("x86_64-unknown-linux-musl")
        .join("release")
        .join("nexterm-agent");

    let Some(asset) = explicit
        .map(std::path::PathBuf::from)
        .or_else(|| default.exists().then_some(default))
    else {
        return;
    };
    if !asset.is_file() {
        return;
    }

    println!("cargo:rustc-cfg=nexterm_agent_asset");
    println!(
        "cargo:rustc-env=NEXTERM_AGENT_ASSET={}",
        asset.display()
    );
}
