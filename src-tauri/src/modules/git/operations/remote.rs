use std::ffi::OsString;

use crate::modules::git::errors::{GitError, Result};
use crate::modules::git::parser::{parse_fetch_summary, parse_pull_summary};
use crate::modules::git::process::{ensure_success, git_stdout_line_opt, git_stdout_lines, run_git};
use crate::modules::git::types::{
    GitFetchResult, GitPullResult, GitRemoteInfo, GitRemoteInput, GitRemoteUrlUpdate,
    DEFAULT_TIMEOUT_SECS, NETWORK_TIMEOUT_SECS,
};
use crate::modules::workspace::{WorkspaceEnv, WorkspaceRegistry};

use super::{combined_output_text, with_repo};

pub fn remote_url(
    registry: &WorkspaceRegistry,
    repo_root: &str,
    name: &str,
    workspace: &WorkspaceEnv,
) -> Result<Option<String>> {
    with_repo(registry, repo_root, workspace, |repo_root| {
        if name.is_empty() || name.len() > 64 || !name.chars().all(is_remote_name_char) {
            return Ok(None);
        }
        git_stdout_line_opt(
            &repo_root.workspace,
            &repo_root.git_path,
            ["config", "--get", &format!("remote.{name}.url")],
        )
    })
}

pub fn remote_list(
    registry: &WorkspaceRegistry,
    repo_root: &str,
    workspace: &WorkspaceEnv,
) -> Result<Vec<GitRemoteInfo>> {
    with_repo(registry, repo_root, workspace, |repo_root| {
        let names = git_stdout_lines(&repo_root.workspace, &repo_root.git_path, ["remote"])?;
        let mut out: Vec<GitRemoteInfo> = Vec::with_capacity(names.len());
        for raw in names {
            let name = parse_remote_name(&raw);
            if name.is_empty() || !name.chars().all(is_remote_name_char) || name.len() > 64 {
                continue;
            }
            let fetch_url = git_stdout_line_opt(
                &repo_root.workspace,
                &repo_root.git_path,
                ["config", "--get", &format!("remote.{name}.url")],
            )?
            .unwrap_or_default();
            let push_url = git_stdout_line_opt(
                &repo_root.workspace,
                &repo_root.git_path,
                ["config", "--get", &format!("remote.{name}.pushurl")],
            )?
            .filter(|s| !s.is_empty())
            .unwrap_or_else(|| fetch_url.clone());
            out.push(GitRemoteInfo {
                name,
                fetch_url,
                push_url,
            });
        }
        Ok(out)
    })
}

pub fn remote_add(
    registry: &WorkspaceRegistry,
    repo_root: &str,
    input: &GitRemoteInput,
    workspace: &WorkspaceEnv,
) -> Result<GitRemoteInfo> {
    with_repo(registry, repo_root, workspace, |repo_root| {
        validate_remote_name(&input.name)?;
        if input.url.trim().is_empty() {
            return Err(GitError::command(
                "git remote add",
                "remote URL cannot be empty",
            ));
        }
        let output = run_git(
            &repo_root.workspace,
            Some(&repo_root.git_path),
            [
                OsString::from("remote"),
                OsString::from("add"),
                OsString::from(input.name.clone()),
                OsString::from(input.url.clone()),
            ],
            DEFAULT_TIMEOUT_SECS,
        )?;
        ensure_success(&output, "git remote add failed")?;
        let fetch_url = input.url.trim().to_string();
        Ok(GitRemoteInfo {
            name: input.name.clone(),
            fetch_url: fetch_url.clone(),
            push_url: fetch_url,
        })
    })
}

pub fn remote_remove(
    registry: &WorkspaceRegistry,
    repo_root: &str,
    name: &str,
    workspace: &WorkspaceEnv,
) -> Result<()> {
    with_repo(registry, repo_root, workspace, |repo_root| {
        validate_remote_name(name)?;
        let output = run_git(
            &repo_root.workspace,
            Some(&repo_root.git_path),
            [
                OsString::from("remote"),
                OsString::from("remove"),
                OsString::from(name),
            ],
            DEFAULT_TIMEOUT_SECS,
        )?;
        ensure_success(&output, "git remote remove failed")
    })
}

