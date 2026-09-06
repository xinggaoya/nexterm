use std::ffi::{OsStr, OsString};

use crate::modules::git::errors::{GitError, Result};
use crate::modules::git::parser::parse_log_refs;
use crate::modules::git::process::{ensure_success, git_show_text, git_stdout_line_opt, run_git};
use crate::modules::git::types::{
    GitCommitFileChange, GitDiffContentResult, GitDiffResult, GitLogEntry, GitLogOptions,
    GitLogPage, TextSource, DEFAULT_TIMEOUT_SECS,
};
use crate::modules::git::utils::{resolve_within_repo, ResolvedGitDirectory};
use crate::modules::workspace::{WorkspaceEnv, WorkspaceRegistry};

use super::{sha_is_safe, with_repo};

const LOG_FORMAT: &str = "%H%x1f%an%x1f%ae%x1f%at%x1f%P%x1f%s%x1f%d";
const MAX_LOG_LIMIT: u32 = 200;
const DEFAULT_LOG_LIMIT: u32 = 30;

/// Validate a ref name before handing it to `git log`. Git accepts a broad
/// grammar (branches, tags, remotes, peeled SHAs, relative refs like
/// `HEAD~3`), so we only block the bytes that would let a caller escape the
/// argv: control characters, leading `-` (which could be mistaken for an
/// option), and embedded NULs.
fn validate_log_ref_name(name: &str) -> Result<String> {
    if name.is_empty()
        || name.starts_with('-')
        || name.contains('\0')
        || name.chars().any(char::is_control)
    {
        return Err(GitError::command("git log", "invalid ref name"));
    }
    Ok(name.to_string())
}

/// 空日志页:仓库尚无任何提交(或 ref 无法解析)时 `log` 的正式
/// 返回值 —— entries 为空、has_more 为 false,满足 GitLogPage 分页
/// 契约,不是临时占位。
fn empty_log_page() -> GitLogPage {
    GitLogPage {
        entries: Vec::new(),
        has_more: false,
    }
}

/// Build a short-name → kind lookup from `git for-each-ref` so that the
/// `--decorate=short` output (which only gives us `feature/x` or
/// `origin/main`, both of which contain `/`) can still be classified. The
/// insertion order matches git's own decorate priority: HEAD first,
/// `refs/heads` next, then `refs/remotes`, then `refs/tags`. A short name
/// that exists in two namespaces resolves to the higher-priority kind —
/// exactly how `git log --decorate` itself displays it.
fn collect_ref_kind_map(repo_root: &ResolvedGitDirectory) -> Result<std::collections::HashMap<String, &'static str>> {
    let output = run_git(
        &repo_root.workspace,
        Some(&repo_root.git_path),
        [
            OsStr::new("for-each-ref"),
            OsStr::new("--format=%(refname:short)%1f%(refname)"),
            OsStr::new("refs/heads"),
            OsStr::new("refs/remotes"),
            OsStr::new("refs/tags"),
        ],
        DEFAULT_TIMEOUT_SECS,
    )?;
    if output.timed_out {
        return Err(GitError::TimedOut("git for-each-ref"));
    }
    if output.exit_code != Some(0) {
        // No refs yet (empty repo). Return an empty map so callers fall
        // through to the heuristic in the parser.
        return Ok(std::collections::HashMap::new());
    }
    let stdout = std::str::from_utf8(&output.stdout).unwrap_or("");
    let mut map: std::collections::HashMap<String, &'static str> =
        std::collections::HashMap::new();
    for line in stdout.lines() {
        let line = line.trim_end_matches('\r');
        if line.is_empty() || !line.contains('\x1f') {
            continue;
        }
        let mut parts = line.splitn(2, '\x1f');
        let short = parts.next().unwrap_or("").to_string();
        let full = parts.next().unwrap_or("");
        if short.is_empty() || full.is_empty() {
            continue;
        }
        let kind = if full.starts_with("refs/heads/") {
            "local-branch"
        } else if full.starts_with("refs/remotes/") {
            "remote-branch"
        } else if full.starts_with("refs/tags/") {
            "tag"
        } else {
            continue;
        };
        // Insertion order wins: `refs/heads` is queried first so local
        // entries already shadow any remote with the same short name.
        map.entry(short).or_insert(kind);
    }
    Ok(map)
}

