// 文件系统遍历的**共享排除规则**。
//
// 之前只有 `fs/search.rs` 有 `PRUNE_DIRS`，于是：
// - 搜索会剪掉 `node_modules` / `target` / `.git`
// - 文件树**不会**：装了 node_modules 的工作区，根目录里完整列出它，展开
//   再继续递归 —— 用户被迫在几万个条目里找自己的代码
// - watcher **不会**：`notify` 递归注册每一个子目录，Linux 上容易撞
//   `fs.inotify.max_user_watches`（默认 8192）直接 watch 失败；macOS 上
//   FSEvents 在构建期间事件洪水打满回调线程
//
// 三处必须是同一份规则，否则「搜得到但树里没有」「树里有但 watcher 不报」
// 这类不一致会一直让人以为是 bug。
use std::path::Path;

/// 任何遍历都不应进入的目录名。
///
/// 与 Rust 生态里 `.gitignore` 的默认约定保持一致：`node_modules` /
/// `target` / `dist` / `build` 都是构建产物目录，进入它们既没有信息量，
/// 又是性能和内存的主要来源。
pub(crate) const PRUNE_DIRS: &[&str] = &[
    "node_modules",
    ".git",
    ".hg",
    ".svn",
    "target",
    "dist",
    "build",
    "out",
    ".next",
    ".nuxt",
    ".turbo",
    ".svelte-kit",
    ".cache",
    ".parcel-cache",
    ".venv",
    "venv",
    "__pycache__",
    ".pytest_cache",
    ".mypy_cache",
    ".gradle",
    ".idea",
    ".vscode-test",
];

/// 单个路径段是否应被剪掉。
///
/// 只看**目录名**，且必须精确相等 —— `target` 会命中，但 `targeting.rs`
/// 不会。调用方需要先确认这是目录：同名文件（`build` 可执行文件、
/// `dist` 说明文件）不应被吞掉。
pub(crate) fn should_prune_dir_name(name: &str) -> bool {
    PRUNE_DIRS.contains(&name)
}

/// 一个目录是否应该被剪掉（按其文件名判断）。
#[cfg_attr(not(test), allow(dead_code))]
pub(crate) fn should_prune_dir_path(path: &Path) -> bool {
    path.file_name()
        .and_then(|name| name.to_str())
        .map(should_prune_dir_name)
        .unwrap_or(false)
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn prunes_the_usual_build_output_dirs() {
        for name in ["node_modules", "target", "dist", "build", ".git"] {
            assert!(should_prune_dir_name(name), "{name} should be pruned");
        }
    }

    #[test]
    fn matches_exactly_not_as_a_substring() {
        // `targeting.rs` / `build-tools` / `distributed` 都是正常源码目录。
        for name in [
            "targeting.rs",
            "build-tools",
            "distributed",
            "node_modules_old",
        ] {
            assert!(!should_prune_dir_name(name), "{name} must NOT be pruned");
        }
    }

    #[test]
    fn keeps_ordinary_source_dirs() {
        for name in ["src", "lib", "crates", "apps", "components", "src-tauri"] {
            assert!(!should_prune_dir_name(name), "{name} must be kept");
        }
    }

    #[test]
    fn judges_by_file_name_only() {
        assert!(should_prune_dir_path(Path::new("/repo/node_modules")));
        assert!(should_prune_dir_path(Path::new(
            "/repo/packages/app/target"
        )));
        assert!(!should_prune_dir_path(Path::new("/repo/src")));
    }
}
