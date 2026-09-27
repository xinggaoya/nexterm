//! 搬运语义（移动 / 复制 / 冲突策略）的**唯一实现**。
//!
//! 同一套语义要在三个地方跑：
//!
//! - 本地工作区 —— 宿主进程直接操作本机文件系统；
//! - WSL 工作区 —— `nexterm-agent` 在发行版内操作 Linux 文件系统；
//! - SSH 工作区 —— `nexterm-agent` 在远端主机内操作远端文件系统。
//!
//! 三者的差别只是"代码在哪个进程里跑"，判重、改名、覆盖、跨设备回落、
//! 符号链接处理这些**规则**完全一致。把规则放在这里，主 crate 与 agent
//! crate 各自调用同一份函数，避免第三次 `copy_dir_recursive` 漂移出
//! 第三种符号链接行为（历史上主 crate 与 agent 的实现就不一致）。
//!
//! 本 crate 只负责规则，不负责 IPC，也不做工作区路径解析（那是调用方的
//! 职责：`resolve_path` 把用户视角路径翻成本机路径，WSL/SSH 则原样传
//! Linux 路径进来）。

use std::path::{Path, PathBuf};

use serde::{Deserialize, Serialize};

/// 自动改名时最多尝试的目标名序号上限。超过就报冲突错误，避免病态输入
/// （比如目录里已经有 10000 个 `copy`）把循环跑成死循环。
const MAX_RENAME_ATTEMPTS: usize = 100;

/// 单条搬运任务。`from` / `to` 均为调用方已解析好的真实路径。
#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct TransferItem {
    pub from: String,
    pub to: String,
}

/// 目标已存在时的处理策略。
#[derive(Debug, Clone, Copy, PartialEq, Eq, Default, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub enum ConflictPolicy {
    /// 覆盖：先删后写。目标若是目录会递归删除，**不可逆**。
    Overwrite,
    /// 跳过：该条记入 `skipped`，不产生任何写入。
    Skip,
    /// 自动改名：`foo.ext` → `foo copy.ext` → `foo copy 2.ext`。
    #[default]
    Rename,
}

#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct TransferFailure {
    pub from: String,
    pub to: String,
    pub error: String,
}

/// 一条搬运任务的落地结果。
#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub enum ItemOutcome {
    /// 按请求的目标路径完成。
    Completed,
    /// 因 `Skip` 策略主动跳过。
    Skipped,
    /// 完成，但因跨设备回落（copy + delete）完成 —— 语义上是"移动"，
    /// 可中途失败留下双份，调用方要区别提示。
    CrossDevice,
}

/// 批量搬运的结果。多选拖拽时"一部分成功一部分失败"是常态，所以必须
/// 逐条回报，不能用 `Result<(), String>` 表达。
#[derive(Debug, Clone, Default, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct TransferResult {
    pub completed: Vec<TransferItem>,
    pub skipped: Vec<TransferItem>,
    pub failed: Vec<TransferFailure>,
    /// 跨设备回落完成的项（`from`/`to` 均为最终落点）。
    pub cross_device: Vec<TransferItem>,
    /// 非致命告警：无法重建的符号链接等。
    pub warnings: Vec<String>,
}

impl TransferResult {
    fn record(&mut self, item: &TransferItem, outcome: ItemOutcome) {
        match outcome {
            ItemOutcome::Completed => self.completed.push(item.clone()),
            ItemOutcome::Skipped => self.skipped.push(item.clone()),
            ItemOutcome::CrossDevice => self.cross_device.push(item.clone()),
        }
    }
}

/// `child` 是否位于 `parent` 之内（含相等）。
///
/// 搬运防自噬的第一道闸：把目录拖进它自己的子目录时，copy + delete 的
/// 跨设备回落会把源目录一路吞掉。
pub fn is_inside(child: &Path, parent: &Path) -> bool {
    child == parent || child.starts_with(parent)
}

/// 跨设备移动的错误判定。
///
/// `std::io::ErrorKind::CrossesDevices` 是稳定后才有的变体，且部分平台
/// 的错误码映射并不一致（Linux `EXDEV`=18，Windows
/// `ERROR_NOT_SAME_DEVICE`=17），所以这里直接比 `raw_os_error`。
pub fn is_cross_device_error(error: &std::io::Error) -> bool {
    matches!(error.raw_os_error(), Some(17) | Some(18))
        || error.kind() == std::io::ErrorKind::CrossesDevices
}