pub fn log(
    registry: &WorkspaceRegistry,
    repo_root: &str,
    options: &GitLogOptions,
    workspace: &WorkspaceEnv,
) -> Result<GitLogPage> {
    with_repo(registry, repo_root, workspace, |repo_root| {
        let bounded = options
            .limit
            .unwrap_or(DEFAULT_LOG_LIMIT)
            .clamp(1, MAX_LOG_LIMIT);
        let skip = options.offset.unwrap_or(0);
        let format_arg = format!("--format={LOG_FORMAT}");
        // `has_more` is detected by asking for one extra entry beyond the page
        // size. `--max-count` counts only successful commit records, so when
        // there are fewer than `bounded + 1` commits reachable, we know the
        // current page is the last one. This avoids the `<sha>^` cursor pattern
        // that breaks for merge commits and root commits.
        let probe_count_arg = format!("--max-count={}", bounded.saturating_add(1));
        let mut probe_args: Vec<OsString> = vec![
            OsString::from("log"),
            OsString::from("--no-color"),
            OsString::from("--shortstat"),
            OsString::from("--decorate=short"),
            OsString::from(probe_count_arg),
            OsString::from(format_arg),
        ];
        if skip > 0 {
            probe_args.push(OsString::from(format!("--skip={skip}")));
        }
        if options.all {
            probe_args.push(OsString::from("--all"));
        } else if let Some(name) = options.ref_name.as_deref() {
            let validated = validate_log_ref_name(name)?;
            probe_args.push(OsString::from(validated));
        }
        let ref_kind_map = collect_ref_kind_map(repo_root)?;
        let output = run_git(
            &repo_root.workspace,
            Some(&repo_root.git_path),
            probe_args,
            DEFAULT_TIMEOUT_SECS,
        )?;
        if output.timed_out {
            return Err(GitError::TimedOut("git log"));
        }
        if output.exit_code != Some(0) {
            let stderr = String::from_utf8_lossy(&output.stderr).to_ascii_lowercase();
            // When the caller named a specific ref and Git couldn't resolve it,
            // surface that as a focused "ref not found" error rather than the
            // generic command-failed message.
            if !options.all && options.ref_name.is_some() && stderr.contains("unknown revision") {
                return Err(GitError::command(
                    "git log",
                    format!("ref not found: {}", options.ref_name.as_deref().unwrap_or("")),
                ));
            }
            if stderr.contains("does not have any commits yet")
                || stderr.contains("bad default revision")
                || stderr.contains("unknown revision")
                || stderr.contains("ambiguous argument 'head'")
            {
                return Ok(empty_log_page());
            }
            return ensure_success(&output, "git log failed").map(|_| empty_log_page());
        }
        let stdout = std::str::from_utf8(&output.stdout).unwrap_or("");
        let mut entries: Vec<GitLogEntry> = Vec::with_capacity(bounded as usize);
        // Lines we get back interleave:
        //   <sha>\x1f<author>\x1f<email>\x1f<ts>\x1f<parents>\x1f<subject>\x1f<decorate>
        //   <blank>
        //    5 files changed, 12 insertions(+), 3 deletions(-)
        // Commits without diffstats (root commits, merges with no changes) just
        // skip the shortstat line. Detect commit headers by the presence of
        // the unit-separator we put in the format.
        for raw_line in stdout.lines() {
            let line = raw_line.trim_end_matches('\r');
            if line.is_empty() {
                continue;
            }
            if line.contains('\x1f') {
                let mut fields = line.splitn(7, '\x1f');
                let sha = fields.next().unwrap_or("").to_string();
                if !sha_is_safe(&sha) {
                    continue;
                }
                let author = fields.next().unwrap_or("").to_string();
                let author_email = fields.next().unwrap_or("").to_string();
                let timestamp = fields.next().unwrap_or("0").parse::<i64>().unwrap_or(0);
                let parents_raw = fields.next().unwrap_or("");
                let parents: Vec<String> = parents_raw
                    .split_ascii_whitespace()
                    .map(|s| s.to_string())
                    .collect();
                let subject = fields.next().unwrap_or("").to_string();
                let decorate = fields.next().unwrap_or("");
                let short_sha = sha.chars().take(7).collect::<String>();
                entries.push(GitLogEntry {
                    sha,
                    short_sha,
                    author,
                    author_email,
                    timestamp_secs: timestamp,
                    parents,
                    subject,
                    files_changed: 0,
                    insertions: 0,
                    deletions: 0,
                    refs: parse_log_refs(decorate, &ref_kind_map),
                });
                continue;
            }
            if let Some(current) = entries.last_mut() {
                if line.contains("file changed") || line.contains("files changed") {
                    let (files, ins, del) = parse_shortstat(line);
                    current.files_changed = files;
                    current.insertions = ins;
                    current.deletions = del;
                }
            }
        }
        let has_more = entries.len() as u32 > bounded;
        if has_more {
            entries.truncate(bounded as usize);
        }
        Ok(GitLogPage {
            entries,
            has_more,
        })
    })
}

