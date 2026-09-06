use std::collections::{HashSet, VecDeque};
use std::path::Path;

use crate::modules::git::errors::{GitError, Result};
use crate::modules::git::types::{GitRepositoryDiscovery, GitWorkspaceRepo};
use crate::modules::git::utils::{authorized_repo_root, ResolvedGitDirectory};
use crate::modules::workspace::{WorkspaceEnv, WorkspaceRegistry};

use super::{resolve_repo_in_authorized, with_repo};

// --- Bounded nested-repository discovery ----------------------------------

/// Subset of a candidate repo collected during traversal. We finish resolving
/// (branch / upstream / is_detached) once we know the candidate survived
/// authorization and deduplication.
struct CandidateRepo {
    authorized: ResolvedGitDirectory,
    relative_path: String,
    name: String,
    is_worktree: bool,
}

/// Directory names we never descend into during discovery. They are either
/// known huge (`node_modules`, `target`) or otherwise opaque to repository
/// scanning (`.git` itself). Listing `.git` here keeps the BFS from walking
/// into a gitdir and reporting phantom nested repos.
const DISCOVERY_SKIP_DIRS: &[&str] = &[
    ".git",
    "node_modules",
    "target",
    "dist",
    "build",
    "out",
    ".next",
    ".cache",
    ".idea",
    ".vscode",
    ".gradle",
];

fn is_blacklisted_dir(name: &str) -> bool {
    DISCOVERY_SKIP_DIRS.contains(&name)
}

/// Build the `find` predicate that prunes every blacklisted subtree, matching
/// the Local BFS's behavior. The leading `*/` keeps the user's authorized
/// root itself from being pruned if it happens to share a name with a
/// blacklisted directory.
#[cfg(windows)]
fn wsl_blacklist_prune_clause() -> String {
    let mut parts: Vec<String> = Vec::with_capacity(DISCOVERY_SKIP_DIRS.len());
    for name in DISCOVERY_SKIP_DIRS {
        if *name == ".git" {
            // `.git` is handled separately (we want to emit it, then prune
            // its subtree), so it does not belong in the prune clause.
            continue;
        }
        parts.push(format!("-path '*/{name}'"));
    }
    parts.join(" -o ")
}

pub fn discover_repositories(
    registry: &WorkspaceRegistry,
    root_path: &str,
    max_depth: u32,
    max_repos: u32,
    workspace: &WorkspaceEnv,
) -> Result<GitRepositoryDiscovery> {
    with_repo(registry, root_path, workspace, |root| {
        // Collect up to max_repos + 1 raw candidates so the outer loop can
        // detect "more remain" without a second pass over the tree.
        let limit = max_repos.saturating_add(1);
        let (raw_candidates, depth_more) = match workspace {
            WorkspaceEnv::Local => collect_local(registry, root, max_depth, limit),
            WorkspaceEnv::Wsl { .. } => collect_wsl(registry, root, max_depth, limit)?,
            // 命令入口已被 SSH 守卫拒绝;此处只为穷尽 match。
            WorkspaceEnv::Ssh { .. } => (Vec::new(), false),
        };

        let mut repositories: Vec<GitWorkspaceRepo> = Vec::new();
        let mut seen: HashSet<std::path::PathBuf> = HashSet::new();
        let mut truncated = depth_more;

        for candidate in raw_candidates.iter() {
            if repositories.len() as u32 >= max_repos {
                truncated = true;
                break;
            }
            if !seen.insert(candidate.authorized.local_path.clone()) {
                continue;
            }
            if !registry.is_authorized(&candidate.authorized.local_path) {
                continue;
            }
            let info = match resolve_repo_in_authorized(registry, &candidate.authorized) {
                Ok(Some(info)) => info,
                _ => continue,
            };
            repositories.push(GitWorkspaceRepo {
                repo_root: candidate.authorized.git_path.clone(),
                relative_path: candidate.relative_path.clone(),
                name: candidate.name.clone(),
                branch: info.branch,
                upstream: info.upstream,
                is_detached: info.is_detached,
                is_worktree: candidate.is_worktree,
            });
        }

        // The collector stops once it sees `limit` raw candidates; if we got
        // there, there is at least one more it deliberately skipped.
        if raw_candidates.len() as u32 >= limit {
            truncated = true;
        }

        Ok(GitRepositoryDiscovery {
            repositories,
            truncated,
        })
    })
}

