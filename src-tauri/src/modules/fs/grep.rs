use std::sync::atomic::{AtomicBool, AtomicUsize, Ordering};
use std::sync::{Arc, Mutex};

use globset::{Glob, GlobSet, GlobSetBuilder};
use grep_regex::RegexMatcherBuilder;
use grep_searcher::sinks::UTF8;
use grep_searcher::{BinaryDetection, SearcherBuilder};
use ignore::{WalkBuilder, WalkState};
use serde::Serialize;

use super::to_canon;
use crate::modules::fs::wsl_ops;
use crate::modules::lock::mutex_lock;
use crate::modules::workspace::{resolve_path, WorkspaceEnv};

const FILE_SIZE_CAP: u64 = 5 * 1024 * 1024;
const DEFAULT_MAX_RESULTS: usize = 200;
const HARD_MAX_RESULTS: usize = 2000;

#[derive(Clone, Serialize)]
pub struct GrepHit {
    pub path: String,
    pub rel: String,
    pub line: u64,
    pub text: String,
}

#[derive(Serialize)]
pub struct GrepResponse {
    pub hits: Vec<GrepHit>,
    pub truncated: bool,
    pub files_scanned: usize,
}

fn build_globset(patterns: &[String]) -> Result<Option<GlobSet>, String> {
    if patterns.is_empty() {
        return Ok(None);
    }
    let mut b = GlobSetBuilder::new();
    for p in patterns {
        let g = Glob::new(p).map_err(|e| format!("bad glob {p:?}: {e}"))?;
        b.add(g);
    }
    let set = b.build().map_err(|e| format!("globset build: {e}"))?;
    Ok(Some(set))
}

/// SSH 分支含网络 I/O(超时可达数十秒):整体下沉阻塞线程池,避免冻结
/// UI;本地/WSL 的同步逻辑原样保留在闭包内。
#[tauri::command]
pub async fn fs_grep(
    pattern: String,
    root: String,
    glob: Option<Vec<String>>,
    case_insensitive: Option<bool>,
    max_results: Option<usize>,
    workspace: Option<WorkspaceEnv>,
) -> Result<GrepResponse, String> {
    tauri::async_runtime::spawn_blocking(move || {
        fs_grep_blocking(pattern, root, glob, case_insensitive, max_results, workspace)
    })
    .await
    .map_err(|error| format!("fs_grep background task failed: {error}"))?
}