pub fn show_commit_diff(
    registry: &WorkspaceRegistry,
    repo_root: &str,
    sha: &str,
    workspace: &WorkspaceEnv,
) -> Result<GitDiffResult> {
    with_repo(registry, repo_root, workspace, |repo_root| {
        if !sha_is_safe(sha) {
            return Err(GitError::command("git show", "invalid commit identifier"));
        }
        let output = run_git(
            &repo_root.workspace,
            Some(&repo_root.git_path),
            [
                OsStr::new("show"),
                OsStr::new("--no-color"),
                OsStr::new("--no-ext-diff"),
                OsStr::new("--patch-with-stat"),
                OsStr::new(sha),
                OsStr::new("--"),
            ],
            DEFAULT_TIMEOUT_SECS,
        )?;
        ensure_success(&output, "git show failed")?;
        let diff_text = match String::from_utf8(output.stdout) {
            Ok(text) => text,
            Err(e) => String::from_utf8_lossy(&e.into_bytes()).into_owned(),
        };
        Ok(GitDiffResult {
            diff_text,
            truncated: output.truncated,
        })
    })
}

fn parse_shortstat(tail: &str) -> (u32, u32, u32) {
    // Looks for a line like " 5 files changed, 12 insertions(+), 3 deletions(-)"
    for line in tail.lines() {
        let trimmed = line.trim();
        if !(trimmed.contains("file changed") || trimmed.contains("files changed")) {
            continue;
        }
        let mut files = 0u32;
        let mut ins = 0u32;
        let mut del = 0u32;
        for part in trimmed.split(',') {
            let part = part.trim();
            let num_str = part.split_ascii_whitespace().next().unwrap_or("0");
            let n: u32 = num_str.parse().unwrap_or(0);
            if part.contains("file") {
                files = n;
            } else if part.contains("insertion") {
                ins = n;
            } else if part.contains("deletion") {
                del = n;
            }
        }
        return (files, ins, del);
    }
    (0, 0, 0)
}

pub fn commit_files(
    registry: &WorkspaceRegistry,
    repo_root: &str,
    sha: &str,
    workspace: &WorkspaceEnv,
) -> Result<Vec<GitCommitFileChange>> {
    with_repo(registry, repo_root, workspace, |repo_root| {
        if !sha_is_safe(sha) {
            return Err(GitError::command("git diff-tree", "invalid commit sha"));
        }

        let output = run_git(
            &repo_root.workspace,
            Some(&repo_root.git_path),
            [
                OsStr::new("diff-tree"),
                OsStr::new("--no-commit-id"),
                OsStr::new("-r"),
                OsStr::new("-z"),
                OsStr::new("--name-status"),
                OsStr::new("--numstat"),
                OsStr::new(sha),
            ],
            DEFAULT_TIMEOUT_SECS,
        )?;
        ensure_success(&output, "git diff-tree failed")?;

        let (name_status_bytes, numstat_bytes) = split_name_status_numstat(&output.stdout);
        let mut files = parse_diff_tree_name_status(name_status_bytes);
        apply_numstat(&mut files, numstat_bytes);
        Ok(files)
    })
}

fn split_name_status_numstat(bytes: &[u8]) -> (&[u8], &[u8]) {
    let s = std::str::from_utf8(bytes).unwrap_or("");
    let tokens: Vec<(usize, &str)> = s
        .split('\0')
        .scan(0usize, |off, t| {
            let start = *off;
            *off += t.len() + 1;
            Some((start, t))
        })
        .collect();
    let mut split_at = bytes.len();
    for (idx, tok) in tokens.iter().enumerate() {
        if tok.1.contains('\t') {
            split_at = tok.0;
            // Walk back: numstat for R/C with -z emits "<a>\t<r>" then two
            // NUL-separated paths. The two trailing path tokens belong to the
            // numstat block, not name-status.
            let _ = idx;
            break;
        }
    }
    (&bytes[..split_at], &bytes[split_at..])
}