fn collect_local(
    registry: &WorkspaceRegistry,
    root: &ResolvedGitDirectory,
    max_depth: u32,
    limit: u32,
) -> (Vec<CandidateRepo>, bool) {
    let mut candidates: Vec<CandidateRepo> = Vec::new();
    let mut more_remain = false;
    let mut queue: VecDeque<(std::path::PathBuf, u32)> = VecDeque::new();
    queue.push_back((root.local_path.clone(), 0));

    while let Some((dir, depth)) = queue.pop_front() {
        if let Some(candidate) = build_local_candidate(registry, root, &dir) {
            candidates.push(candidate);
            if candidates.len() as u32 >= limit {
                more_remain = true;
                break;
            }
        }

        if depth >= max_depth {
            // Hit the depth budget. Probe whether any descendable child
            // exists so the caller knows more candidates might live deeper.
            if has_descendable_subdirs(&dir) {
                more_remain = true;
            }
            continue;
        }

        let entries = match std::fs::read_dir(&dir) {
            Ok(e) => e,
            Err(_) => continue,
        };
        for entry in entries.flatten() {
            let file_name = entry.file_name();
            let name = match file_name.to_str() {
                Some(s) => s,
                None => continue,
            };
            if is_blacklisted_dir(name) {
                continue;
            }
            let entry_path = entry.path();
            let meta = match std::fs::symlink_metadata(&entry_path) {
                Ok(m) => m,
                Err(_) => continue,
            };
            if meta.file_type().is_symlink() || !meta.is_dir() {
                continue;
            }
            queue.push_back((entry_path, depth + 1));
        }
    }

    (candidates, more_remain)
}

fn has_descendable_subdirs(dir: &Path) -> bool {
    let entries = match std::fs::read_dir(dir) {
        Ok(e) => e,
        Err(_) => return false,
    };
    for entry in entries.flatten() {
        let file_name = entry.file_name();
        let name = match file_name.to_str() {
            Some(s) => s,
            None => continue,
        };
        if is_blacklisted_dir(name) {
            continue;
        }
        let meta = match std::fs::symlink_metadata(entry.path()) {
            Ok(m) => m,
            Err(_) => continue,
        };
        if meta.file_type().is_symlink() || !meta.is_dir() {
            continue;
        }
        return true;
    }
    false
}

fn build_local_candidate(
    registry: &WorkspaceRegistry,
    root: &ResolvedGitDirectory,
    dir: &Path,
) -> Option<CandidateRepo> {
    let git_entry = dir.join(".git");
    let meta = std::fs::symlink_metadata(&git_entry).ok()?;
    let ft = meta.file_type();
    if !(ft.is_dir() || ft.is_file() || ft.is_symlink()) {
        return None;
    }
    // `.git` as a file or symlink is the worktree / submodule shape. Real
    // repos carry `.git` as a directory.
    let is_worktree = ft.is_file() || ft.is_symlink();

    let dir_str = dir.to_string_lossy().replace('\\', "/");
    let authorized = authorized_repo_root(registry, &dir_str, &root.workspace).ok()?;

    let relative_path = relative_from_root(&root.local_path, &authorized.local_path);
    let name = authorized
        .local_path
        .file_name()
        .map(|s| s.to_string_lossy().into_owned())
        .unwrap_or_else(|| dir_str.clone());

    Some(CandidateRepo {
        authorized,
        relative_path,
        name,
        is_worktree,
    })
}

fn relative_from_root(root: &Path, candidate: &Path) -> String {
    match candidate.strip_prefix(root) {
        Ok(rel) => {
            let s = rel.to_string_lossy().replace('\\', "/");
            if s.is_empty() {
                ".".to_string()
            } else {
                s
            }
        }
        Err(_) => ".".to_string(),
    }
}