pub fn remote_set_url(
    registry: &WorkspaceRegistry,
    repo_root: &str,
    input: &GitRemoteUrlUpdate,
    workspace: &WorkspaceEnv,
) -> Result<GitRemoteInfo> {
    with_repo(registry, repo_root, workspace, |repo_root| {
        validate_remote_name(&input.name)?;
        if input.new_url.trim().is_empty() {
            return Err(GitError::command(
                "git remote set-url",
                "remote URL cannot be empty",
            ));
        }
        let output = run_git(
            &repo_root.workspace,
            Some(&repo_root.git_path),
            [
                OsString::from("remote"),
                OsString::from("set-url"),
                OsString::from(input.name.clone()),
                OsString::from(input.new_url.clone()),
            ],
            DEFAULT_TIMEOUT_SECS,
        )?;
        ensure_success(&output, "git remote set-url failed")?;
        let fetch_url = input.new_url.trim().to_string();
        let push_url = git_stdout_line_opt(
            &repo_root.workspace,
            &repo_root.git_path,
            ["config", "--get", &format!("remote.{}.pushurl", input.name)],
        )?
        .filter(|s| !s.is_empty())
        .unwrap_or_else(|| fetch_url.clone());
        Ok(GitRemoteInfo {
            name: input.name.clone(),
            fetch_url,
            push_url,
        })
    })
}

fn is_remote_name_char(c: char) -> bool {
    c.is_ascii_alphanumeric() || c == '-' || c == '_' || c == '.'
}

/// `pub(super)` 供 `tag::push_tag` 复用同一套远端名校验。
pub(super) fn validate_remote_name(name: &str) -> Result<()> {
    if name.is_empty() || name.len() > 64 {
        return Err(GitError::command(
            "git remote",
            format!("invalid remote name: {name}"),
        ));
    }
    // 首字符必须为字母或下划线;`is_some_and` 同时覆盖空串与首字符校验,
    // 避免 unwrap。
    let mut chars = name.chars();
    if !chars.next().is_some_and(|first| first.is_ascii_alphanumeric() || first == '_') {
        return Err(GitError::command(
            "git remote",
            format!("invalid remote name: {name}"),
        ));
    }
    if !chars.all(is_remote_name_char) {
        return Err(GitError::command(
            "git remote",
            format!("invalid remote name: {name}"),
        ));
    }
    Ok(())
}

/// `git remote` may wrap names containing special characters in double quotes
/// and escape inner quotes / backslashes; strip that wrapper so the caller
/// gets the literal name. Empty lines (e.g. trailing newline) yield an empty
/// string, which the caller will skip via the validity check.
fn parse_remote_name(raw: &str) -> String {
    let trimmed = raw.trim();
    if trimmed.starts_with('"') && trimmed.ends_with('"') && trimmed.len() >= 2 {
        let inner = &trimmed[1..trimmed.len() - 1];
        let mut out = String::with_capacity(inner.len());
        let mut iter = inner.chars().peekable();
        while let Some(c) = iter.next() {
            if c == '\\' {
                if let Some(next) = iter.next() {
                    out.push(next);
                }
            } else {
                out.push(c);
            }
        }
        return out;
    }
    trimmed.to_string()
}

pub fn fetch(
    registry: &WorkspaceRegistry,
    repo_root: &str,
    workspace: &WorkspaceEnv,
) -> Result<GitFetchResult> {
    with_repo(registry, repo_root, workspace, |repo_root| {
        let output = run_git(
            &repo_root.workspace,
            Some(&repo_root.git_path),
            ["fetch", "--prune"],
            NETWORK_TIMEOUT_SECS,
        )?;
        ensure_success(&output, "git fetch failed")?;
        Ok(parse_fetch_summary(&combined_output_text(&output)))
    })
}

