//! Windows Common Controls v6 的 SxS manifest **链接参数平台边界**测试。
//!
//! 背景：`src-tauri/build.rs` 给所有产物（应用二进制、lib 单测 harness、
//! 集成测试）嵌入同一份 manifest，让链接了 `TaskDialogIndirect`（仅 v6 导出）
//! 的测试二进制能在进程启动时正常加载 comctl32 v6。
//!
//! 嵌入方式是 MSVC `link.exe` 专有的链接参数：
//!
//! ```text
//! /MANIFEST:EMBED
//! /MANIFESTINPUT:<path>
//! ```
//!
//! 这两个参数**只有 Windows 认**。Linux / macOS 的链接器（cc / rust-lld）
//! 会把它们当成**普通输入文件路径**，于是链接失败：
//!
//! ```text
//! rust-lld: error: cannot open /MANIFEST:EMBED: No such file or directory
//! ```
//!
//! 这个坑只在 Linux CI 上暴露（本地 Windows 构建永远绿），所以必须有边界测试
//! 守着：平台判断必须**先于**链接参数发出。

use std::path::Path;

fn build_script() -> String {
    let path = Path::new(env!("CARGO_MANIFEST_DIR")).join("build.rs");
    std::fs::read_to_string(&path).unwrap_or_else(|error| {
        panic!("failed to read {}: {error}", path.display());
    })
}

/// 取出 `fn <name>(...) { ... }` 的函数体。
fn function_body(source: &str, name: &str) -> String {
    let start = source
        .find(&format!("fn {name}("))
        .unwrap_or_else(|| panic!("build.rs should define `fn {name}(...)`"));
    let rest = &source[start..];
    let open = rest
        .find('{')
        .unwrap_or_else(|| panic!("`fn {name}(...)` should have a body"));
    let mut depth = 0usize;
    for (offset, ch) in rest[open..].char_indices() {
        match ch {
            '{' => depth += 1,
            '}' => {
                depth -= 1;
                if depth == 0 {
                    return rest[open..open + offset + 1].to_string();
                }
            }
            _ => {}
        }
    }
    panic!("`fn {name}(...)` body is not balanced");
}

#[test]
fn manifest_link_args_are_gated_by_target_os() {
    let body = function_body(&build_script(), "embed_common_controls_manifest");

    let platform_check = body.find("CARGO_CFG_TARGET_OS").unwrap_or_else(|| {
        panic!(
            "embed_common_controls_manifest must check the target OS: \
       `/MANIFEST:EMBED` and `/MANIFESTINPUT:` are MSVC link.exe arguments, and the \
       Linux/macOS linkers treat them as plain input file paths and fail the link"
        )
    });

    // 找**真正发出参数**的那行（`rustc-link-arg=...`），而不是注释里提到的字样。
    let link_arg = body
        .find("rustc-link-arg=/MANIFEST:EMBED")
        .unwrap_or_else(|| {
            panic!("embed_common_controls_manifest should emit the manifest link args")
        });

    assert!(
        platform_check < link_arg,
        "the target-OS check must come BEFORE the manifest link args are emitted: \
       otherwise Linux/macOS builds get `/MANIFEST:EMBED` passed to cc/rust-lld and fail \
       with 'cannot open /MANIFEST:EMBED: No such file or directory'"
    );
}

#[test]
fn manifest_link_args_are_not_emitted_on_non_windows() {
    let body = function_body(&build_script(), "embed_common_controls_manifest");

    // 早退判断必须在两个链接参数之前，且只认 windows。
    let guard = body.find("\"windows\"").unwrap_or_else(|| {
        panic!("embed_common_controls_manifest must restrict the manifest to windows targets")
    });
    let link_arg = body
        .find("rustc-link-arg=/MANIFEST:EMBED")
        .expect("embed_common_controls_manifest should emit the manifest link args");

    assert!(
        guard < link_arg,
        "the windows-only guard must come before the manifest link args"
    );
}
