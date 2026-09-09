fn main() {
    configure_agent_asset();
    deploy_conpty_binaries();
    tauri_build::build()
}

/// Windows 开发构建时把侧载 ConPTY 组件复制到可执行文件目录。
/// portable-pty 通过 `LoadLibrary("conpty.dll")` 优先加载 exe 同目录的侧载版,
/// 用于归一化 TUI 的越界光标定位(修复 CJK 输入法候选框锚定行尾的漂移)。
/// 打包分发由 `tauri.windows.conf.json` 的 bundle.resources 覆盖。
fn deploy_conpty_binaries() {
    if std::env::var("CARGO_CFG_TARGET_OS").as_deref() != Ok("windows") {
        return;
    }
    println!("cargo:rerun-if-changed=conpty/conpty.dll");
    println!("cargo:rerun-if-changed=conpty/OpenConsole.exe");

    let manifest_dir =
        std::env::var("CARGO_MANIFEST_DIR").expect("CARGO_MANIFEST_DIR is set by Cargo");
    let manifest_dir = std::path::Path::new(&manifest_dir);
    // OUT_DIR = <target>/<profile>/build/<pkg>-<hash>/out,向上三级即 exe 所在目录
    let out_dir = std::path::PathBuf::from(std::env::var("OUT_DIR").expect("OUT_DIR is set by Cargo"));
    let Some(exe_dir) = out_dir.ancestors().nth(3) else {
        return;
    };

    for file in ["conpty.dll", "OpenConsole.exe"] {
        let from = manifest_dir.join("conpty").join(file);
        let to = exe_dir.join(file);
        if !from.is_file() {
            continue;
        }
        // 内容一致时跳过,避免每次构建触碰时间戳
        let needs_copy = match std::fs::read(&from) {
            Ok(bytes) => std::fs::read(&to).is_ok_and(|old| old != bytes),
            Err(_) => false,
        };
        if needs_copy || !to.is_file() {
            let _ = std::fs::copy(&from, &to);
        }
    }
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