pub fn commit_file_diff(
    registry: &WorkspaceRegistry,
    repo_root: &str,
    sha: &str,
    path: &str,
    original_path: Option<&str>,
    workspace: &WorkspaceEnv,
) -> Result<GitDiffContentResult> {
    with_repo(registry, repo_root, workspace, |repo_root| {
        if !sha_is_safe(sha) {
            return Err(GitError::command("git show", "invalid commit sha"));
        }
        let resolved = resolve_within_repo(&repo_root.local_path, path)?;
        let rel = resolved
            .strip_prefix(&repo_root.local_path)
            .map(|p| p.to_string_lossy().replace('\\', "/"))
            .unwrap_or_else(|_| path.replace('\\', "/"));

        let original_rel = match original_path {
            Some(orig) if !orig.is_empty() => {
                let resolved_orig = resolve_within_repo(&repo_root.local_path, orig)?;
                resolved_orig
                    .strip_prefix(&repo_root.local_path)
                    .map(|p| p.to_string_lossy().replace('\\', "/"))
                    .unwrap_or_else(|_| orig.replace('\\', "/"))
            }
            _ => rel.clone(),
        };

        let parent = git_stdout_line_opt(
            &repo_root.workspace,
            &repo_root.git_path,
            ["rev-parse", &format!("{sha}^")],
        )?;
        let original = match parent.as_deref() {
            Some(p) => git_show_text(
                &repo_root.workspace,
                &repo_root.git_path,
                &format!("{p}:{original_rel}"),
            )?,
            None => TextSource::Missing,
        };
        let modified = git_show_text(
            &repo_root.workspace,
            &repo_root.git_path,
            &format!("{sha}:{rel}"),
        )?;

        let mut diff_args: Vec<OsString> = vec![
            "show".into(),
            "--no-color".into(),
            "--no-ext-diff".into(),
            "--format=".into(),
            "-m".into(),
            "--first-parent".into(),
            sha.into(),
            "--".into(),
        ];
        diff_args.push(rel.clone().into());
        if original_rel != rel {
            diff_args.push(original_rel.clone().into());
        }
        let patch_output = run_git(
            &repo_root.workspace,
            Some(&repo_root.git_path),
            diff_args,
            DEFAULT_TIMEOUT_SECS,
        )?;
        ensure_success(&patch_output, "git show <commit> -- <path> failed")?;
        let patch_text = match String::from_utf8(patch_output.stdout) {
            Ok(text) => text,
            Err(e) => String::from_utf8_lossy(&e.into_bytes()).into_owned(),
        };

        let is_binary =
            matches!(original, TextSource::Binary) || matches!(modified, TextSource::Binary);

        Ok(GitDiffContentResult {
            original_content: original.into_text(),
            modified_content: modified.into_text(),
            is_binary,
            fallback_patch: patch_text,
            truncated: patch_output.truncated,
        })
    })
}

fn parse_diff_tree_name_status(bytes: &[u8]) -> Vec<GitCommitFileChange> {
    let s = std::str::from_utf8(bytes).unwrap_or("");
    let mut tokens = s.split('\0').filter(|t| !t.is_empty());
    let mut files: Vec<GitCommitFileChange> = Vec::new();
    while let Some(status_tok) = tokens.next() {
        let status_char = status_tok.chars().next().unwrap_or(' ');
        if status_char == 'R' || status_char == 'C' {
            let original = match tokens.next() {
                Some(v) => v.to_string(),
                None => break,
            };
            let new_path = match tokens.next() {
                Some(v) => v.to_string(),
                None => break,
            };
            files.push(GitCommitFileChange {
                path: new_path,
                original_path: Some(original),
                status: status_char.to_string(),
                status_label: status_label_for(status_char),
                added: 0,
                removed: 0,
                is_binary: false,
            });
        } else {
            let path = match tokens.next() {
                Some(v) => v.to_string(),
                None => break,
            };
            files.push(GitCommitFileChange {
                path,
                original_path: None,
                status: status_char.to_string(),
                status_label: status_label_for(status_char),
                added: 0,
                removed: 0,
                is_binary: false,
            });
        }
    }
    files
}