fn fs_grep_blocking(
    pattern: String,
    root: String,
    glob: Option<Vec<String>>,
    case_insensitive: Option<bool>,
    max_results: Option<usize>,
    workspace: Option<WorkspaceEnv>,
) -> Result<GrepResponse, String> {
    if pattern.is_empty() {
        return Err("empty pattern".into());
    }
    let workspace = WorkspaceEnv::from_option(workspace);
    let root_path = resolve_path(&root, &workspace);
    if !root_path.is_dir() {
        return Err(format!("not a directory: {root}"));
    }
    let cap = max_results
        .unwrap_or(DEFAULT_MAX_RESULTS)
        .clamp(1, HARD_MAX_RESULTS);

    // Phase 0b/2:WSL 非 drvfs 与 SSH 根经 agent 内容查找;失败回退宿主 UNC。
    let workspace_for_route = workspace.clone();
    if let WorkspaceEnv::Wsl { distro } = &workspace {
        if wsl_ops::should_use_wsl_ops(&root, &workspace) {
            if let Ok(parsed) = crate::modules::agent::grep(
                distro,
                &pattern,
                &root,
                glob.as_deref(),
                case_insensitive.unwrap_or(false),
                Some(cap),
                &root,
            ) {
                let hits = parsed
                    .hits
                    .into_iter()
                    .map(|hit| GrepHit {
                        path: hit.path,
                        rel: hit.rel,
                        line: hit.line,
                        text: hit.text,
                    })
                    .collect();
                return Ok(GrepResponse {
                    hits,
                    truncated: parsed.truncated,
                    files_scanned: parsed.files_scanned,
                });
            }
        }
    }
    if let WorkspaceEnv::Ssh { profile_id } = &workspace_for_route {
        let parsed = tauri::async_runtime::block_on(crate::modules::ssh::remote::remote_grep(
            profile_id,
            &pattern,
            &root,
            glob.clone(),
            case_insensitive.unwrap_or(false),
            Some(cap),
            &root,
        ))?;
        let hits = parsed
            .hits
            .into_iter()
            .map(|hit| GrepHit {
                path: hit.path,
                rel: hit.rel,
                line: hit.line,
                text: hit.text,
            })
            .collect();
        return Ok(GrepResponse {
            hits,
            truncated: parsed.truncated,
            files_scanned: parsed.files_scanned,
        });
    }

    let matcher = RegexMatcherBuilder::new()
        .case_insensitive(case_insensitive.unwrap_or(false))
        .line_terminator(Some(b'\n'))
        .build(&pattern)
        .map_err(|e| format!("bad regex: {e}"))?;

    let globs = build_globset(glob.as_deref().unwrap_or(&[]))?;

    let walker = WalkBuilder::new(&root_path)
        .hidden(true)
        .git_ignore(true)
        .git_global(true)
        .git_exclude(true)
        .ignore(true)
        .parents(true)
        .follow_links(false)
        .build_parallel();

    let hits: Arc<Mutex<Vec<GrepHit>>> = Arc::new(Mutex::new(Vec::new()));
    let scanned = Arc::new(AtomicUsize::new(0));
    let truncated = Arc::new(AtomicBool::new(false));

    walker.run(|| {
        let matcher = matcher.clone();
        let globs = globs.clone();
        let hits = hits.clone();
        let scanned = scanned.clone();
        let truncated = truncated.clone();
        let root_path = root_path.clone();
        let root_display = root.clone();
        let workspace = workspace.clone();

        Box::new(move |dent_res| {
            if truncated.load(Ordering::Relaxed) {
                return WalkState::Quit;
            }
            let dent = match dent_res {
                Ok(d) => d,
                Err(_) => return WalkState::Continue,
            };
            if !dent.file_type().map(|t| t.is_file()).unwrap_or(false) {
                return WalkState::Continue;
            }
            let path = dent.path();
            let rel = match path.strip_prefix(&root_path) {
                Ok(r) => to_canon(r),
                Err(_) => return WalkState::Continue,
            };
            if let Some(set) = globs.as_ref() {
                if !set.is_match(&rel) {
                    return WalkState::Continue;
                }
            }
            if let Ok(meta) = std::fs::metadata(path) {
                if meta.len() > FILE_SIZE_CAP {
                    return WalkState::Continue;
                }
            }

            scanned.fetch_add(1, Ordering::Relaxed);

            let abs = display_path(path, &root_path, &root_display, &workspace);
            let rel_clone = rel.clone();
            let mut searcher = SearcherBuilder::new()
                .binary_detection(BinaryDetection::quit(b'\x00'))
                .line_number(true)
                .build();

            let _ = searcher.search_path(
                &matcher,
                path,
                UTF8(|line_num, text| {
                    let line_text = text.trim_end_matches('\n').to_string();
                    let mut guard = match mutex_lock(&hits, "fs_grep hits") {
                        Ok(guard) => guard,
                        Err(error) => {
                            // Lock poisoned by another worker — the searcher
                            // can't usefully continue, so signal stop and let
                            // the outer join handle the partial state.
                            log::warn!("fs_grep stopping early: {error}");
                            return Ok(false);
                        }
                    };
                    if guard.len() >= cap {
                        truncated.store(true, Ordering::Relaxed);
                        return Ok(false);
                    }
                    guard.push(GrepHit {
                        path: abs.clone(),
                        rel: rel_clone.clone(),
                        line: line_num,
                        text: line_text,
                    });
                    Ok(true)
                }),
            );

            WalkState::Continue
        })
    });

    let final_hits = match Arc::try_unwrap(hits) {
        Ok(mutex) => match mutex.into_inner() {
            // Happy path: parallel walker finished without poisoning the lock.
            Ok(hits) => hits,
            // A worker panicked while holding the lock. The walker has finished
            // so there is no further contention; recover whatever was pushed
            // before the panic rather than aborting the IPC handler.
            Err(poisoned) => {
                log::warn!("fs_grep lock poisoned; recovering partial results");
                poisoned.into_inner()
            }
        },
        // Other worker threads still hold an Arc clone (shouldn't happen
        // because the walker has joined, but be defensive).
        Err(arc) => match mutex_lock(&arc, "fs_grep hits") {
            Ok(guard) => (*guard).clone(),
            Err(error) => {
                log::warn!("fs_grep could not collect hits: {error}");
                Vec::new()
            }
        },
    };

    Ok(GrepResponse {
        hits: final_hits,
        truncated: truncated.load(Ordering::Relaxed),
        files_scanned: scanned.load(Ordering::Relaxed),
    })
}

#[derive(Serialize)]
pub struct GlobHit {
    pub path: String,
    pub rel: String,
}

#[derive(Serialize)]
pub struct GlobResponse {
    pub hits: Vec<GlobHit>,
    pub truncated: bool,
}

#[tauri::command]
pub async fn fs_glob(
    pattern: String,
    root: String,
    max_results: Option<usize>,
    workspace: Option<WorkspaceEnv>,
) -> Result<GlobResponse, String> {
    tauri::async_runtime::spawn_blocking(move || {
        fs_glob_blocking(pattern, root, max_results, workspace)
    })
    .await
    .map_err(|error| format!("fs_glob background task failed: {error}"))?
}

