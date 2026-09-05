//! fs 搜索/列表/内容查找/glob —— 逐语义移植自主程序 `fs/search.rs` 与
//! `fs/grep.rs`(常量、剪枝、排序、截断规则保持一致),在 WSL/远端本地
//! 执行以获得原生性能与原生路径语义。

use std::path::{Path, PathBuf};
use std::sync::atomic::{AtomicBool, AtomicUsize, Ordering};
use std::sync::{Arc, Mutex};

use globset::{Glob, GlobSet, GlobSetBuilder};
use grep_regex::RegexMatcherBuilder;
use grep_searcher::sinks::UTF8;
use grep_searcher::{BinaryDetection, SearcherBuilder};
use ignore::WalkBuilder;

use crate::protocol::{
    GlobHit, GlobParams, GlobResponse, GrepHit, GrepParams, GrepResponse, ListFilesParams,
    ListFilesResult, SearchHit, SearchParams, SearchResult,
};

const MAX_SCANNED: usize = 50_000;
const PRUNE_DIRS: &[&str] = &[
    "node_modules",
    ".git",
    "target",
    "dist",
    "build",
    ".next",
    ".turbo",
    ".cache",
    ".venv",
    "__pycache__",
];
const FILE_SIZE_CAP: u64 = 5 * 1024 * 1024;
const DEFAULT_MAX_RESULTS: usize = 200;
const HARD_MAX_RESULTS: usize = 2000;

fn to_canon(path: &Path) -> String {
    // 与宿主 fs::to_canon 一致:统一正斜杠(Windows 宿主测试同理)。
    path.to_string_lossy().replace('\\', "/")
}

/// 与宿主 display_path 的 WSL 分支一致:Linux 绝对根 + 相对段。
fn display_path(rel: &str, root_display: &str) -> String {
    if rel.is_empty() {
        root_display.to_string()
    } else if root_display.ends_with('/') {
        format!("{root_display}{rel}")
    } else {
        format!("{root_display}/{rel}")
    }
}

fn prune_filter(dent: &ignore::DirEntry) -> bool {
    if dent.depth() == 0 {
        return true;
    }
    match dent.file_name().to_str() {
        Some(name) => !PRUNE_DIRS.contains(&name),
        None => true,
    }
}

pub fn fs_search(params: SearchParams) -> Result<SearchResult, String> {
    let q = params.query.trim().to_lowercase();
    if q.is_empty() {
        return Ok(SearchResult {
            hits: Vec::new(),
            truncated: false,
        });
    }
    let cap = params.limit.unwrap_or(200).min(1000);
    let show_hidden = params.show_hidden.unwrap_or(false);
    let root_path = PathBuf::from(&params.root);
    if !root_path.is_dir() {
        return Err(format!("not a directory: {}", params.root));
    }
    let root_display = params.root_display.unwrap_or_else(|| params.root.clone());

    let mut out: Vec<SearchHit> = Vec::with_capacity(cap.min(64));
    let mut scanned: usize = 0;
    let mut truncated = false;

    let walker = WalkBuilder::new(&root_path)
        .hidden(!show_hidden)
        .git_ignore(true)
        .git_global(true)
        .git_exclude(true)
        .ignore(true)
        .parents(true)
        .follow_links(false)
        .filter_entry(prune_filter)
        .build();

    for dent in walker.flatten() {
        scanned += 1;
        if scanned > MAX_SCANNED {
            truncated = true;
            break;
        }
        if out.len() >= cap {
            truncated = true;
            break;
        }
        let path = dent.path();
        if path == root_path {
            continue;
        }
        let rel = match path.strip_prefix(&root_path) {
            Ok(rel) => to_canon(rel),
            Err(_) => continue,
        };
        if !rel.to_lowercase().contains(&q) {
            continue;
        }
        let name = path
            .file_name()
            .map(|s| s.to_string_lossy().into_owned())
            .unwrap_or_default();
        let is_dir = dent.file_type().map(|t| t.is_dir()).unwrap_or(false);
        out.push(SearchHit {
            path: display_path(&rel, &root_display),
            rel,
            name,
            is_dir,
        });
    }

    out.sort_by(|a, b| {
        let an = a.name.to_lowercase().contains(&q);
        let bn = b.name.to_lowercase().contains(&q);
        bn.cmp(&an).then(a.rel.len().cmp(&b.rel.len()))
    });

    Ok(SearchResult {
        hits: out,
        truncated,
    })
}