/// 去掉扩展名与扩展名本身（`a.tar.gz` → (`a.tar`, `.gz`)，无扩展名时
/// 扩展名为空串）。
fn split_ext(name: &str) -> (&str, &str) {
    match name.rfind('.') {
        // `.gitignore` 这类点开头的名字整体当词干，避免被拆成 `` + `.gitignore`
        Some(0) | None => (name, ""),
        Some(dot) => (&name[..dot], &name[dot..]),
    }
}

/// 自动改名序列：`foo.ext` → `foo copy.ext` → `foo copy 2.ext` → ...
///
/// `exists` 由调用方注入，这样同一份命名规则能跑在本机、WSL 与远端
/// 文件系统上（后者根本没有本地 `Path::exists` 可用）。
pub fn next_free_target(
    desired: &Path,
    mut exists: impl FnMut(&Path) -> bool,
) -> Option<PathBuf> {
    if !exists(desired) {
        return Some(desired.to_path_buf());
    }
    let parent = desired.parent().unwrap_or_else(|| Path::new(""));
    let name = desired
        .file_name()
        .map(|n| n.to_string_lossy().into_owned())
        .unwrap_or_default();
    let (stem, ext) = split_ext(&name);
    for n in 0..MAX_RENAME_ATTEMPTS {
        let candidate = if n == 0 {
            parent.join(format!("{stem} copy{ext}"))
        } else {
            parent.join(format!("{stem} copy {}{ext}", n + 1))
        };
        if !exists(&candidate) {
            return Some(candidate);
        }
    }
    None
}

/// 已存在目标在给定策略下的处置方式。
enum Resolution {
    /// 目标为空，直接落。
    Fresh,
    /// 目标已存在且策略为跳过。
    Skip,
    /// 目标已存在且策略为覆盖：先删。
    Remove,
    /// 目标已存在且策略为改名：换到 `target`。
    Rename(PathBuf),
}

fn resolve_conflict(
    desired: &Path,
    policy: ConflictPolicy,
    exists: &mut impl FnMut(&Path) -> bool,
) -> Result<Resolution, String> {
    if !exists(desired) {
        return Ok(Resolution::Fresh);
    }
    match policy {
        ConflictPolicy::Skip => Ok(Resolution::Skip),
        ConflictPolicy::Overwrite => Ok(Resolution::Remove),
        ConflictPolicy::Rename => next_free_target(desired, &mut *exists)
            .map(Resolution::Rename)
            .ok_or_else(|| {
                format!("no free copy name for {} after {MAX_RENAME_ATTEMPTS} attempts", desired.display())
            }),
    }
}

/// 递归复制目录：符号链接按链接本身重建（不跟随目标），Windows 无
/// symlink 重建权限时跳过并记 warning。
fn copy_dir_recursive(
    src: &Path,
    dst: &Path,
    warnings: &mut Vec<String>,
) -> Result<(), String> {
    std::fs::create_dir_all(dst)
        .map_err(|e| format!("mkdir {}: {e}", dst.display()))?;
    let entries = std::fs::read_dir(src)
        .map_err(|e| format!("readdir {}: {e}", src.display()))?;
    for entry in entries {
        let entry = entry.map_err(|e| e.to_string())?;
        let file_type = entry.file_type().map_err(|e| e.to_string())?;
        let child_src = entry.path();
        let child_dst = dst.join(entry.file_name());
        if file_type.is_symlink() {
            copy_symlink(&child_src, &child_dst, warnings);
        } else if file_type.is_dir() {
            copy_dir_recursive(&child_src, &child_dst, warnings)?;
        } else if file_type.is_file() {
            std::fs::copy(&child_src, &child_dst)
                .map_err(|e| format!("copy {}: {e}", child_src.display()))?;
        }
        // socket / fifo / device：没有等价物可复制，静默跳过即可。
    }
    Ok(())
}

#[cfg(unix)]
fn copy_symlink(src: &Path, dst: &Path, warnings: &mut Vec<String>) {
    match std::fs::read_link(src) {
        Ok(target) => {
            if let Err(e) = std::os::unix::fs::symlink(&target, dst) {
                warnings.push(format!("symlink {} -> {}: {e}", src.display(), dst.display()));
            }
        }
        Err(e) => warnings.push(format!("readlink {}: {e}", src.display())),
    }
}

