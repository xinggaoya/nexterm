use serde::Serialize;

pub(crate) const DEFAULT_TIMEOUT_SECS: u64 = 30;
pub(crate) const NETWORK_TIMEOUT_SECS: u64 = 120;
pub(crate) const MAX_TIMEOUT_SECS: u64 = 180;
pub(crate) const MAX_OUTPUT_BYTES: usize = 2 * 1024 * 1024;
pub(crate) const MAX_FILE_BYTES: u64 = 2 * 1024 * 1024;
pub(crate) const MIN_GIT_VERSION: &str = "2.23";
/// Upper bound on the number of changed files surfaced to the UI from a
/// single `git status` snapshot. Files beyond this limit are dropped and
/// the snapshot is flagged as `truncated` so the panel can prompt the user
/// to fall back to the terminal. This keeps the IPC payload, the reactive
/// store, and the git decorations map bounded for huge monorepos.
pub(crate) const MAX_CHANGED_FILES: usize = 5000;

#[derive(Serialize)]
#[serde(rename_all = "camelCase")]
pub struct GitRepoInfo {
    pub repo_root: String,
    pub branch: String,
    pub upstream: Option<String>,
    pub is_detached: bool,
}

#[derive(Serialize)]
#[serde(rename_all = "camelCase")]
pub struct GitChangedFile {
    pub path: String,
    pub original_path: Option<String>,
    pub index_status: String,
    pub worktree_status: String,
    pub staged: bool,
    pub unstaged: bool,
    pub untracked: bool,
    pub status_label: String,
}

#[derive(Serialize)]
#[serde(rename_all = "camelCase")]
pub struct GitStatusSnapshot {
    pub repo_root: String,
    pub branch: String,
    pub upstream: Option<String>,
    pub ahead: u32,
    pub behind: u32,
    pub is_detached: bool,
    pub truncated: bool,
    pub changed_files: Vec<GitChangedFile>,
}

#[derive(Serialize)]
#[serde(rename_all = "camelCase")]
pub struct GitPanelSnapshot {
    pub repo: Option<GitRepoInfo>,
    pub status: Option<GitStatusSnapshot>,
}

#[derive(serde::Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct DiscardEntry {
    pub path: String,
    pub untracked: bool,
}

#[derive(Serialize)]
#[serde(rename_all = "camelCase")]
pub struct GitDiffResult {
    pub diff_text: String,
    pub truncated: bool,
}

#[derive(Serialize)]
#[serde(rename_all = "camelCase")]
pub struct GitDiffContentResult {
    pub original_content: String,
    pub modified_content: String,
    pub is_binary: bool,
    pub fallback_patch: String,
    pub truncated: bool,
}

#[derive(Serialize)]
#[serde(rename_all = "camelCase")]
pub struct GitCommitResult {
    pub commit_sha: String,
    pub summary: String,
}

#[derive(Serialize)]
#[serde(rename_all = "camelCase")]
pub struct GitCommitFileChange {
    pub path: String,
    pub original_path: Option<String>,
    pub status: String,
    pub status_label: String,
    pub added: u32,
    pub removed: u32,
    pub is_binary: bool,
}

#[derive(Serialize)]
#[serde(rename_all = "camelCase")]
pub struct GitLogEntry {
    pub sha: String,
    pub short_sha: String,
    pub author: String,
    pub author_email: String,
    pub timestamp_secs: i64,
    pub parents: Vec<String>,
    pub subject: String,
    pub files_changed: u32,
    pub insertions: u32,
    pub deletions: u32,
    #[serde(default)]
    pub refs: Vec<GitLogRef>,
}

#[derive(Debug, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct GitLogRef {
    pub name: String,
    pub kind: String,
    pub is_head: bool,
}

#[derive(Serialize)]
#[serde(rename_all = "camelCase")]
pub struct GitLogPage {
    pub entries: Vec<GitLogEntry>,
    pub has_more: bool,
}

#[derive(serde::Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct GitLogOptions {
    #[serde(default)]
    pub limit: Option<u32>,
    #[serde(default)]
    pub offset: Option<u32>,
    #[serde(default)]
    pub ref_name: Option<String>,
    #[serde(default)]
    pub all: bool,
}

#[derive(Serialize)]
#[serde(rename_all = "camelCase")]
pub struct GitPushResult {
    pub remote: Option<String>,
    pub branch: Option<String>,
    pub pushed: bool,
}

#[derive(Serialize)]
#[serde(rename_all = "camelCase")]
pub struct GitFetchResult {
    pub updated_refs: u32,
    pub pruned_refs: u32,
    pub summary: String,
}

#[derive(Serialize)]
#[serde(rename_all = "camelCase")]
pub struct GitPullResult {
    pub files_changed: u32,
    pub insertions: u32,
    pub deletions: u32,
    pub already_up_to_date: bool,
    pub summary: String,
}

#[derive(Serialize)]
#[serde(rename_all = "camelCase")]
pub struct GitBranchInfo {
    pub name: String,
    pub full_ref: String,
    pub upstream: Option<String>,
    pub is_current: bool,
    pub is_remote: bool,
    pub last_commit_short_sha: String,
    pub last_commit_subject: String,
    pub last_commit_timestamp_secs: i64,
    pub ahead: Option<u32>,
    pub behind: Option<u32>,
}

#[derive(Serialize)]
#[serde(rename_all = "camelCase")]
pub struct GitBranchResult {
    pub branch: String,
}

#[derive(Serialize)]
#[serde(rename_all = "camelCase")]
pub struct GitStashEntry {
    pub selector: String,
    pub full_sha: String,
    pub short_sha: String,
    pub relative_time: String,
    pub message: String,
}

#[derive(serde::Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct GitStashPushOptions {
    pub message: Option<String>,
    #[serde(default)]
    pub include_untracked: bool,
    #[serde(default)]
    pub keep_index: bool,
}

#[derive(Serialize)]
#[serde(rename_all = "camelCase")]
pub struct GitStashResult {
    pub stashed: bool,
    pub message: String,
}

#[derive(Serialize)]
#[serde(rename_all = "camelCase")]
pub struct GitWorkspaceRepo {
    pub repo_root: String,
    pub relative_path: String,
    pub name: String,
    pub branch: String,
    pub upstream: Option<String>,
    pub is_detached: bool,
    pub is_worktree: bool,
}

#[derive(Serialize)]
#[serde(rename_all = "camelCase")]
pub struct GitRepositoryDiscovery {
    pub repositories: Vec<GitWorkspaceRepo>,
    pub truncated: bool,
}

pub(crate) struct GitOutput {
    pub(crate) stdout: Vec<u8>,
    pub(crate) stderr: Vec<u8>,
    pub(crate) exit_code: Option<i32>,
    pub(crate) timed_out: bool,
    pub(crate) truncated: bool,
}

pub(crate) enum TextSource {
    Missing,
    Binary,
    Text(String),
}

impl TextSource {
    pub(crate) fn into_text(self) -> String {
        match self {
            TextSource::Text(text) => text,
            TextSource::Missing | TextSource::Binary => String::new(),
        }
    }
}
