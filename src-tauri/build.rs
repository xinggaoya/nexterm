fn main() {
    configure_agent_asset();
    deploy_conpty_binaries();
    sync_devtools_capability();
    embed_common_controls_manifest();
    if let Err(error) = tauri_build::try_build(
        tauri_build::Attributes::new()
            .windows_attributes(tauri_build::WindowsAttributes::new_without_app_manifest()),
    ) {
        panic!("failed to run tauri-build: {error:#}");
    }
}

/// 给**所有**产物（应用二进制、lib 单测 harness、集成测试）嵌入同一份
/// Common Controls v6 的 SxS manifest。
///
/// ## 为什么需要
///
/// Rust 的 test harness 不带 manifest，而 Common Controls v6 只有在 manifest
/// 声明后才会被加载。缺了它，链接了 `TaskDialogIndirect`（仅 v6 导出）的
/// 测试二进制会在**进程启动时**失败：
///
/// ```text
/// STATUS_ENTRYPOINT_NOT_FOUND (0xc0000139)
/// ```
///
/// 加载器会绑定到 System32 里那个不含该导出的 comctl32 v5，于是
/// `cargo test` 一个用例都跑不了（表现为 "process didn't exit successfully"）。
///
/// ## 为什么不用 tauri-build 自带的 manifest
///
/// tauri-build 默认也会给**应用二进制**嵌一份 manifest（内容与本文件一致）。
/// 两份同时存在会撞成 `CVT1100: duplicate resource. type:MANIFEST`。
/// 所以这里用 `Attributes::new_without_app_manifest()` 让 tauri-build 不要再
/// 塞它那份，改由本函数统一给所有产物嵌同一份 —— 应用行为不变，
/// 测试二进制从此也能启动。
fn embed_common_controls_manifest() {
    let manifest_dir =
        std::env::var("CARGO_MANIFEST_DIR").expect("CARGO_MANIFEST_DIR is set by Cargo");
    let manifest_path = std::path::Path::new(&manifest_dir).join("manifest.xml");
    if !manifest_path.is_file() {
        return;
    }
    println!("cargo:rerun-if-changed=manifest.xml");
    println!("cargo:rustc-link-arg=/MANIFEST:EMBED");
    println!(
        "cargo:rustc-link-arg=/MANIFESTINPUT:{}",
        manifest_path.display()
    );

    // link.exe 通过 PATH 找 mt.exe（真正把 manifest 嵌进 PE 的工具）。
    // Windows SDK 的 bin 目录通常不在 PATH 上，于是 /MANIFEST:EMBED 静默失效 ——
    // 产物里根本没有 manifest，测试二进制启动即 STATUS_ENTRYPOINT_NOT_FOUND。
    if let Some(mt_dir) = find_mt_dir() {
        let path = std::env::var("PATH").unwrap_or_default();
        let joined = if path.is_empty() {
            mt_dir.to_string_lossy().into_owned()
        } else {
            format!("{};{}", mt_dir.to_string_lossy(), path)
        };
        println!("cargo:rustc-env=PATH={}", joined);
    }
}

/// 找到 Windows SDK 里的 `mt.exe` 所在目录（x64 优先）。
fn find_mt_dir() -> Option<std::path::PathBuf> {
    if std::env::var("CARGO_CFG_TARGET_OS").as_deref() != Ok("windows") {
        return None;
    }
    let program_files = std::env::var("ProgramFiles(x86)")
        .or_else(|_| std::env::var("ProgramFiles"))
        .ok()?;
    let kits = std::path::Path::new(&program_files)
        .join("Windows Kits")
        .join("10")
        .join("bin");
    let mut candidates: Vec<std::path::PathBuf> = std::fs::read_dir(&kits)
        .ok()?
        .filter_map(|entry| entry.ok())
        .map(|entry| entry.path().join("x64"))
        .collect();
    // 版本号目录按字典序排，"10.0.26100.0" 之类要新的优先。
    candidates.sort_by_key(|path| {
        path.parent()
            .and_then(|p| p.file_name())
            .map(|n| n.to_string_lossy().into_owned())
            .unwrap_or_default()
    });
    candidates.reverse();
    candidates
        .into_iter()
        .find(|dir| dir.join("mt.exe").is_file())
}

/// 让 capability 与「实际编译进来的插件」保持一致。
///
/// `tauri-plugin-devtools-app` 是可选依赖（feature `crabnebula-devtools`）。
/// 它不在时，`devtools-app:allow-toggle` 这条 permission 不被 Tauri 识别，
/// 构建会直接失败：
///
/// ```text
/// Permission devtools-app:allow-toggle not found, expected one of ...
/// ```
///
/// 而它在时又必须显式放行 `toggle`，否则 `removeUnusedCommands` 会把
/// `plugin:devtools-app|toggle` 从 webview 的可用命令表里剔除，
/// `Ctrl+Shift+M` 与设置页入口都会失效。
///
/// 所以这里按 feature 生成 `capabilities/crabnebula-devtools.json`：
/// 开 feature 时写、关 feature 时删（生成物不进版本库）。
fn sync_devtools_capability() {
    println!("cargo:rerun-if-changed=capabilities/default.json");

    let manifest_dir =
        std::env::var("CARGO_MANIFEST_DIR").expect("CARGO_MANIFEST_DIR is set by Cargo");
    let manifest_dir = std::path::Path::new(&manifest_dir);
    let generated = manifest_dir
        .join("capabilities")
        .join("crabnebula-devtools.json");

    if std::env::var_os("CARGO_FEATURE_CRABNEBULA_DEVTOOLS").is_some() {
        let content = r#"{
  "identifier": "crabnebula-devtools-capability",
  "description": "Only generated when the `crabnebula-devtools` feature is on.",
  "windows": [
    "main",
    "workspace-*"
  ],
  "permissions": [
    "devtools-app:allow-toggle"
  ]
}
"#;
        if std::fs::read_to_string(&generated).ok().as_deref() != Some(content) {
            let _ = std::fs::write(&generated, content);
        }
    } else if generated.exists() {
        // 上一次带 feature 构建留下的产物：删掉，否则会引用不存在的 permission。
        let _ = std::fs::remove_file(&generated);
    }
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
    let out_dir =
        std::path::PathBuf::from(std::env::var("OUT_DIR").expect("OUT_DIR is set by Cargo"));
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
    println!("cargo:rustc-env=NEXTERM_AGENT_ASSET={}", asset.display());
}