fn apply_numstat(files: &mut [GitCommitFileChange], bytes: &[u8]) {
    let s = std::str::from_utf8(bytes).unwrap_or("");
    let tokens: Vec<&str> = s.split('\0').filter(|t| !t.is_empty()).collect();
    let mut idx = 0;
    while idx < tokens.len() {
        let header = tokens[idx];
        idx += 1;
        let mut cols = header.splitn(3, '\t');
        let added_raw = cols.next().unwrap_or("0");
        let removed_raw = cols.next().unwrap_or("0");
        let inline_path = cols.next().unwrap_or("");
        let is_binary = added_raw == "-" && removed_raw == "-";
        let added: u32 = if is_binary {
            0
        } else {
            added_raw.parse().unwrap_or(0)
        };
        let removed: u32 = if is_binary {
            0
        } else {
            removed_raw.parse().unwrap_or(0)
        };

        let (path, original) = if inline_path.is_empty() {
            let original = tokens.get(idx).map(|s| s.to_string()).unwrap_or_default();
            idx += 1;
            let new_path = tokens.get(idx).map(|s| s.to_string()).unwrap_or_default();
            idx += 1;
            (new_path, Some(original))
        } else {
            (inline_path.to_string(), None)
        };

        if path.is_empty() {
            continue;
        }
        if let Some(file) = files.iter_mut().find(|f| f.path == path) {
            file.added = added;
            file.removed = removed;
            file.is_binary = is_binary;
            if file.original_path.is_none() {
                if let Some(orig) = original {
                    if !orig.is_empty() && orig != file.path {
                        file.original_path = Some(orig);
                    }
                }
            }
        }
    }
}

fn status_label_for(c: char) -> String {
    match c {
        'A' => "Added".into(),
        'M' => "Modified".into(),
        'D' => "Deleted".into(),
        'R' => "Renamed".into(),
        'C' => "Copied".into(),
        'T' => "Type changed".into(),
        'U' => "Unmerged".into(),
        _ => format!("Status {c}"),
    }
}

#[cfg(test)]
mod tests {
    use crate::modules::git::operations::test_support::{
        init_git_repo, make_root, run_git, write_file, AuthorizedRoot,
    };
    use crate::modules::workspace::WorkspaceEnv;

    // --- parse_shortstat(纯函数) --------------------------------------------

    #[test]
    fn parse_shortstat_counts_files_insertions_deletions() {
        let (files, ins, del) =
            super::parse_shortstat(" 5 files changed, 12 insertions(+), 3 deletions(-)");
        assert_eq!((files, ins, del), (5, 12, 3));
    }

    #[test]
    fn parse_shortstat_handles_singular_and_missing_sections() {
        // 单文件单数形式;只有插入、没有删除的提交。
        assert_eq!(
            super::parse_shortstat(" 1 file changed, 2 insertions(+)"),
            (1, 2, 0)
        );
        // 只有删除。
        assert_eq!(
            super::parse_shortstat(" 1 file changed, 4 deletions(-)"),
            (1, 0, 4)
        );
        // 缺少统计明细(如空提交)应返回全零。
        assert_eq!(super::parse_shortstat(""), (0, 0, 0));
        assert_eq!(super::parse_shortstat("commit abc"), (0, 0, 0));
    }

    // --- git_log page contract fixtures --------------------------------------
    //
    // The Task 6 page contract: `log(registry, repo_root, options, workspace)`
    // returns `GitLogPage { entries, has_more }`. `options.ref_name` selects
    // a single branch, `options.all` crosses refs, and `options.offset`
    // advances through the DAG without duplicating SHAs. These fixtures build
    // a real repo with two branches, a tag, and a merge commit so the parser
    // exercises the decoration/refs path as well.