pub fn pull_ff_only(
    registry: &WorkspaceRegistry,
    repo_root: &str,
    workspace: &WorkspaceEnv,
) -> Result<GitPullResult> {
    with_repo(registry, repo_root, workspace, |repo_root| {
        let output = run_git(
            &repo_root.workspace,
            Some(&repo_root.git_path),
            ["pull", "--ff-only", "--stat"],
            NETWORK_TIMEOUT_SECS,
        )?;
        ensure_success(&output, "git pull --ff-only failed")?;
        Ok(parse_pull_summary(&combined_output_text(&output)))
    })
}

#[cfg(test)]
mod tests {
    use crate::modules::git::operations::test_support::{init_git_repo, make_root, run_git};
    use crate::modules::git::types::{GitRemoteInput, GitRemoteUrlUpdate};
    use crate::modules::workspace::WorkspaceEnv;
    use std::path::Path;
    use std::process::Command;

    // --- remote management helpers / operations ----------------------------

    fn run_capture(root: &Path, args: &[&str]) -> String {
        let out = Command::new("git")
            .arg("-C")
            .arg(root)
            .args(args)
            .env("LC_ALL", "C")
            .output()
            .expect("git command");
        assert!(out.status.success(), "git {args:?} failed");
        String::from_utf8_lossy(&out.stdout).into_owned()
    }

    #[test]
    fn validate_remote_name_accepts_common_names() {
        for name in ["origin", "upstream", "remote_1", "a.b-c", "origin1", "_internal"] {
            super::validate_remote_name(name)
                .unwrap_or_else(|e| panic!("expected {name} to be valid, got {e}"));
        }
    }

    #[test]
    fn validate_remote_name_rejects_bad_names() {
        for name in [
            "",
            " leading",
            "-leading",
            "has space",
            "name:colon",
            "semi;colon",
            "with/slash",
            &"x".repeat(65),
        ] {
            assert!(
                super::validate_remote_name(name).is_err(),
                "expected {name:?} to be rejected"
            );
        }
    }

    #[test]
    fn parse_remote_name_passes_plain_names_through() {
        assert_eq!(super::parse_remote_name("origin"), "origin");
        assert_eq!(super::parse_remote_name("  origin  "), "origin");
    }

    #[test]
    fn parse_remote_name_unwraps_double_quoted_names() {
        assert_eq!(
            super::parse_remote_name("\"weird name\""),
            "weird name"
        );
        // Escapes inside the quoted form should be unescaped exactly once.
        assert_eq!(
            super::parse_remote_name("\"a\\\\b\\\"c\""),
            "a\\b\"c"
        );
    }

    #[test]
    fn remote_list_on_empty_repo_returns_empty() {
        let root = make_root("remote-list-empty");
        init_git_repo(&root.path, "main");
        let path_str = root.path.to_string_lossy().into_owned();

        let list = super::remote_list(
            &root.registry,
            &path_str,
            &WorkspaceEnv::Local,
        )
        .expect("remote list succeeds");

        assert!(list.is_empty());
    }