#[cfg(not(unix))]
fn copy_symlink(src: &Path, dst: &Path, warnings: &mut Vec<String>) {
    // Windows 上普通用户的 CreateSymbolicLink 权限通常缺失（需要开发者
    // 模式或 SeCreateSymbolicLinkPrivilege），静默跳过比失败更符合预期。
    let _ = (src, dst);
    warnings.push(format!(
        "skipped symlink {} (symbolic links are not recreated on this platform)",
        src.display()
    ));
}

/// 复制单个条目（文件 / 目录 / 符号链接），`to` 必须不存在。
pub fn copy_path(src: &Path, dst: &Path, warnings: &mut Vec<String>) -> Result<(), String> {
    // symlink_metadata：不跟随链接，才能识别出"指向目录的符号链接"并
    // 整条重建，而不是把目标目录的内容复制进来。
    let meta = std::fs::symlink_metadata(src)
        .map_err(|e| format!("stat {}: {e}", src.display()))?;
    let file_type = meta.file_type();
    if file_type.is_symlink() {
        copy_symlink(src, dst, warnings);
        return Ok(());
    }
    if file_type.is_dir() {
        copy_dir_recursive(src, dst, warnings)
    } else {
        std::fs::copy(src, dst).map(|_| ()).map_err(|e| {
            format!("copy {} -> {}: {e}", src.display(), dst.display())
        })
    }
}

fn remove_path(path: &Path) -> Result<(), String> {
    let meta = std::fs::symlink_metadata(path)
        .map_err(|e| format!("stat {}: {e}", path.display()))?;
    // 用 symlink_metadata 判型：指向目录的 symlink 必须走 remove_file，
    // 否则 remove_dir_all 会顺着链接把目标目录内容删掉。
    let result = if meta.file_type().is_dir() {
        std::fs::remove_dir_all(path)
    } else {
        std::fs::remove_file(path)
    };
    result.map_err(|e| format!("remove {}: {e}", path.display()))
}

/// 搬运模式。
#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub enum TransferMode {
    /// 移动：先 `rename`，跨设备时回落 copy + delete。
    Move,
    /// 复制。
    Copy,
}

impl TransferMode {
    fn verb(self) -> &'static str {
        match self {
            TransferMode::Move => "move",
            TransferMode::Copy => "copy",
        }
    }
}

fn transfer_one(
    from: &Path,
    to: &Path,
    policy: ConflictPolicy,
    mode: TransferMode,
    warnings: &mut Vec<String>,
) -> Result<(ItemOutcome, PathBuf), String> {
    // 防自噬：目标落在源内部时，跨设备回落（copy + delete）会把源一路吞掉。
    if mode == TransferMode::Move && is_inside(to, from) {
        return Err(format!(
            "cannot {} {} into itself or its own subtree",
            mode.verb(),
            from.display()
        ));
    }
    if !from.exists() {
        return Err(format!("not found: {}", from.display()));
    }

    let resolution = {
        let mut exists = |p: &Path| p.exists();
        resolve_conflict(to, policy, &mut exists)?
    };
    let effective = match &resolution {
        Resolution::Fresh => to.to_path_buf(),
        // 跳过的条目回报请求的目标（它没有实际落点）。
        Resolution::Skip => return Ok((ItemOutcome::Skipped, to.to_path_buf())),
        Resolution::Remove => {
            remove_path(to)?;
            to.to_path_buf()
        }
        Resolution::Rename(free) => free.clone(),
    };

    match mode {
        TransferMode::Move => match std::fs::rename(from, &effective) {
            Ok(()) => Ok((ItemOutcome::Completed, effective)),
            Err(e) if is_cross_device_error(&e) => {
                // 跨设备：rename 不可用，退化成"复制 + 删源"。
                copy_path(from, &effective, warnings)?;
                // 删源失败要显式冒泡：此时磁盘上已经有两份，用户必须知道
                // "移动"其实只完成了"复制"。
                remove_path(from).map_err(|error| {
                    format!(
                        "cross-device move copied {} to {} but source removal failed: {error}",
                        from.display(),
                        effective.display()
                    )
                })?;
                Ok((ItemOutcome::CrossDevice, effective))
            }
            Err(e) => Err(format!(
                "{} {} -> {}: {e}",
                mode.verb(),
                from.display(),
                effective.display()
            )),
        },
        TransferMode::Copy => {
            copy_path(from, &effective, warnings)?;
            Ok((ItemOutcome::Completed, effective))
        }
    }
}