    /// Build a repo with two branches (`main` + `feature`), a merge commit,
    /// and a tag. Returns the canonical path used as `repo_root`. The fixture
    /// leaves HEAD on `main` so the default log view exposes the full DAG:
    /// init → add feature → main only change → merge feature into main →
    /// feature follow-up (only reachable via `--all`).
    fn init_branched_repo(label: &str) -> AuthorizedRoot {
        let root = make_root(label);
        init_git_repo(&root.path, "main");

        // First feature commit.
        write_file(&root.path, "feature.txt", "feature-v1\n");
        run_git(&root.path, &["checkout", "-b", "feature"]);
        run_git(&root.path, &["add", "feature.txt"]);
        run_git(
            &root.path,
            &[
                "commit",
                "-m",
                "add feature",
            ],
        );

        // Main advances independently so the two branches diverge.
        run_git(&root.path, &["checkout", "main"]);
        write_file(&root.path, "main-only.txt", "main-only\n");
        run_git(&root.path, &["add", "main-only.txt"]);
        run_git(&root.path, &["commit", "-m", "main only change"]);

        // Merge feature back into main so we have a two-parent commit.
        run_git(
            &root.path,
            &["merge", "--no-ff", "feature", "-m", "merge feature into main"],
        );

        // Tag the latest merge commit so the decoration parser has a tag ref
        // to surface on the merge.
        run_git(&root.path, &["tag", "v1.0"]);

        // A second feature commit so `feature` has its own DAG tail. After
        // this we switch back to `main` so the default view shows the merge
        // commit as the HEAD ref.
        run_git(&root.path, &["checkout", "feature"]);
        write_file(&root.path, "feature.txt", "feature-v2\n");
        run_git(&root.path, &["add", "feature.txt"]);
        run_git(&root.path, &["commit", "-m", "feature follow-up"]);
        run_git(&root.path, &["checkout", "main"]);

        root
    }

    fn default_log_options() -> super::GitLogOptions {
        super::GitLogOptions {
            limit: None,
            offset: None,
            ref_name: None,
            all: false,
        }
    }

    #[test]
    fn log_default_returns_page_with_entries() {
        let root = init_branched_repo("log-default");
        let path_str = root.path.to_string_lossy().into_owned();

        let page = super::log(
            &root.registry,
            &path_str,
            &default_log_options(),
            &WorkspaceEnv::Local,
        )
        .expect("log returns page");

        assert!(page.entries.len() >= 4, "branched repo has >= 4 commits");
        assert!(
            !page.has_more,
            "limit defaults to 30 which is more than the available history"
        );
        // Newest first ordering — the merge commit should be near the top.
        let head_subject = page.entries[0].subject.as_str();
        assert!(
            head_subject.contains("merge feature")
                || head_subject.contains("feature follow-up"),
            "newest commit should be the merge or the feature follow-up, got: {head_subject}",
        );
    }

    #[test]
    fn log_ref_name_limits_to_branch() {
        let root = init_branched_repo("log-ref-name");
        let path_str = root.path.to_string_lossy().into_owned();

        let mut options = default_log_options();
        options.ref_name = Some("feature".to_string());

        let page = super::log(
            &root.registry,
            &path_str,
            &options,
            &WorkspaceEnv::Local,
        )
        .expect("log returns page");

        // `feature` carries the merge + add feature + init, no `main only`
        // commit. We assert none of the `main only` subjects appear.
        for entry in &page.entries {
            assert!(
                !entry.subject.contains("main only"),
                "feature branch should not include 'main only change', got: {}",
                entry.subject,
            );
        }
    }

    #[test]
    fn log_all_includes_refs_outside_current_head() {
        let root = init_branched_repo("log-all");
        let path_str = root.path.to_string_lossy().into_owned();

        let mut options = default_log_options();
        options.all = true;

        let page = super::log(
            &root.registry,
            &path_str,
            &options,
            &WorkspaceEnv::Local,
        )
        .expect("log returns page");

        // `--all` walks every ref. The merge + the feature follow-up should
        // both be reachable — even if HEAD was detached, both would appear.
        let subjects: Vec<&str> = page.entries.iter().map(|e| e.subject.as_str()).collect();
        let has_merge = subjects.iter().any(|s| s.contains("merge feature"));
        let has_follow_up = subjects.iter().any(|s| s.contains("feature follow-up"));
        let has_main_only = subjects.iter().any(|s| s.contains("main only"));
        assert!(has_merge && has_follow_up && has_main_only);
    }

