//! 浏览器调试桥（`tauri-plugin-web-dev-bridge`）集成的**边界测试**。
//!
//! 背景（见 `docs/architecture/07-web-dev-bridge.md`）：
//! 调试桥在应用进程内开一个只监听 `127.0.0.1` 的 HTTP 服务，把浏览器发来的
//! `POST /invoke` 合成为一条真实的 Tauri IPC 消息投喂给**本进程**。
//!
//! 换句话说，桥一旦启动，本机就多了一个能写文件、起进程、走 SSH 的 HTTP 端点。
//! 所以它必须满足两条硬约束：
//!
//! 1. 依赖始终是**可选**的，feature 默认不在 cargo 的默认 feature 集合里 ——
//!    否则一次「顺手把 optional 删掉」就会把完整的 IPC 能力面悄悄带进正式构建。
//! 2. git 依赖必须锁 **rev**（commit）而不是 branch/tag —— 上游仓库还在动，
//!    锁分支等于每次构建都可能拉进未审查的改动。

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
fn web_dev_bridge_dependency_is_optional() {
    let source = manifest();
    let line = dependency_line(&source, "tauri-plugin-web-dev-bridge")
        .unwrap_or_else(|| panic!("tauri-plugin-web-dev-bridge should be declared in Cargo.toml"));
    assert!(
        line.contains("optional = true"),
        "tauri-plugin-web-dev-bridge must stay optional: the bridge exposes the app's full \
       IPC surface (file writes, process spawning, SSH) on 127.0.0.1, so it must only \
       ever be compiled in when the `web-dev-bridge` feature is explicitly requested. got: {line}"
    );
}

#[test]
fn web_dev_bridge_feature_is_not_enabled_by_default() {
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
            !default_line.contains("web-dev-bridge"),
            "the `web-dev-bridge` feature must not be in the default feature set: the \
       bridge must be opt-in. got: {default_line}"
        );
    }
    // 没有显式 `default = [...]` 时，cargo 的默认 feature 集合为空 —— 同样安全。
}

#[test]
fn web_dev_bridge_git_dependency_is_pinned_to_a_revision() {
    let source = manifest();
    let line = dependency_line(&source, "tauri-plugin-web-dev-bridge")
        .unwrap_or_else(|| panic!("tauri-plugin-web-dev-bridge should be declared in Cargo.toml"));
    assert!(
        line.contains("rev = "),
        "the git dependency must be pinned to a revision (rev), otherwise every build \
       may pull in unreviewed upstream changes. got: {line}"
    );
    assert!(
        !line.contains("branch = ") && !line.contains("tag = "),
        "the git dependency must not track a branch or tag: it must be pinned to a \
       specific commit. got: {line}"
    );
}