    #[test]
    fn remote_add_then_list_then_remove_round_trip() {
        let root = make_root("remote-add-remove");
        init_git_repo(&root.path, "main");
        let path_str = root.path.to_string_lossy().into_owned();

        // Add an origin.
        let added = super::remote_add(
            &root.registry,
            &path_str,
            &GitRemoteInput {
                name: "origin".into(),
                url: "git@github.com:test/test.git".into(),
            },
            &WorkspaceEnv::Local,
        )
        .expect("remote add succeeds");
        assert_eq!(added.name, "origin");
        assert_eq!(added.fetch_url, "git@github.com:test/test.git");
        assert_eq!(added.push_url, "git@github.com:test/test.git");

        // Add a second remote with a separate pushurl.
        super::remote_add(
            &root.registry,
            &path_str,
            &GitRemoteInput {
                name: "upstream".into(),
                url: "git@github.com:up/up.git".into(),
            },
            &WorkspaceEnv::Local,
        )
        .expect("remote add upstream succeeds");
        run_git(
            &root.path,
            &[
                "config",
                "remote.upstream.pushurl",
                "git@github.com:up/push.git",
            ],
        );

        let list = super::remote_list(
            &root.registry,
            &path_str,
            &WorkspaceEnv::Local,
        )
        .expect("remote list succeeds");
        assert_eq!(list.len(), 2);
        let origin = list.iter().find(|r| r.name == "origin").expect("origin");
        assert_eq!(origin.fetch_url, "git@github.com:test/test.git");
        assert_eq!(origin.push_url, origin.fetch_url);
        let upstream = list.iter().find(|r| r.name == "upstream").expect("upstream");
        assert_eq!(upstream.fetch_url, "git@github.com:up/up.git");
        assert_eq!(upstream.push_url, "git@github.com:up/push.git");

        // Update origin's URL.
        let updated = super::remote_set_url(
            &root.registry,
            &path_str,
            &GitRemoteUrlUpdate {
                name: "origin".into(),
                new_url: "git@github.com:test/test-renamed.git".into(),
            },
            &WorkspaceEnv::Local,
        )
        .expect("remote set-url succeeds");
        assert_eq!(updated.fetch_url, "git@github.com:test/test-renamed.git");
        // The previous URL should be gone now.
        assert!(
            !run_capture(&root.path, &["remote", "get-url", "origin"]).contains("test/test.git"),
            "old URL should be replaced"
        );

        // Remove origin.
        super::remote_remove(
            &root.registry,
            &path_str,
            "origin",
            &WorkspaceEnv::Local,
        )
        .expect("remote remove succeeds");
        let list_after =
            super::remote_list(&root.registry, &path_str, &WorkspaceEnv::Local)
                .expect("remote list after remove");
        assert_eq!(list_after.len(), 1);
        assert_eq!(list_after[0].name, "upstream");
    }

    #[test]
    fn remote_add_rejects_duplicate_name() {
        let root = make_root("remote-duplicate");
        init_git_repo(&root.path, "main");
        let path_str = root.path.to_string_lossy().into_owned();

        super::remote_add(
            &root.registry,
            &path_str,
            &GitRemoteInput {
                name: "origin".into(),
                url: "git@github.com:test/a.git".into(),
            },
            &WorkspaceEnv::Local,
        )
        .expect("first add succeeds");

        let err = super::remote_add(
            &root.registry,
            &path_str,
            &GitRemoteInput {
                name: "origin".into(),
                url: "git@github.com:test/b.git".into(),
            },
            &WorkspaceEnv::Local,
        )
        .expect_err("second add must fail");
        assert!(err.to_string().contains("git remote add"));
    }

    #[test]
    fn remote_remove_missing_returns_error() {
        let root = make_root("remote-remove-missing");
        init_git_repo(&root.path, "main");
        let path_str = root.path.to_string_lossy().into_owned();

        let err = super::remote_remove(
            &root.registry,
            &path_str,
            "missing",
            &WorkspaceEnv::Local,
        )
        .expect_err("removing missing remote must fail");
        assert!(err.to_string().contains("git remote remove"));
    }

    #[test]
    fn remote_set_url_rejects_invalid_name() {
        let root = make_root("remote-bad-name");
        init_git_repo(&root.path, "main");
        let path_str = root.path.to_string_lossy().into_owned();

        let err = super::remote_set_url(
            &root.registry,
            &path_str,
            &GitRemoteUrlUpdate {
                name: "-leading".into(),
                new_url: "git@github.com:test/test.git".into(),
            },
            &WorkspaceEnv::Local,
        )
        .expect_err("invalid name must be rejected");
        assert!(err.to_string().contains("invalid remote name"));
    }
}