#[cfg(windows)]
fn collect_wsl(
    registry: &WorkspaceRegistry,
    root: &ResolvedGitDirectory,
    max_depth: u32,
    limit: u32,
) -> Result<(Vec<CandidateRepo>, bool)> {
    use crate::modules::workspace::wsl_exec_capture;
    let distro = match &root.workspace {
        WorkspaceEnv::Wsl { distro } => distro.clone(),
        WorkspaceEnv::Local | WorkspaceEnv::Ssh { .. } => {
            return Err(GitError::command(
                "git_discover_repositories",
                "internal: wsl collector called for non-wsl workspace",
            ));
        }
    };

    // Local semantics: max_depth=0 only inspects the root (and finds the
    // root repo's own `.git`). `find -maxdepth` includes the start path and
    // that many levels of children, so we add one to also cover `.git`
    // itself when it lives one level below the directory under test.
    let find_maxdepth = max_depth.saturating_add(1);
    let quoted_root = shell_quote_wsl(&root.git_path);
    let prune_clause = wsl_blacklist_prune_clause();
    // Order matters: print `.git` candidates first (so they survive the
    // `-prune` step), then prune the `.git` subtree to avoid walking into
    // a gitdir.
    let script = format!(
        "find {quoted_root} -maxdepth {find_maxdepth} \\( {prune_clause} \\) -prune -o -name .git \\( -type d -o -type f -o -type l \\) -printf '%y\\t%p\\n' -prune 2>/dev/null"
    );
    let output = wsl_exec_capture(&distro, "sh", &["-c", &script])
        .map_err(|e| GitError::command("wsl git discovery", e))?;

    let mut candidates: Vec<CandidateRepo> = Vec::new();
    let mut more_remain = false;
    for line in output.lines() {
        let line = line.trim_end_matches('\r');
        if line.is_empty() {
            continue;
        }
        if candidates.len() as u32 >= limit {
            more_remain = true;
            break;
        }
        let (kind, path) = match line.split_once('\t') {
            Some(parts) => parts,
            None => continue,
        };
        // `.git` shows up as a regular file (worktree / submodule pointer)
        // or as a symlink (some submodule layouts); both mark a non-`dir`
        // gitdir and should be flagged as a worktree in the UI.
        let is_worktree = matches!(kind, "f" | "l");
        let repo_wsl_path = wsl_parent(path);
        if let Some(candidate) = build_wsl_candidate(registry, root, &repo_wsl_path, is_worktree) {
            candidates.push(candidate);
        }
    }
    Ok((candidates, more_remain))
}

#[cfg(not(windows))]
fn collect_wsl(
    _registry: &WorkspaceRegistry,
    _root: &ResolvedGitDirectory,
    _max_depth: u32,
    _limit: u32,
) -> Result<(Vec<CandidateRepo>, bool)> {
    Err(GitError::command(
        "git_discover_repositories",
        "WSL discovery is only available on Windows",
    ))
}

#[cfg(windows)]
fn build_wsl_candidate(
    registry: &WorkspaceRegistry,
    root: &ResolvedGitDirectory,
    wsl_repo_path: &str,
    is_worktree: bool,
) -> Option<CandidateRepo> {
    let authorized = authorized_repo_root(registry, wsl_repo_path, &root.workspace).ok()?;
    let relative_path = relative_wsl_path(&root.git_path, wsl_repo_path);
    let name = wsl_basename(wsl_repo_path);
    Some(CandidateRepo {
        authorized,
        relative_path,
        name,
        is_worktree,
    })
}

#[cfg(windows)]
fn shell_quote_wsl(s: &str) -> String {
    format!("'{}'", s.replace('\'', "'\\''"))
}

#[cfg(windows)]
fn wsl_parent(path: &str) -> String {
    let trimmed = path.trim_end_matches('/');
    if trimmed.is_empty() {
        return "/".to_string();
    }
    match trimmed.rfind('/') {
        Some(0) => "/".to_string(),
        Some(idx) => trimmed[..idx].to_string(),
        None => trimmed.to_string(),
    }
}

#[cfg(windows)]
fn wsl_basename(path: &str) -> String {
    let trimmed = path.trim_end_matches('/');
    if trimmed.is_empty() {
        return "/".to_string();
    }
    match trimmed.rfind('/') {
        Some(idx) => trimmed[idx + 1..].to_string(),
        None => trimmed.to_string(),
    }
}