    #[test]
    fn log_classifies_refs_as_head_local_remote_tag() {
        let root = init_branched_repo("log-refs-classify");
        let path_str = root.path.to_string_lossy().into_owned();

        let mut options = default_log_options();
        options.all = true;
        options.limit = Some(50);

        let page = super::log(
            &root.registry,
            &path_str,
            &options,
            &WorkspaceEnv::Local,
        )
        .expect("log returns page");

        // The merge commit on main is the tip — it should carry the HEAD ref, the
        // `main` local-branch, and the `v1.0` tag. HEAD is its own entry
        // with kind `head`; the branch it points to is a separate entry.
        let merge_entry = page
            .entries
            .iter()
            .find(|e| e.subject.contains("merge feature"))
            .expect("merge commit must be present");
        assert!(
            merge_entry.refs.iter().any(|r| r.kind == "head"
                && r.name == "HEAD"
                && r.is_head),
            "merge commit should carry the HEAD ref: {:?}",
            merge_entry.refs,
        );
        assert!(
            merge_entry.refs.iter().any(|r| r.kind == "local-branch"
                && r.name == "main"
                && !r.is_head),
            "merge commit should carry the main local-branch: {:?}",
            merge_entry.refs,
        );
        assert!(
            merge_entry.refs.iter().any(|r| r.kind == "tag" && r.name == "v1.0"),
            "merge commit should carry the v1.0 tag ref: {:?}",
            merge_entry.refs,
        );

        // The feature follow-up commit is on the `feature` branch only.
        let feature_entry = page
            .entries
            .iter()
            .find(|e| e.subject.contains("feature follow-up"))
            .expect("feature follow-up commit must be present");
        assert!(
            feature_entry.refs.iter().any(|r| r.kind == "local-branch"
                && r.name == "feature"
                && !r.is_head),
            "feature follow-up should carry the feature local branch: {:?}",
            feature_entry.refs,
        );
    }

    #[test]
    fn log_offset_paginates_without_duplicates() {
        let root = init_branched_repo("log-offset");
        let path_str = root.path.to_string_lossy().into_owned();

        let mut page_one = default_log_options();
        page_one.limit = Some(2);
        page_one.offset = Some(0);

        let mut page_two = default_log_options();
        page_two.limit = Some(2);
        page_two.offset = Some(2);

        let one = super::log(
            &root.registry,
            &path_str,
            &page_one,
            &WorkspaceEnv::Local,
        )
        .expect("first page");
        let two = super::log(
            &root.registry,
            &path_str,
            &page_two,
            &WorkspaceEnv::Local,
        )
        .expect("second page");

        assert_eq!(one.entries.len(), 2);
        let page_one_shas: std::collections::HashSet<&str> =
            one.entries.iter().map(|e| e.sha.as_str()).collect();

        for entry in &two.entries {
            assert!(
                !page_one_shas.contains(entry.sha.as_str()),
                "offset page must not repeat page 1 entries, duplicated: {}",
                entry.sha,
            );
        }

        // Page 1 is the newest two commits; with `main` checked out, page 1
        // must report has_more (we know there are at least 4 commits).
        assert!(one.has_more, "page 1 should report more available");
    }

    #[test]
    fn log_has_more_false_when_last_page_reached() {
        let root = init_branched_repo("log-has-more-false");
        let path_str = root.path.to_string_lossy().into_owned();

        let mut options = default_log_options();
        options.limit = Some(200);
        options.offset = Some(0);

        let page = super::log(
            &root.registry,
            &path_str,
            &options,
            &WorkspaceEnv::Local,
        )
        .expect("log returns page");

        assert!(!page.has_more, "limit >> history size => has_more must be false");
    }

    #[test]
    fn log_invalid_ref_is_rejected() {
        let root = init_branched_repo("log-invalid-ref");
        let path_str = root.path.to_string_lossy().into_owned();

        let mut options = default_log_options();
        options.ref_name = Some("does-not-exist".to_string());

        let result = super::log(
            &root.registry,
            &path_str,
            &options,
            &WorkspaceEnv::Local,
        );

        assert!(result.is_err(), "unknown ref must surface an error");
    }

    #[test]
    fn log_empty_repo_returns_empty_page_without_has_more() {
        let root = make_root("log-empty-repo");
        init_git_repo(&root.path, "main");
        // Reset back to the init commit then drop the only commit by deleting
        // the branch tip — easiest path is `update-ref -d HEAD`.
        run_git(&root.path, &["update-ref", "-d", "refs/heads/main"]);
        run_git(
            &root.path,
            &["symbolic-ref", "HEAD", "refs/heads/main"],
        );
        let path_str = root.path.to_string_lossy().into_owned();

        let page = super::log(
            &root.registry,
            &path_str,
            &default_log_options(),
            &WorkspaceEnv::Local,
        )
        .expect("log on empty repo returns empty page");

        assert!(page.entries.is_empty());
        assert!(!page.has_more);
    }
}