pub fn fs_list_files(params: ListFilesParams) -> Result<ListFilesResult, String> {
    const DEFAULT_LIMIT: usize = 2_000;
    const HARD_LIMIT: usize = 10_000;
    const DEFAULT_DEPTH: usize = 8;
    const HARD_DEPTH: usize = 16;

    let cap = params.limit.unwrap_or(DEFAULT_LIMIT).clamp(1, HARD_LIMIT);
    let depth = params.max_depth.unwrap_or(DEFAULT_DEPTH).clamp(1, HARD_DEPTH);
    let show_hidden = params.show_hidden.unwrap_or(false);
    let root_path = PathBuf::from(&params.root);
    if !root_path.is_dir() {
        return Err(format!("not a directory: {}", params.root));
    }

    let walker = WalkBuilder::new(&root_path)
        .hidden(!show_hidden)
        .git_ignore(true)
        .git_global(true)
        .git_exclude(true)
        .ignore(true)
        .parents(true)
        .follow_links(false)
        .max_depth(Some(depth))
        .filter_entry(prune_filter)
        .build();

    let mut files: Vec<String> = Vec::with_capacity(cap.min(256));
    let mut scanned: usize = 0;
    let mut truncated = false;

    for dent in walker.flatten() {
        scanned += 1;
        if scanned > MAX_SCANNED {
            truncated = true;
            break;
        }
        let is_file = dent.file_type().map(|t| t.is_file()).unwrap_or(false);
        if !is_file {
            continue;
        }
        let rel = match dent.path().strip_prefix(&root_path) {
            Ok(rel) => to_canon(rel),
            Err(_) => continue,
        };
        if rel.is_empty() {
            continue;
        }
        files.push(rel);
        if files.len() >= cap {
            truncated = true;
            break;
        }
    }

    files.sort_by_key(|a| a.to_lowercase());
    Ok(ListFilesResult { files, truncated })
}

fn build_globset(patterns: &[String]) -> Result<Option<GlobSet>, String> {
    if patterns.is_empty() {
        return Ok(None);
    }
    let mut builder = GlobSetBuilder::new();
    for p in patterns {
        let g = Glob::new(p).map_err(|e| format!("bad glob {p:?}: {e}"))?;
        builder.add(g);
    }
    let set = builder.build().map_err(|e| format!("globset build: {e}"))?;
    Ok(Some(set))
}

pub fn fs_grep(params: GrepParams) -> Result<GrepResponse, String> {
    if params.pattern.is_empty() {
        return Err("empty pattern".into());
    }
    let root_path = PathBuf::from(&params.root);
    if !root_path.is_dir() {
        return Err(format!("not a directory: {}", params.root));
    }
    let cap = params
        .max_results
        .unwrap_or(DEFAULT_MAX_RESULTS)
        .clamp(1, HARD_MAX_RESULTS);
    let root_display = params.root_display.unwrap_or_else(|| params.root.clone());

    let matcher = RegexMatcherBuilder::new()
        .case_insensitive(params.case_insensitive.unwrap_or(false))
        .line_terminator(Some(b'\n'))
        .build(&params.pattern)
        .map_err(|e| format!("bad regex: {e}"))?;
    let globs = build_globset(params.glob.as_deref().unwrap_or(&[]))?;

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
        let scanned = Arc::clone(&scanned);
        let truncated = Arc::clone(&truncated);
        let root_path = root_path.clone();
        let root_display = root_display.clone();

        Box::new(move |dent_res| {
            if truncated.load(Ordering::Relaxed) {
                return ignore::WalkState::Quit;
            }
            let dent = match dent_res {
                Ok(d) => d,
                Err(_) => return ignore::WalkState::Continue,
            };
            if !dent.file_type().map(|t| t.is_file()).unwrap_or(false) {
                return ignore::WalkState::Continue;
            }
            let path = dent.path();
            let rel = match path.strip_prefix(&root_path) {
                Ok(rel) => to_canon(rel),
                Err(_) => return ignore::WalkState::Continue,
            };
            if let Some(set) = globs.as_ref() {
                if !set.is_match(&rel) {
                    return ignore::WalkState::Continue;
                }
            }
            if let Ok(meta) = std::fs::metadata(path) {
                if meta.len() > FILE_SIZE_CAP {
                    return ignore::WalkState::Continue;
                }
            }
            scanned.fetch_add(1, Ordering::Relaxed);

            let abs = display_path(&rel, &root_display);
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
                    let mut guard = hits.lock().map_err(|error| {
                        std::io::Error::other(error.to_string())
                    })?;
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

            ignore::WalkState::Continue
        })
    });

    let final_hits = match Arc::try_unwrap(hits) {
        Ok(mutex) => match mutex.into_inner() {
            Ok(hits) => hits,
            Err(poisoned) => poisoned.into_inner(),
        },
        Err(arc) => match arc.lock() {
            Ok(guard) => (*guard).clone(),
            Err(_) => Vec::new(),
        },
    };

    Ok(GrepResponse {
        hits: final_hits,
        truncated: truncated.load(Ordering::Relaxed),
        files_scanned: scanned.load(Ordering::Relaxed),
    })
}