#[cfg(windows)]
fn relative_wsl_path(root: &str, candidate: &str) -> String {
    let root_trim = root.trim_end_matches('/');
    let candidate_trim = candidate.trim_end_matches('/');
    if root_trim.is_empty() {
        // Root is "/" — everything under it is a literal leading-slash path.
        let stripped = candidate_trim.trim_start_matches('/');
        if stripped.is_empty() {
            ".".to_string()
        } else {
            stripped.to_string()
        }
    } else if candidate_trim == root_trim {
        ".".to_string()
    } else if let Some(stripped) = candidate_trim.strip_prefix(root_trim) {
        let stripped = stripped.trim_start_matches('/');
        if stripped.is_empty() {
            ".".to_string()
        } else {
            stripped.to_string()
        }
    } else {
        ".".to_string()
    }
}

#[cfg(test)]
mod tests {
    use crate::modules::git::operations::test_support::{init_git_repo, make_root};
    use crate::modules::workspace::WorkspaceEnv;
    use std::path::Path;
    use std::process::Command;

    // --- discover_repositories fixtures --------------------------------------

    /// Mirror the canonical-path string the discovery DTO emits for a
    /// `WorkspaceEnv::Local` repo (forward slashes, no UNC prefix).
    fn expected_repo_root(path: &Path) -> String {
        path.to_string_lossy().replace('\\', "/")
    }

    #[test]
    fn discover_repositories_root_only() {
        let root = make_root("root-only");
        init_git_repo(&root.path, "main");
        let path_str = root.path.to_string_lossy().into_owned();

        let result = super::discover_repositories(
            &root.registry,
            &path_str,
            4,
            64,
            &WorkspaceEnv::Local,
        )
        .expect("discovery succeeds");

        assert!(!result.truncated);
        assert_eq!(result.repositories.len(), 1);
        let repo = &result.repositories[0];
        assert_eq!(repo.relative_path, ".");
        assert_eq!(repo.repo_root, expected_repo_root(&root.path));
        assert_eq!(repo.branch, "main");
        assert!(!repo.is_detached);
        assert!(!repo.is_worktree);
    }

    #[test]
    fn discover_repositories_outer_plus_nested() {
        let root = make_root("outer-nested");
        init_git_repo(&root.path, "main");
        let nested = root.path.join("nested");
        std::fs::create_dir_all(&nested).expect("nested dir");
        init_git_repo(&nested, "feature/nested");
        let path_str = root.path.to_string_lossy().into_owned();

        let result = super::discover_repositories(
            &root.registry,
            &path_str,
            4,
            64,
            &WorkspaceEnv::Local,
        )
        .expect("discovery succeeds");

        let mut paths: Vec<_> = result
            .repositories
            .iter()
            .map(|r| {
                (
                    r.relative_path.clone(),
                    r.branch.clone(),
                    r.repo_root.clone(),
                )
            })
            .collect();
        paths.sort();

        assert_eq!(
            paths,
            vec![
                (
                    ".".to_string(),
                    "main".to_string(),
                    expected_repo_root(&root.path),
                ),
                (
                    "nested".to_string(),
                    "feature/nested".to_string(),
                    expected_repo_root(&nested),
                ),
            ]
        );
        assert!(!result.truncated);
    }

    #[test]
    fn discover_repositories_two_sibling_repos() {
        let root = make_root("siblings");
        let repo_a = root.path.join("repo_a");
        let repo_b = root.path.join("repo_b");
        std::fs::create_dir_all(&repo_a).expect("repo_a");
        std::fs::create_dir_all(&repo_b).expect("repo_b");
        init_git_repo(&repo_a, "main");
        init_git_repo(&repo_b, "develop");
        let path_str = root.path.to_string_lossy().into_owned();

        let result = super::discover_repositories(
            &root.registry,
            &path_str,
            4,
            64,
            &WorkspaceEnv::Local,
        )
        .expect("discovery succeeds");

        let mut paths: Vec<_> = result
            .repositories
            .iter()
            .map(|r| {
                (
                    r.relative_path.clone(),
                    r.branch.clone(),
                    r.repo_root.clone(),
                )
            })
            .collect();
        paths.sort();

        assert_eq!(
            paths,
            vec![
                (
                    "repo_a".to_string(),
                    "main".to_string(),
                    expected_repo_root(&repo_a),
                ),
                (
                    "repo_b".to_string(),
                    "develop".to_string(),
                    expected_repo_root(&repo_b),
                ),
            ]
        );
        assert!(!result.truncated);
    }