/// 批量搬运。逐条独立结算：一条失败不影响其余条目。
///
/// 同一批次内后续条目必须看见前面条目的结果（`a` 复制成 `a copy` 之后，
/// 紧接着又来一条同名项就得继续往后找序号），所以这里逐条串行执行，
/// `exists` 直接读真实文件系统。
pub fn transfer_all(
    items: &[TransferItem],
    policy: ConflictPolicy,
    mode: TransferMode,
) -> TransferResult {
    let mut result = TransferResult::default();
    for raw in items {
        let from = PathBuf::from(&raw.from);
        let to = PathBuf::from(&raw.to);
        let mut warnings = Vec::new();
        match transfer_one(&from, &to, policy, mode, &mut warnings) {
            Ok((outcome, effective)) => {
                // 回报**实际落点**：Rename 策略下真实路径可能已被换掉，
                // 前端要拿它刷新对应的父目录、并让已打开的 tab 跟随。
                result.record(
                    &TransferItem {
                        from: raw.from.clone(),
                        to: effective.to_string_lossy().into_owned(),
                    },
                    outcome,
                );
            }
            Err(error) => result.failed.push(TransferFailure {
                from: raw.from.clone(),
                to: raw.to.clone(),
                error,
            }),
        }
        result.warnings.append(&mut warnings);
    }
    result
}

#[cfg(test)]
mod tests {
    use super::*;
    use std::fs;

    /// 临时目录，自动清理。`tempfile` 是主 crate 与 agent 的依赖，这里
    /// 只用 std 的方式构造一个唯一目录并手动删，避免多一个依赖。
    struct TempDir(PathBuf);

    impl TempDir {
        fn new(tag: &str) -> Self {
            let nanos = std::time::SystemTime::now()
                .duration_since(std::time::UNIX_EPOCH)
                .map(|d| d.as_nanos())
                .unwrap_or(0);
            let path = std::env::temp_dir().join(format!("nexterm-fs-core-{tag}-{nanos}"));
            fs::create_dir_all(&path).expect("create temp dir");
            Self(path)
        }

        fn join(&self, rel: &str) -> PathBuf {
            self.0.join(rel)
        }
    }

    impl Drop for TempDir {
        fn drop(&mut self) {
            let _ = fs::remove_dir_all(&self.0);
        }
    }

    fn write(path: &Path, body: &str) {
        if let Some(parent) = path.parent() {
            fs::create_dir_all(parent).expect("mkdir");
        }
        fs::write(path, body).expect("write");
    }

    fn item(from: &Path, to: &Path) -> TransferItem {
        TransferItem {
            from: from.to_string_lossy().into_owned(),
            to: to.to_string_lossy().into_owned(),
        }
    }

    #[test]
    fn detects_self_nesting() {
        let base = Path::new("/repo");
        assert!(is_inside(Path::new("/repo/a/b"), base));
        assert!(is_inside(Path::new("/repo"), base));
        assert!(!is_inside(Path::new("/repo2"), base));
        assert!(!is_inside(base, Path::new("/repo/a")));
    }

    #[test]
    fn refuses_to_move_a_directory_into_its_own_subtree() {
        let tmp = TempDir::new("selfnest");
        let src = tmp.join("src");
        write(&src.join("f.txt"), "x");
        let dst = src.join("nested");

        let result = transfer_all(
            &[item(&src, &dst)],
            ConflictPolicy::Rename,
            TransferMode::Move,
        );

        assert_eq!(result.completed.len(), 0);
        assert_eq!(result.failed.len(), 1);
        assert!(result.failed[0].error.contains("into itself"));
        // 源目录必须完好
        assert!(src.join("f.txt").exists());
    }

    #[test]
    fn reports_missing_source_without_panicking() {
        let tmp = TempDir::new("missing");
        let result = transfer_all(
            &[item(&tmp.join("nope.txt"), &tmp.join("dst.txt"))],
            ConflictPolicy::Rename,
            TransferMode::Move,
        );
        assert_eq!(result.failed.len(), 1);
        assert!(result.failed[0].error.contains("not found"));
    }

