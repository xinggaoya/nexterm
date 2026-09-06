use std::ffi::{OsStr, OsString};

use crate::modules::git::errors::{GitError, Result};
use crate::modules::git::parser::parse_stash_lines;
use crate::modules::git::process::{ensure_success, git_stdout_line_opt, git_stdout_lines, run_git};
use crate::modules::git::types::{
    GitStashEntry, GitStashPushOptions, GitStashResult, DEFAULT_TIMEOUT_SECS,
};
use crate::modules::workspace::{WorkspaceEnv, WorkspaceRegistry};

use super::{combined_output_text, sha_is_safe, validate_git_name, with_repo};

pub fn stash_list(
    registry: &WorkspaceRegistry,
    repo_root: &str,
    workspace: &WorkspaceEnv,
) -> Result<Vec<GitStashEntry>> {
    with_repo(registry, repo_root, workspace, |repo_root| {
        // `%H` is the full SHA; `%h` is the abbreviated form. Both go in the
        // DTO so destructive ops can use the full hash for selector stability
        // checks while the UI keeps the short hash readable.
        let lines = git_stdout_lines(
            &repo_root.workspace,
            &repo_root.git_path,
            ["stash", "list", "--format=%gd%x1f%H%x1f%h%x1f%cr%x1f%s"],
        )?;
        Ok(parse_stash_lines(&lines.join("\n")))
    })
}

pub fn stash_push(
    registry: &WorkspaceRegistry,
    repo_root: &str,
    options: &GitStashPushOptions,
    workspace: &WorkspaceEnv,
) -> Result<GitStashResult> {
    with_repo(registry, repo_root, workspace, |repo_root| {
        let mut args: Vec<OsString> = vec!["stash".into(), "push".into()];
        if options.include_untracked {
            args.push("-u".into());
        }
        if options.keep_index {
            args.push("-k".into());
        }
        if let Some(message) = options
            .message
            .as_deref()
            .map(str::trim)
            .filter(|m| !m.is_empty())
        {
            args.push("-m".into());
            args.push(message.into());
        }
        let output = run_git(
            &repo_root.workspace,
            Some(&repo_root.git_path),
            args,
            DEFAULT_TIMEOUT_SECS,
        )?;
        ensure_success(&output, "git stash push failed")?;
        let message = combined_output_text(&output);
        let stashed = !message.to_ascii_lowercase().contains("no local changes");
        Ok(GitStashResult {
            stashed,
            message: fallback_message(message, "Saved working directory"),
        })
    })
}

pub fn stash_pop(
    registry: &WorkspaceRegistry,
    repo_root: &str,
    selector: &str,
    expected_sha: Option<&str>,
    workspace: &WorkspaceEnv,
) -> Result<GitStashResult> {
    run_stash_selector_command(registry, repo_root, "pop", selector, expected_sha, workspace)
}

pub fn stash_drop(
    registry: &WorkspaceRegistry,
    repo_root: &str,
    selector: &str,
    expected_sha: Option<&str>,
    workspace: &WorkspaceEnv,
) -> Result<GitStashResult> {
    run_stash_selector_command(registry, repo_root, "drop", selector, expected_sha, workspace)
}

pub fn stash_apply(
    registry: &WorkspaceRegistry,
    repo_root: &str,
    selector: &str,
    expected_sha: Option<&str>,
    workspace: &WorkspaceEnv,
) -> Result<GitStashResult> {
    run_stash_selector_command(
        registry,
        repo_root,
        "apply",
        selector,
        expected_sha,
        workspace,
    )
}

fn run_stash_selector_command(
    registry: &WorkspaceRegistry,
    repo_root: &str,
    action: &'static str,
    selector: &str,
    expected_sha: Option<&str>,
    workspace: &WorkspaceEnv,
) -> Result<GitStashResult> {
    with_repo(registry, repo_root, workspace, |repo_root| {
        let selector = validate_git_name(selector, "stash")?;
        if let Some(expected) = expected_sha {
            if !sha_is_safe(expected) {
                return Err(GitError::command(
                    "git stash operation",
                    "invalid expected_sha",
                ));
            }
            let resolved = git_stdout_line_opt(
                &repo_root.workspace,
                &repo_root.git_path,
                ["rev-parse", "--verify", &format!("{selector}^{{commit}}")],
            )?;
            match resolved.as_deref() {
                Some(actual) if actual.eq_ignore_ascii_case(expected) => {}
                Some(actual) => {
                    return Err(GitError::command(
                        "git stash operation",
                        format!(
                            "stash selector no longer matches expected commit (expected {expected}, got {actual})"
                        ),
                    ));
                }
                None => {
                    return Err(GitError::command(
                        "git stash operation",
                        "stash selector could not be resolved",
                    ));
                }
            }
        }
        let output = run_git(
            &repo_root.workspace,
            Some(&repo_root.git_path),
            [
                OsStr::new("stash"),
                OsStr::new(action),
                OsStr::new(&selector),
            ],
            DEFAULT_TIMEOUT_SECS,
        )?;
        ensure_success(&output, "git stash operation failed")?;
        let message = combined_output_text(&output);
        Ok(GitStashResult {
            stashed: true,
            message: fallback_message(message, "Updated stash"),
        })
    })
}