    #[test]
    fn discover_repositories_detects_dot_git_file_worktree() {
        let root = make_root("dot-git-file");
        init_git_repo(&root.path, "main");
        // Add a real worktree so the `.git` *file* candidate resolves to a
        // valid gitdir that the existing resolve path can read.
        let worktree_path = root.path.join("wt");
        let status = Command::new("git")
            .arg("-C")
            .arg(&root.path)
            .arg("worktree")
            .arg("add")
            .arg("-b")
            .arg("wt-branch")
            .arg(&worktree_path)
            .env("GIT_AUTHOR_NAME", "Nexterm Test")
            .env("GIT_AUTHOR_EMAIL", "test@nexterm.local")
            .env("GIT_COMMITTER_NAME", "Nexterm Test")
            .env("GIT_COMMITTER_EMAIL", "test@nexterm.local")
            .env("LC_ALL", "C")
            .status()
            .expect("git worktree add");
        assert!(status.success(), "git worktree add failed");
        let path_str = root.path.to_string_lossy().into_owned();

        let result = super::discover_repositories(
            &root.registry,
            &path_str,
            4,
            64,
            &WorkspaceEnv::Local,
        )
        .expect("discovery succeeds");

        let worktree = result
            .repositories
            .iter()
            .find(|r| r.relative_path == "wt")
            .expect("worktree candidate missing");
        assert!(
            worktree.is_worktree,
            ".git file candidate should flag worktree"
        );
    }

    #[test]
    fn discover_repositories_no_repositories() {
        let root = make_root("empty");
        let path_str = root.path.to_string_lossy().into_owned();

        let result = super::discover_repositories(
            &root.registry,
            &path_str,
            4,
            64,
            &WorkspaceEnv::Local,
        )
        .expect("discovery succeeds");

        assert!(result.repositories.is_empty());
        assert!(!result.truncated);
    }

    #[test]
    fn discover_repositories_truncates_at_max_repos() {
        let root = make_root("trunc-repos");
        let repo_a = root.path.join("repo_a");
        let repo_b = root.path.join("repo_b");
        let repo_c = root.path.join("repo_c");
        std::fs::create_dir_all(&repo_a).expect("repo_a");
        std::fs::create_dir_all(&repo_b).expect("repo_b");
        std::fs::create_dir_all(&repo_c).expect("repo_c");
        init_git_repo(&repo_a, "main");
        init_git_repo(&repo_b, "main");
        init_git_repo(&repo_c, "main");
        let path_str = root.path.to_string_lossy().into_owned();

        let result = super::discover_repositories(
            &root.registry,
            &path_str,
            4,
            2,
            &WorkspaceEnv::Local,
        )
        .expect("discovery succeeds");

        assert_eq!(result.repositories.len(), 2);
        assert!(result.truncated);
    }

    #[test]
    fn discover_repositories_truncates_at_max_depth() {
        let root = make_root("trunc-depth");
        let deep = root.path.join("a").join("b").join("c").join("repo");
        std::fs::create_dir_all(&deep).expect("deep");
        init_git_repo(&deep, "deep-main");
        let path_str = root.path.to_string_lossy().into_owned();

        // max_depth=2 means we look at root (depth 0) + one child level. The
        // deeply nested repo sits at depth 4 so it should be truncated.
        let result = super::discover_repositories(
            &root.registry,
            &path_str,
            2,
            64,
            &WorkspaceEnv::Local,
        )
        .expect("discovery succeeds");

        assert!(result.repositories.is_empty());
        assert!(result.truncated);
    }

    #[cfg(unix)]
    #[test]
    fn discover_repositories_skips_symlink_outside_authorized_root() {
        let authorized = make_root("sym-authorized");
        let outside = make_root("sym-outside");
        init_git_repo(&outside.path, "outside-main");
        let link_path = authorized.path.join("escape");
        std::os::unix::fs::symlink(&outside.path, &link_path).expect("symlink");
        let path_str = authorized.path.to_string_lossy().into_owned();

        let result = super::discover_repositories(
            &authorized.registry,
            &path_str,
            4,
            64,
            &WorkspaceEnv::Local,
        )
        .expect("discovery succeeds");

        assert!(
            result.repositories.is_empty(),
            "symlinked escape must be ignored"
        );
        assert!(!result.truncated);
    }
}
