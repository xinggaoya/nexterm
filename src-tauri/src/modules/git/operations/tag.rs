use std::ffi::{OsStr, OsString};

use crate::modules::git::errors::{GitError, Result};
use crate::modules::git::parser::parse_tag_lines;
use crate::modules::git::process::{
    ensure_success, git_stdout_line_opt, git_stdout_lines, run_git,
};
use crate::modules::git::types::{
    GitPushResult, GitTagCreateOptions, GitTagInfo, GitTagResult, DEFAULT_TIMEOUT_SECS,
    NETWORK_TIMEOUT_SECS,
};
use crate::modules::workspace::{WorkspaceEnv, WorkspaceRegistry};

use super::{validate_git_name, with_repo};
use super::remote::validate_remote_name;

const TAG_LIST_FORMAT_ARG: &str = "--format=%(refname:short)%1f%(refname)%1f%(objectname:short)%1f%(subject)%1f%(creatordate:unix)%1f%(objecttype)";

pub fn tag_list(
    registry: &WorkspaceRegistry,
    repo_root: &str,
    workspace: &WorkspaceEnv,
) -> Result<Vec<GitTagInfo>> {
    with_repo(registry, repo_root, workspace, |repo_root| {
        let lines = git_stdout_lines(
            &repo_root.workspace,
            &repo_root.git_path,
            [
                "for-each-ref",
                TAG_LIST_FORMAT_ARG,
                "--sort=-creatordate",
                "refs/tags",
            ],
        )?;
        Ok(parse_tag_lines(&lines.join("\n")))
    })
}

pub fn create_tag(
    registry: &WorkspaceRegistry,
    repo_root: &str,
    options: &GitTagCreateOptions,
    workspace: &WorkspaceEnv,
) -> Result<GitTagResult> {
    with_repo(registry, repo_root, workspace, |repo_root| {
        let name = validate_git_name(&options.name, "tag")?;
        // validate_git_name 只挡空名 / `-` 开头 / 控制字符;check-ref-format
        // 再补上 git 引用名的完整规则(空格、`..`、`@{`、以 `.lock` 结尾等)。
        let check = run_git(
            &repo_root.workspace,
            Some(&repo_root.git_path),
            [
                OsStr::new("check-ref-format"),
                OsStr::new(&format!("refs/tags/{name}")),
            ],
            DEFAULT_TIMEOUT_SECS,
        )?;
        ensure_success(&check, "invalid tag name")?;

        let message = options
            .message
            .as_deref()
            .map(str::trim)
            .filter(|m| !m.is_empty());
        let mut args: Vec<OsString> = vec![OsString::from("tag")];
        if let Some(message) = message {
            args.push(OsString::from("-a"));
            args.push(OsString::from("-m"));
            args.push(OsString::from(message));
        }
        args.push(name.clone().into());
        let output = run_git(
            &repo_root.workspace,
            Some(&repo_root.git_path),
            args,
            DEFAULT_TIMEOUT_SECS,
        )?;
        ensure_success(&output, "git tag failed")?;
        Ok(GitTagResult { name })
    })
}

pub fn delete_tag(
    registry: &WorkspaceRegistry,
    repo_root: &str,
    name: &str,
    workspace: &WorkspaceEnv,
) -> Result<GitTagResult> {
    with_repo(registry, repo_root, workspace, |repo_root| {
        let name = validate_git_name(name, "tag")?;
        let output = run_git(
            &repo_root.workspace,
            Some(&repo_root.git_path),
            [OsStr::new("tag"), OsStr::new("-d"), OsStr::new(&name)],
            DEFAULT_TIMEOUT_SECS,
        )?;
        ensure_success(&output, "git tag -d failed")?;
        Ok(GitTagResult { name })
    })
}

/// 推送单个标签到远端。`remote` 缺省时回退为 `origin`(存在时),否则取
/// `git remote` 的第一个;两者都不可用时返回显式错误。
pub fn push_tag(
    registry: &WorkspaceRegistry,
    repo_root: &str,
    name: &str,
    remote: Option<&str>,
    workspace: &WorkspaceEnv,
) -> Result<GitPushResult> {
    with_repo(registry, repo_root, workspace, |repo_root| {
        let name = validate_git_name(name, "tag")?;
        let remote = match remote.map(str::trim).filter(|r| !r.is_empty()) {
            Some(explicit) => {
                validate_remote_name(explicit)?;
                explicit.to_string()
            }
            None => resolve_default_remote(&repo_root.workspace, &repo_root.git_path)?,
        };
        let output = run_git(
            &repo_root.workspace,
            Some(&repo_root.git_path),
            [
                OsStr::new("push"),
                OsStr::new(&remote),
                OsStr::new(&name),
            ],
            NETWORK_TIMEOUT_SECS,
        )?;
        ensure_success(&output, "git push failed")?;
        Ok(GitPushResult {
            remote: Some(remote),
            branch: Some(name),
            pushed: true,
        })
    })
}

fn resolve_default_remote(workspace: &WorkspaceEnv, git_path: &str) -> Result<String> {
    let has_origin = git_stdout_line_opt(
        workspace,
        git_path,
        ["config", "--get", "remote.origin.url"],
    )?
    .is_some();
    if has_origin {
        return Ok("origin".to_string());
    }
    let names = git_stdout_lines(workspace, git_path, ["remote"])?;
    names
        .into_iter()
        .map(|n| n.trim().to_string())
        .find(|n| !n.is_empty())
        .ok_or_else(|| {
            GitError::command("git push", "no remote configured to push tags to")
        })
}

