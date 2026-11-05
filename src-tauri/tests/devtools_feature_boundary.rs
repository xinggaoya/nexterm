//! CrabNebula DevTools 集成的**边界测试**。
//!
//! 背景（见 `docs/architecture/06-crabnebula-devtools.md` §3.1）：
//! `tauri-plugin-devtools` 依赖 `tauri/tracing` feature。该 feature 会把
//! `tauri-runtime-wry` 的 `eval_script` 从 fire-and-forget 改成「发消息给
//! WebView2 UI 线程并阻塞等回执」，于是任何在 IPC handler 里 `app.emit` 的
//! 命令都会与 WebView2 的 `WebResourceRequested` 回调互等 —— **永久死锁**
//! （窗口"未响应"，所有 IPC 停摆）。
//!
//! 所以这两个依赖必须始终是**可选**的，且默认 feature 集合里不能带上
//! `crabnebula-devtools`。否则一次「顺手把依赖改成非可选」就会把死锁
//! 悄悄带进正式构建。

use std::path::Path;

fn manifest() -> String {
    let path = Path::new(env!("CARGO_MANIFEST_DIR")).join("Cargo.toml");
    std::fs::read_to_string(&path).unwrap_or_else(|error| {
        panic!("failed to read {}: {error}", path.display());
    })
}

/// 取某个依赖行（形如 `name = { ... }`）。
fn dependency_line(source: &str, name: &str) -> Option<String> {
    source
        .lines()
        .map(str::trim)
        .find(|line| line.starts_with(name) && line.contains('=') && !line.starts_with('#'))
        .map(str::to_owned)
}

#[test]
fn crabnebula_plugins_are_optional_dependencies() {
    let source = manifest();
    for name in ["tauri-plugin-devtools", "tauri-plugin-devtools-app"] {
        let line = dependency_line(&source, name)
            .unwrap_or_else(|| panic!("{name} should still be declared in Cargo.toml"));
        assert!(
            line.contains("optional = true"),
            "{name} must stay optional: it pulls in `tauri/tracing`, whose blocking \
       `eval_script` deadlocks the app against the WebView2 \
       `WebResourceRequested` handler. got: {line}"
        );
    }
}

#[test]
fn crabnebula_feature_is_not_enabled_by_default() {
    let source = manifest();
    let features_section = source
        .split("[features]")
        .nth(1)
        .and_then(|section| section.split("\n[").next())
        .unwrap_or_default();
    let default_line = features_section
        .lines()
        .map(str::trim)
        .find(|line| line.starts_with("default") && line.contains('='));
    if let Some(default_line) = default_line {
        assert!(
            !default_line.contains("crabnebula-devtools"),
            "the `crabnebula-devtools` feature must not be in the default feature set: \
       it enables the backend instrumentation, which deadlocks the app \
       (see docs/architecture/06-crabnebula-devtools.md §3.1). got: {default_line}"
        );
    }
    // 没有显式 `default = [...]` 时，cargo 的默认 feature 集合为空 —— 同样安全。
}

#[test]
fn capability_generated_file_is_not_committed() {
    // capability 由 build.rs 按 feature 生成（含 `devtools-app:allow-toggle`，
    // 该 permission 只有插件被编译进来时才存在）。它必须不进版本库。
    let gitignore = Path::new(env!("CARGO_MANIFEST_DIR"))
        .join("..")
        .join(".gitignore")
        .to_string_lossy()
        .into_owned();
    let content = std::fs::read_to_string(&gitignore).unwrap_or_default();
    assert!(
        content.contains("src-tauri/capabilities/crabnebula-devtools.json"),
        "the generated capability must be gitignored"
    );
}
