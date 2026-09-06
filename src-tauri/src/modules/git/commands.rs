use tauri::{AppHandle, Manager};

use crate::modules::git::operations;
use crate::modules::git::types::{
    DiscardEntry, GitBranchInfo, GitBranchResult, GitCommitFileChange, GitCommitResult,
    GitDiffContentResult, GitDiffResult, GitFetchResult, GitLogOptions, GitLogPage,
    GitPanelSnapshot, GitPullResult, GitPushResult, GitRemoteInfo, GitRemoteInput,
    GitRemoteUrlUpdate, GitRepoInfo, GitRepositoryDiscovery, GitStashEntry, GitStashPushOptions,
    GitStashResult, GitStatusSnapshot,
};
use crate::modules::workspace::{WorkspaceEnv, WorkspaceRegistry};

async fn blocking<F, T>(app: AppHandle, f: F) -> Result<T, String>
where
    F: FnOnce(&WorkspaceRegistry) -> Result<T, String> + Send + 'static,
    T: Send + 'static,
{
    tauri::async_runtime::spawn_blocking(move || {
        let registry = app.state::<WorkspaceRegistry>();
        f(&registry)
    })
    .await
    .map_err(|e| e.to_string())?
}

/// 统一生成 git 域的 Tauri 包装命令。每个命令都是同一模板:
/// 可选参数预处理(prelude)→ `WorkspaceEnv::from_option` →
/// `blocking`(spawn_blocking)→ `operations::<op>(...)`。
///
/// 用法:
/// ```ignore
/// git_command!(git_stage, stage, () :
///     repo_root: String => &repo_root,
///     paths: Vec<String> => &paths);
///
/// git_command!(git_remote_url, remote_url,
///     prelude { let remote = name.unwrap_or_else(|| "origin".into()); },
///     Option<String> :
///     repo_root: String => &repo_root,
///     name: Option<String> => &remote);
/// ```
/// - `$cmd` / `$op`:命令函数名与 operations 函数名;
/// - `$ret`:operations 的成功返回类型(命令返回 `Result<$ret, String>`);
/// - 参数列表的转发表达式决定传参方式:按引用 `&x`、`Option` 转
///   `x.as_deref()`、或经 prelude 计算出的值;
/// - `prelude { .. }` 可选(置于 `$ret` 之前),在闭包之前执行
///   (如默认值回填)。
///
/// 生成的函数名、参数名(serde camelCase)与返回类型和手写版本
/// 完全一致;`lib.rs` 的 `generate_handler` 引用不变。
macro_rules! git_command {
    (
        $cmd:ident, $op:ident, $ret:ty :
        $( $arg:ident : $ty:ty => $fwd:expr ),* $(,)?
    ) => {
        git_command!(@generate $cmd, $op, $ret, [], [$( $arg : $ty => $fwd ),*]);
    };
    (
        $cmd:ident, $op:ident, prelude { $( $pre:stmt )* }, $ret:ty :
        $( $arg:ident : $ty:ty => $fwd:expr ),* $(,)?
    ) => {
        git_command!(@generate $cmd, $op, $ret, [$( $pre )*], [$( $arg : $ty => $fwd ),*]);
    };
    (@generate $cmd:ident, $op:ident, $ret:ty, [$($pre:tt)*], [$($arg:ident : $ty:ty => $fwd:expr),*]) => {
        #[tauri::command]
        pub async fn $cmd(
            $( $arg : $ty, )*
            workspace: Option<WorkspaceEnv>,
            app: AppHandle,
        ) -> Result<$ret, String> {
            $($pre)*
            let workspace = WorkspaceEnv::from_option(workspace);
            blocking(app, move |r| {
                operations::$op(r, $( $fwd, )* &workspace).map_err(Into::into)
            })
            .await
        }
    };
}

git_command!(git_resolve_repo, resolve_repo, Option<GitRepoInfo> :
    cwd: String => &cwd);

git_command!(git_panel_snapshot, panel_snapshot, GitPanelSnapshot :
    cwd: String => &cwd,
    untracked_files: Option<String> => untracked_files.as_deref());

git_command!(git_status, status, GitStatusSnapshot :
    repo_root: String => &repo_root,
    untracked_files: Option<String> => untracked_files.as_deref());

git_command!(git_diff, diff, GitDiffResult :
    repo_root: String => &repo_root,
    path: Option<String> => path.as_deref(),
    staged: bool => staged);