    #[test]
    fn skip_policy_leaves_target_untouched() {
        let tmp = TempDir::new("skip");
        let from = tmp.join("a.txt");
        let to = tmp.join("b.txt");
        write(&from, "new");
        write(&to, "old");

        let result = transfer_all(
            &[item(&from, &to)],
            ConflictPolicy::Skip,
            TransferMode::Copy,
        );

        assert_eq!(result.skipped.len(), 1);
        assert_eq!(fs::read_to_string(&to).unwrap(), "old");
        assert_eq!(fs::read_to_string(&from).unwrap(), "new");
    }

    #[test]
    fn overwrite_policy_replaces_file_and_prunes_directory() {
        let tmp = TempDir::new("overwrite");
        let from = tmp.join("a.txt");
        let to = tmp.join("b.txt");
        write(&from, "new");
        write(&to, "old");

        let result = transfer_all(
            &[item(&from, &to)],
            ConflictPolicy::Overwrite,
            TransferMode::Copy,
        );
        assert_eq!(result.completed.len(), 1);
        assert_eq!(fs::read_to_string(&to).unwrap(), "new");

        // 目录目标：递归替换，源侧内容完整
        let dir_from = tmp.join("src");
        let dir_to = tmp.join("dst");
        write(&dir_from.join("keep/a.txt"), "a");
        write(&dir_to.join("stale/b.txt"), "b");
        let result = transfer_all(
            &[item(&dir_from, &dir_to)],
            ConflictPolicy::Overwrite,
            TransferMode::Copy,
        );
        assert_eq!(result.completed.len(), 1);
        assert!(dir_to.join("keep/a.txt").exists());
        assert!(!dir_to.join("stale/b.txt").exists());
    }

    #[test]
    fn rename_policy_walks_the_copy_counter_series() {
        let tmp = TempDir::new("rename");
        let from = tmp.join("a.txt");
        write(&from, "new");
        write(&tmp.join("a copy.txt"), "1");
        write(&tmp.join("a copy 2.txt"), "2");

        let result = transfer_all(
            &[item(&from, &tmp.join("a.txt"))],
            ConflictPolicy::Rename,
            TransferMode::Copy,
        );

        assert_eq!(result.completed.len(), 1);
        assert!(result.completed[0].to.ends_with("a copy 3.txt"));
        assert_eq!(fs::read_to_string(tmp.join("a copy 3.txt")).unwrap(), "new");
        // 原有同名项不被碰
        assert_eq!(fs::read_to_string(tmp.join("a.txt")).unwrap(), "new");
    }

    #[test]
    fn rename_policy_keeps_dotfiles_intact() {
        let tmp = TempDir::new("dotfile");
        let from = tmp.join(".gitignore");
        write(&from, "new");
        write(&tmp.join(".gitignore copy"), "old");

        // 点开头的名字整体当词干：".gitignore copy" 被占用后是
        // ".gitignore copy 2"，而不是把点号当扩展名拆成 "" + ".gitignore"。
        let result = transfer_all(
            &[item(&from, &tmp.join(".gitignore"))],
            ConflictPolicy::Rename,
            TransferMode::Copy,
        );
        assert!(result.completed[0].to.ends_with(".gitignore copy 2"));
    }

    #[test]
    fn split_ext_keeps_multi_dot_and_leading_dot_names() {
        assert_eq!(split_ext("a.tar.gz"), ("a.tar", ".gz"));
        assert_eq!(split_ext("a.txt"), ("a", ".txt"));
        assert_eq!(split_ext("README"), ("README", ""));
        assert_eq!(split_ext(".gitignore"), (".gitignore", ""));
    }

    #[test]
    fn a_failed_item_does_not_stop_the_batch() {
        let tmp = TempDir::new("batch");
        let good = tmp.join("good.txt");
        write(&good, "ok");
        let dest = tmp.join("dest");
        fs::create_dir_all(&dest).unwrap();

        let result = transfer_all(
            &[
                item(&tmp.join("missing.txt"), &dest.join("missing.txt")),
                item(&good, &dest.join("good.txt")),
            ],
            ConflictPolicy::Rename,
            TransferMode::Copy,
        );

        assert_eq!(result.failed.len(), 1);
        assert_eq!(result.completed.len(), 1);
        assert_eq!(fs::read_to_string(dest.join("good.txt")).unwrap(), "ok");
    }