#[cfg(test)]
mod tests {
    use super::{create_tag, delete_tag, push_tag, tag_list};
    use crate::modules::git::operations::test_support::{init_git_repo, make_root, run_git};
    use crate::modules::git::types::GitTagCreateOptions;
    use crate::modules::workspace::WorkspaceEnv;

    fn local_env() -> WorkspaceEnv {
        WorkspaceEnv::Local
    }

    fn tag_options(name: &str, message: Option<&str>) -> GitTagCreateOptions {
        GitTagCreateOptions {
            name: name.to_string(),
            message: message.map(str::to_string),
        }
    }

    #[test]
    fn tag_list_returns_newest_first_with_annotation_flag() {
        let root = make_root("tag-list");
        init_git_repo(&root.path, "main");
        run_git(&root.path, &["tag", "v0.9"]);
        run_git(&root.path, &["tag", "-a", "v1.0", "-m", "release one"]);
        let path_str = root.path.to_string_lossy().into_owned();

        let tags = tag_list(&root.registry, &path_str, &local_env()).expect("tag list");

        assert_eq!(tags.len(), 2);
        // --sort=-creatordate:两个标签落在同一提交上时按 refname 逆序稳定
        // 输出,v1.0 在前。
        assert_eq!(tags[0].name, "v1.0");
        assert!(tags[0].is_annotated);
        assert_eq!(tags[0].subject, "release one");
        assert_eq!(tags[0].full_ref, "refs/tags/v1.0");
        assert!(!tags[0].short_sha.is_empty());
        assert_eq!(tags[1].name, "v0.9");
        assert!(!tags[1].is_annotated);
        assert_eq!(tags[1].subject, "init");
    }

    #[test]
    fn create_tag_round_trip_lightweight_and_annotated() {
        let root = make_root("tag-create");
        init_git_repo(&root.path, "main");
        let path_str = root.path.to_string_lossy().into_owned();

        let light = create_tag(
            &root.registry,
            &path_str,
            &tag_options("v0.1", None),
            &local_env(),
        )
        .expect("lightweight tag");
        assert_eq!(light.name, "v0.1");

        let annotated = create_tag(
            &root.registry,
            &path_str,
            &tag_options("v0.2", Some("second release")),
            &local_env(),
        )
        .expect("annotated tag");
        assert_eq!(annotated.name, "v0.2");

        let tags = tag_list(&root.registry, &path_str, &local_env()).expect("tag list");
        assert_eq!(tags.len(), 2);
        let annotated_entry = tags.iter().find(|t| t.name == "v0.2").expect("v0.2");
        assert!(annotated_entry.is_annotated);
        assert_eq!(annotated_entry.subject, "second release");

        // 重复创建必须失败,错误来自 git 本体。
        let err = create_tag(
            &root.registry,
            &path_str,
            &tag_options("v0.1", None),
            &local_env(),
        )
        .expect_err("duplicate tag must fail");
        assert!(err.to_string().contains("git tag"));
    }

    #[test]
    fn create_tag_rejects_invalid_name() {
        let root = make_root("tag-invalid");
        init_git_repo(&root.path, "main");
        let path_str = root.path.to_string_lossy().into_owned();

        for bad in ["", "-leading", "has space", "bad..name"] {
            let err = create_tag(
                &root.registry,
                &path_str,
                &tag_options(bad, None),
                &local_env(),
            )
            .expect_err("invalid tag name must fail");
            let rendered = err.to_string();
            assert!(
                rendered.contains("invalid git argument") || rendered.contains("invalid tag name"),
                "unexpected error for {bad:?}: {rendered}"
            );
        }
    }

    #[test]
    fn delete_tag_removes_existing_and_fails_on_missing() {
        let root = make_root("tag-delete");
        init_git_repo(&root.path, "main");
        let path_str = root.path.to_string_lossy().into_owned();
        create_tag(
            &root.registry,
            &path_str,
            &tag_options("gone", None),
            &local_env(),
        )
        .expect("create tag");

        let deleted = delete_tag(&root.registry, &path_str, "gone", &local_env())
            .expect("delete tag");
        assert_eq!(deleted.name, "gone");

        let tags = tag_list(&root.registry, &path_str, &local_env()).expect("tag list");
        assert!(tags.is_empty());

        let err = delete_tag(&root.registry, &path_str, "gone", &local_env())
            .expect_err("deleting missing tag must fail");
        assert!(err.to_string().contains("git tag -d"));
    }

    #[test]
    fn push_tag_requires_a_remote() {
        let root = make_root("tag-push-no-remote");
        init_git_repo(&root.path, "main");
        let path_str = root.path.to_string_lossy().into_owned();
        create_tag(
            &root.registry,
            &path_str,
            &tag_options("v1", None),
            &local_env(),
        )
        .expect("create tag");

        let err = push_tag(&root.registry, &path_str, "v1", None, &local_env())
            .expect_err("push without remotes must fail");
        assert!(err.to_string().contains("no remote configured"));
    }
}