git_command!(git_diff_content, diff_content, GitDiffContentResult :
    repo_root: String => &repo_root,
    path: String => &path,
    staged: bool => staged,
    original_path: Option<String> => original_path.as_deref());

git_command!(git_stage, stage, () :
    repo_root: String => &repo_root,
    paths: Vec<String> => &paths);

git_command!(git_unstage, unstage, () :
    repo_root: String => &repo_root,
    paths: Vec<String> => &paths);

git_command!(git_discard, discard, () :
    repo_root: String => &repo_root,
    entries: Vec<DiscardEntry> => &entries);

git_command!(git_commit, commit, GitCommitResult :
    repo_root: String => &repo_root,
    message: String => &message);

git_command!(git_fetch, fetch, GitFetchResult :
    repo_root: String => &repo_root);

git_command!(git_pull_ff_only, pull_ff_only, GitPullResult :
    repo_root: String => &repo_root);

git_command!(git_push, push, GitPushResult :
    repo_root: String => &repo_root);

git_command!(git_branch_list, branch_list, Vec<GitBranchInfo> :
    repo_root: String => &repo_root);

git_command!(git_checkout_branch, checkout_branch, GitBranchResult :
    repo_root: String => &repo_root,
    branch: String => &branch,
    remote: bool => remote);

git_command!(git_create_branch, create_branch, GitBranchResult :
    repo_root: String => &repo_root,
    branch: String => &branch);

git_command!(git_stash_list, stash_list, Vec<GitStashEntry> :
    repo_root: String => &repo_root);

git_command!(git_stash_push, stash_push, GitStashResult :
    repo_root: String => &repo_root,
    options: GitStashPushOptions => &options);

git_command!(git_stash_pop, stash_pop, GitStashResult :
    repo_root: String => &repo_root,
    selector: String => &selector,
    expected_sha: Option<String> => expected_sha.as_deref());

git_command!(git_stash_drop, stash_drop, GitStashResult :
    repo_root: String => &repo_root,
    selector: String => &selector,
    expected_sha: Option<String> => expected_sha.as_deref());

git_command!(git_stash_apply, stash_apply, GitStashResult :
    repo_root: String => &repo_root,
    selector: String => &selector,
    expected_sha: Option<String> => expected_sha.as_deref());

git_command!(git_log, log, GitLogPage :
    repo_root: String => &repo_root,
    options: GitLogOptions => &options);

// 命令名是 `git_show_commit`,但实际调用 `show_commit_diff` 操作。
git_command!(git_show_commit, show_commit_diff, GitDiffResult :
    repo_root: String => &repo_root,
    sha: String => &sha);

git_command!(git_commit_files, commit_files, Vec<GitCommitFileChange> :
    repo_root: String => &repo_root,
    sha: String => &sha);

git_command!(git_commit_file_diff, commit_file_diff, GitDiffContentResult :
    repo_root: String => &repo_root,
    sha: String => &sha,
    path: String => &path,
    original_path: Option<String> => original_path.as_deref());

// 远端名缺省为 `origin`:前端允许不传 `name`。
git_command!(git_remote_url, remote_url,
    prelude {
        let remote = name.unwrap_or_else(|| "origin".to_string());
    },
    Option<String> :
    repo_root: String => &repo_root,
    name: Option<String> => &remote);

git_command!(git_remote_list, remote_list, Vec<GitRemoteInfo> :
    repo_root: String => &repo_root);

git_command!(git_remote_add, remote_add, GitRemoteInfo :
    repo_root: String => &repo_root,
    input: GitRemoteInput => &input);

git_command!(git_remote_remove, remote_remove, () :
    repo_root: String => &repo_root,
    name: String => &name);

git_command!(git_remote_set_url, remote_set_url, GitRemoteInfo :
    repo_root: String => &repo_root,
    input: GitRemoteUrlUpdate => &input);

const DEFAULT_DISCOVERY_DEPTH: u32 = 4;
const DEFAULT_DISCOVERY_MAX_REPOS: u32 = 32;

// 发现深度 / 数量上限缺省回填后才进入 blocking 闭包。
git_command!(git_discover_repositories, discover_repositories,
    prelude {
        let depth = max_depth.unwrap_or(DEFAULT_DISCOVERY_DEPTH);
        let limit = max_repos.unwrap_or(DEFAULT_DISCOVERY_MAX_REPOS);
    },
    GitRepositoryDiscovery :
    root_path: String => &root_path,
    max_depth: Option<u32> => depth,
    max_repos: Option<u32> => limit);