pub fn fs_glob(params: GlobParams) -> Result<GlobResponse, String> {
    if params.pattern.is_empty() {
        return Err("empty pattern".into());
    }
    let root_path = PathBuf::from(&params.root);
    if !root_path.is_dir() {
        return Err(format!("not a directory: {}", params.root));
    }
    let cap = params.max_results.unwrap_or(500).clamp(1, HARD_MAX_RESULTS);
    let root_display = params.root_display.unwrap_or_else(|| params.root.clone());

    let glob = Glob::new(&params.pattern).map_err(|e| format!("bad glob: {e}"))?;
    let mut builder = GlobSetBuilder::new();
    builder.add(glob);
    let set = builder.build().map_err(|e| format!("globset build: {e}"))?;

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
        let rel = match dent.path().strip_prefix(&root_path) {
            Ok(rel) => to_canon(rel),
            Err(_) => continue,
        };
        if !set.is_match(&rel) {
            continue;
        }
        hits.push(GlobHit {
            path: display_path(&rel, &root_display),
            rel,
        });
    }

    Ok(GlobResponse { hits, truncated })
}

#[cfg(test)]
mod tests {
    use super::*;
    
    fn tempdir(label: &str) -> PathBuf {
        let mut path = std::env::temp_dir();
        path.push(format!(
            "nexterm-agent-search-{label}-{}-{}",
            std::process::id(),
            std::time::SystemTime::now()
                .duration_since(std::time::UNIX_EPOCH)
                .unwrap_or_default()
                .as_nanos()
        ));
        std::fs::create_dir_all(&path).expect("mkdir");
        path
    }

    #[test]
    fn search_finds_names_and_builds_display_paths() {
        let root = tempdir("search");
        std::fs::create_dir_all(root.join("src/deep")).expect("mkdir");
        std::fs::write(root.join("src/deep/alpha.rs"), b"fn main() {}").expect("write");
        std::fs::write(root.join("README.md"), b"# readme").expect("write");

        let result = fs_search(SearchParams {
            root: root.to_string_lossy().into_owned(),
            query: "alpha".into(),
            limit: None,
            show_hidden: Some(true),
            root_display: Some("/home/dev/repo".into()),
        })
        .expect("search ok");
        assert_eq!(result.hits.len(), 1);
        assert_eq!(result.hits[0].name, "alpha.rs");
        assert_eq!(result.hits[0].path, "/home/dev/repo/src/deep/alpha.rs");
        assert!(!result.hits[0].is_dir);
        assert!(!result.truncated);

        std::fs::remove_dir_all(&root).ok();
    }

    #[test]
    fn search_respects_limit_and_truncation() {
        let root = tempdir("limit");
        for i in 0..5 {
            std::fs::write(root.join(format!("f{i}.txt")), b"x").expect("write");
        }
        let result = fs_search(SearchParams {
            root: root.to_string_lossy().into_owned(),
            query: "f".into(),
            limit: Some(2),
            show_hidden: Some(true),
            root_display: None,
        })
        .expect("search ok");
        assert_eq!(result.hits.len(), 2);
        assert!(result.truncated);
        std::fs::remove_dir_all(&root).ok();
    }

    #[test]
    fn grep_matches_lines_with_numbers() {
        let root = tempdir("grep");
        std::fs::write(root.join("code.rs"), b"let a = 1;\nlet bee = 2;\n").expect("write");

        let result = fs_grep(GrepParams {
            pattern: "bee".into(),
            root: root.to_string_lossy().into_owned(),
            glob: Some(vec!["*.rs".into()]),
            case_insensitive: Some(false),
            max_results: None,
            root_display: Some("/repo".into()),
        })
        .expect("grep ok");
        assert_eq!(result.hits.len(), 1);
        assert_eq!(result.hits[0].line, 2);
        assert_eq!(result.hits[0].text, "let bee = 2;");
        assert_eq!(result.hits[0].path, "/repo/code.rs");
        assert_eq!(result.files_scanned, 1);

        std::fs::remove_dir_all(&root).ok();
    }

    #[test]
    fn glob_matches_relative_paths() {
        let root = tempdir("glob");
        std::fs::create_dir_all(root.join("src")).expect("mkdir");
        std::fs::write(root.join("src/a.ts"), b"").expect("write");
        std::fs::write(root.join("b.txt"), b"").expect("write");

        let result = fs_glob(GlobParams {
            pattern: "**/*.ts".into(),
            root: root.to_string_lossy().into_owned(),
            max_results: None,
            root_display: None,
        })
        .expect("glob ok");
        assert_eq!(result.hits.len(), 1);
        assert_eq!(result.hits[0].rel, "src/a.ts");

        std::fs::remove_dir_all(&root).ok();
    }

    #[test]
    fn empty_query_returns_empty_without_touching_fs() {
        let result = fs_search(SearchParams {
            root: "/definitely/not/here".into(),
            query: "   ".into(),
            limit: None,
            show_hidden: None,
            root_display: None,
        })
        .expect("ok");
        assert!(result.hits.is_empty());
        assert!(!result.truncated);
    }
}