    #[test]
    fn a_later_item_sees_the_earlier_renamed_result() {
        // 两条同名目标：第二条必须避开第一条刚建出来的副本。
        let tmp = TempDir::new("collide");
        let a = tmp.join("a.txt");
        let b = tmp.join("b.txt");
        write(&a, "A");
        write(&b, "B");
        write(&tmp.join("a.txt"), "existing");

        let result = transfer_all(
            &[item(&a, &tmp.join("a.txt")), item(&b, &tmp.join("a.txt"))],
            ConflictPolicy::Rename,
            TransferMode::Copy,
        );

        // 第一条占下 "a copy.txt"，第二条必须接着往后找序号而不是撞上去。
        let mut targets: Vec<String> = result
            .completed
            .iter()
            .map(|i| i.to.rsplit('/').next().unwrap_or_default().to_string())
            .collect();
        targets.sort();
        assert_eq!(targets, vec!["a copy 2.txt", "a copy.txt"]);
    }

    #[test]
    fn recursive_copy_keeps_symlinks_as_links() {
        let tmp = TempDir::new("symlink");
        let src = tmp.join("src");
        let dst = tmp.join("dst");
        write(&src.join("real.txt"), "payload");

        #[cfg(unix)]
        {
            std::os::unix::fs::symlink(src.join("real.txt"), src.join("link.txt")).unwrap();
            let mut warnings = Vec::new();
            copy_dir_recursive(&src, &dst, &mut warnings).unwrap();
            assert!(warnings.is_empty(), "unexpected warnings: {warnings:?}");
            let meta = fs::symlink_metadata(dst.join("link.txt")).unwrap();
            assert!(meta.file_type().is_symlink(), "link should stay a symlink");
        }
        #[cfg(not(unix))]
        {
            let mut warnings = Vec::new();
            copy_dir_recursive(&src, &dst, &mut warnings).unwrap();
            assert_eq!(warnings.len(), 1, "windows should warn about the skipped link");
        }
    }

    #[test]
    fn a_symlink_source_is_rebuilt_as_a_link_not_followed() {
        let tmp = TempDir::new("symlink-src");
        let real = tmp.join("real");
        write(&real.join("inner.txt"), "inner");
        let link = tmp.join("link");
        let dst = tmp.join("copied");

        #[cfg(unix)]
        {
            std::os::unix::fs::symlink(&real, &link).unwrap();
            let mut warnings = Vec::new();
            copy_path(&link, &dst, &mut warnings).unwrap();
            assert!(warnings.is_empty());
            let meta = fs::symlink_metadata(&dst).unwrap();
            assert!(meta.file_type().is_symlink());
            // 关键：不能把链接目标的目录内容复制进来。判型必须用
            // symlink_metadata —— Path::is_dir() 会跟随链接而误判成目录。
            assert_eq!(fs::read_link(&dst).unwrap(), real);
        }
        #[cfg(not(unix))]
        {
            let mut warnings = Vec::new();
            copy_path(&real, &dst, &mut warnings).unwrap();
            assert!(dst.join("inner.txt").exists());
        }
    }

    #[test]
    fn move_between_siblings_is_a_real_rename() {
        let tmp = TempDir::new("sibling");
        let from = tmp.join("a.txt");
        let to = tmp.join("b.txt");
        write(&from, "x");

        let result = transfer_all(
            &[item(&from, &to)],
            ConflictPolicy::Rename,
            TransferMode::Move,
        );
        assert_eq!(result.completed.len(), 1);
        assert!(result.cross_device.is_empty());
        assert!(!from.exists());
        assert_eq!(fs::read_to_string(&to).unwrap(), "x");
    }

    #[test]
    fn cross_device_errors_are_recognised_by_raw_code() {
        assert!(is_cross_device_error(&std::io::Error::from_raw_os_error(18)));
        assert!(is_cross_device_error(&std::io::Error::from_raw_os_error(17)));
        assert!(!is_cross_device_error(&std::io::Error::from_raw_os_error(2)));
    }
}
