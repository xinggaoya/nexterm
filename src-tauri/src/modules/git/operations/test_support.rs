//! Shared `#[cfg(test)]` fixtures for the `operations` submodules
//! (discovery / stash / checkout / log / remote tests all build real temp
//! git repos behind the workspace authorization boundary).

use std::path::{Path, PathBuf};
use std::process::Command;
use std::sync::atomic::{AtomicU64, Ordering};

use crate::modules::workspace::WorkspaceRegistry;

// --- discover_repositories fixtures --------------------------------------

pub(crate) static DISCOVERY_COUNTER: AtomicU64 = AtomicU64::new(0);

/// Build an isolated temp dir under `std::env::temp_dir()` and authorize
/// it as a workspace root so the existing authorization boundary accepts
/// it without touching any global state.
pub(crate) struct AuthorizedRoot {
    pub(crate) path: PathBuf,
    pub(crate) registry: WorkspaceRegistry,
}

pub(crate) fn make_root(label: &str) -> AuthorizedRoot {
    let nanos = std::time::SystemTime::now()
        .duration_since(std::time::UNIX_EPOCH)
        .map(|d| d.as_nanos())
        .unwrap_or(0);
    let counter = DISCOVERY_COUNTER.fetch_add(1, Ordering::Relaxed);
    let mut p = std::env::temp_dir();
    p.push(format!(
        "nexterm-git-discovery-{label}-{nanos}-{}-{counter}",
        std::process::id()
    ));
    std::fs::create_dir_all(&p).expect("create tempdir");
    // 用与生产路径相同的规范化（canonicalize_cached 会剥掉 Windows 的
    // `\\?\` 前缀）；裸 std::fs::canonicalize 在 Windows 上返回 UNC 前缀
    // 路径，与 discover 输出的规范化 repo_root 永远对不上。
    let canonical = crate::modules::workspace::WorkspaceRegistry::default()
        .canonicalize_cached(&p)
        .expect("canonicalize tempdir");
    let registry = WorkspaceRegistry::default();
    registry.authorize(&canonical).expect("authorize root");
    AuthorizedRoot {
        path: canonical,
        registry,
    }
}

pub(crate) fn init_git_repo(dir: &Path, branch: &str) {
    let status = Command::new("git")
        .arg("init")
        .arg("--initial-branch")
        .arg(branch)
        .arg(dir)
        .env("GIT_AUTHOR_NAME", "Nexterm Test")
        .env("GIT_AUTHOR_EMAIL", "test@nexterm.local")
        .env("GIT_COMMITTER_NAME", "Nexterm Test")
        .env("GIT_COMMITTER_EMAIL", "test@nexterm.local")
        .env("LC_ALL", "C")
        .status()
        .expect("git init");
    assert!(status.success(), "git init failed for {}", dir.display());
    // Create an empty initial commit so the existing resolve path can read
    // HEAD; an empty repo makes `git rev-parse --abbrev-ref HEAD` fail
    // before any commits exist.
    let status = Command::new("git")
        .arg("-C")
        .arg(dir)
        .arg("commit")
        .arg("--allow-empty")
        .arg("-m")
        .arg("init")
        .env("GIT_AUTHOR_NAME", "Nexterm Test")
        .env("GIT_AUTHOR_EMAIL", "test@nexterm.local")
        .env("GIT_COMMITTER_NAME", "Nexterm Test")
        .env("GIT_COMMITTER_EMAIL", "test@nexterm.local")
        .env("LC_ALL", "C")
        .status()
        .expect("git commit");
    assert!(status.success(), "git commit failed for {}", dir.display());
}

// --- stash / checkout end-to-end fixtures --------------------------------
//
// The operations above run a real `git` binary against a temp repo so we
// exercise the same code paths the IPC layer will hit. They live next
// to the discover tests because they share the same authorization +
// git-binary requirements.

pub(crate) fn write_file(dir: &Path, name: &str, content: &str) {
    let path = dir.join(name);
    std::fs::write(&path, content).expect("write file");
}

pub(crate) fn run_git(dir: &Path, args: &[&str]) {
    let status = Command::new("git")
        .arg("-C")
        .arg(dir)
        .args(args)
        .env("LC_ALL", "C")
        .env("GIT_AUTHOR_NAME", "Nexterm Test")
        .env("GIT_AUTHOR_EMAIL", "test@nexterm.local")
        .env("GIT_COMMITTER_NAME", "Nexterm Test")
        .env("GIT_COMMITTER_EMAIL", "test@nexterm.local")
        .status()
        .expect("git command");
    assert!(status.success(), "git {args:?} failed");
}