fn fs_glob_blocking(
    pattern: String,
    root: String,
    max_results: Option<usize>,
    workspace: Option<WorkspaceEnv>,
) -> Result<GlobResponse, String> {
    if pattern.is_empty() {
        return Err("empty pattern".into());
    }
    let workspace = WorkspaceEnv::from_option(workspace);
    let root_path = resolve_path(&root, &workspace);
    if !root_path.is_dir() {
        return Err(format!("not a directory: {root}"));
    }
    let cap = max_results.unwrap_or(500).clamp(1, HARD_MAX_RESULTS);

    // Phase 0b/2:agent 路由优先,语义同 fs_grep。
    if let WorkspaceEnv::Wsl { distro } = &workspace {
        if wsl_ops::should_use_wsl_ops(&root, &workspace) {
            if let Ok((hits, truncated)) = crate::modules::agent::glob(
                distro,
                &pattern,
                &root,
                Some(cap),
                &root,
            ) {
                let hits = hits
                    .into_iter()
                    .map(|hit| GlobHit {
                        path: hit.path,
                        rel: hit.rel,
                    })
                    .collect();
                return Ok(GlobResponse { hits, truncated });
            }
        }
    }
    if let WorkspaceEnv::Ssh { profile_id } = &workspace {
        let (hits, truncated) = tauri::async_runtime::block_on(crate::modules::ssh::remote::remote_glob(
            profile_id,
            &pattern,
            &root,
            Some(cap),
            &root,
        ))?;
        let hits = hits
            .into_iter()
            .map(|hit| GlobHit {
                path: hit.path,
                rel: hit.rel,
            })
            .collect();
        return Ok(GlobResponse { hits, truncated });
    }

    let glob = Glob::new(&pattern).map_err(|e| format!("bad glob: {e}"))?;
    let mut gb = GlobSetBuilder::new();
    gb.add(glob);
    let set = gb.build().map_err(|e| format!("globset build: {e}"))?;

    let walker = WalkBuilder::new(&root_path)
        .hidden(true)
        .git_ignore(true)
        .git_global(true)
        .git_exclude(true)
        .ignore(true)
        .parents(true)
        .follow_links(false)
        .build();

    let mut hits: Vec<GlobHit> = Vec::new();
    let mut truncated = false;
    for dent in walker.flatten() {
        if hits.len() >= cap {
            truncated = true;
            break;
        }
        if !dent.file_type().map(|t| t.is_file()).unwrap_or(false) {
            continue;
        }
        let path = dent.path();
        let rel = match path.strip_prefix(&root_path) {
            Ok(r) => to_canon(r),
            Err(_) => continue,
        };
        if !set.is_match(&rel) {
            continue;
        }
        hits.push(GlobHit {
            path: display_path(path, &root_path, &root, &workspace),
            rel,
        });
    }

    Ok(GlobResponse { hits, truncated })
}

fn display_path(
    path: &std::path::Path,
    root_path: &std::path::Path,
    root_display: &str,
    workspace: &WorkspaceEnv,
) -> String {
    if workspace.is_wsl() {
        if let Ok(rel) = path.strip_prefix(root_path) {
            let rel = to_canon(rel);
            return if rel.is_empty() {
                root_display.to_string()
            } else if root_display.ends_with('/') {
                format!("{root_display}{rel}")
            } else {
                format!("{root_display}/{rel}")
            };
        }
    }
    to_canon(path)
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn build_globset_matches_only_configured_patterns() {
        let set = build_globset(&["*.rs".to_string(), "**/tests/**".to_string()])
            .unwrap()
            .expect("non-empty patterns should build a set");
        assert!(set.is_match("src/main.rs"));
        assert!(set.is_match("crates/x/tests/it.rs"));
        assert!(!set.is_match("src/main.ts"));
    }

    #[test]
    fn build_globset_empty_patterns_builds_no_set() {
        assert!(build_globset(&[]).unwrap().is_none());
    }

    #[test]
    fn build_globset_rejects_bad_glob_pattern() {
        assert!(build_globset(&["[".to_string()]).is_err());
    }

    #[test]
    fn display_path_uses_root_display_for_wsl_and_canon_for_local() {
        let root = std::path::Path::new("/home/dev/repo");
        let file = root.join("src/main.rs");
        let wsl = WorkspaceEnv::Wsl {
            distro: "Ubuntu".to_string(),
        };
        assert_eq!(
            display_path(&file, root, "//wsl$/Ubuntu/home/dev/repo", &wsl),
            "//wsl$/Ubuntu/home/dev/repo/src/main.rs"
        );
        assert_eq!(
            display_path(&file, root, "/home/dev/repo", &WorkspaceEnv::Local),
            "/home/dev/repo/src/main.rs"
        );
    }
}