fn fallback_message(message: String, fallback: &str) -> String {
    if message.trim().is_empty() {
        fallback.to_string()
    } else {
        message
    }
}

#[cfg(test)]
mod tests {
    use crate::modules::git::operations::test_support::{
        init_git_repo, make_root, run_git, write_file,
    };
    use crate::modules::workspace::WorkspaceEnv;
    use std::process::Command;

    #[test]
    fn stash_list_emits_full_and_short_sha() {
        let root = make_root("stash-list");
        init_git_repo(&root.path, "main");
        write_file(&root.path, "tracked.txt", "v1\n");
        run_git(&root.path, &["add", "tracked.txt"]);
        run_git(&root.path, &["commit", "-m", "first"]);
        write_file(&root.path, "tracked.txt", "v2\n");
        let path_str = root.path.to_string_lossy().into_owned();

        let options = super::GitStashPushOptions {
            message: Some("checkpoint".into()),
            include_untracked: false,
            keep_index: false,
        };
        super::stash_push(
            &root.registry,
            &path_str,
            &options,
            &WorkspaceEnv::Local,
        )
        .expect("stash push succeeds");

        // Resolve the stash commit's full SHA directly so we can compare
        // apples to apples — the DTO's `short_sha` is derived from the
        // stash commit, not from HEAD.
        let resolved = Command::new("git")
            .arg("-C")
            .arg(&root.path)
            .args(["rev-parse", "stash@{0}"])
            .env("LC_ALL", "C")
            .output()
            .expect("rev-parse stash@{0}");
        let resolved_full =
            String::from_utf8_lossy(&resolved.stdout).trim().to_string();

        let entries =
            super::stash_list(&root.registry, &path_str, &WorkspaceEnv::Local)
                .expect("stash list succeeds");
        assert_eq!(entries.len(), 1);
        let entry = &entries[0];
        assert_eq!(entry.selector, "stash@{0}");
        assert_eq!(entry.full_sha, resolved_full);
        assert_eq!(entry.short_sha, resolved_full.chars().take(7).collect::<String>());
        assert!(entry.message.contains("checkpoint"));
    }

    #[test]
    fn stash_pop_rejects_selector_when_expected_sha_mismatches() {
        let root = make_root("stash-pop-guard");
        init_git_repo(&root.path, "main");
        write_file(&root.path, "tracked.txt", "v1\n");
        run_git(&root.path, &["add", "tracked.txt"]);
        run_git(&root.path, &["commit", "-m", "first"]);
        write_file(&root.path, "tracked.txt", "v2\n");
        let path_str = root.path.to_string_lossy().into_owned();

        let options = super::GitStashPushOptions {
            message: None,
            include_untracked: false,
            keep_index: false,
        };
        super::stash_push(
            &root.registry,
            &path_str,
            &options,
            &WorkspaceEnv::Local,
        )
        .expect("stash push succeeds");

        let entries =
            super::stash_list(&root.registry, &path_str, &WorkspaceEnv::Local)
                .expect("stash list succeeds");
        let real_sha = entries[0].full_sha.clone();

        let wrong = super::stash_pop(
            &root.registry,
            &path_str,
            "stash@{0}",
            Some("0000000000000000000000000000000000000000"),
            &WorkspaceEnv::Local,
        );
        assert!(wrong.is_err(), "mismatched sha must reject pop");

        let good = super::stash_pop(
            &root.registry,
            &path_str,
            "stash@{0}",
            Some(&real_sha),
            &WorkspaceEnv::Local,
        );
        assert!(good.is_ok(), "matching sha should accept pop");
    }

    #[test]
    fn stash_apply_keeps_entry_on_stack() {
        let root = make_root("stash-apply");
        init_git_repo(&root.path, "main");
        write_file(&root.path, "tracked.txt", "v1\n");
        run_git(&root.path, &["add", "tracked.txt"]);
        run_git(&root.path, &["commit", "-m", "first"]);
        write_file(&root.path, "tracked.txt", "v2\n");
        let path_str = root.path.to_string_lossy().into_owned();

        let options = super::GitStashPushOptions {
            message: None,
            include_untracked: false,
            keep_index: false,
        };
        super::stash_push(
            &root.registry,
            &path_str,
            &options,
            &WorkspaceEnv::Local,
        )
        .expect("stash push succeeds");

        super::stash_apply(
            &root.registry,
            &path_str,
            "stash@{0}",
            None,
            &WorkspaceEnv::Local,
        )
        .expect("stash apply succeeds");

        let entries =
            super::stash_list(&root.registry, &path_str, &WorkspaceEnv::Local)
                .expect("stash list succeeds");
        assert_eq!(entries.len(), 1, "apply must not drop the entry");
    }
}
