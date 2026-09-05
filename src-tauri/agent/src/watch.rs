//! WSL/远端文件监听模式:`nexterm-agent watch --root <path>`。
//!
//! 由 wsl-watcher-helper 并入而来,协议向后兼容(每行
//! `{"paths":[...],"gitRelated":bool}`),并新增逐路径 `kinds`
//! (create/modify/remove)—— 这是旧 helper 做不到的。
//! stdin 不使用;宿主杀掉 wsl.exe 时 stdout 断开,进程随之退场。

use std::collections::BTreeSet;
use std::io::{self, Write};
use std::path::{Path, PathBuf};
use std::sync::mpsc;

use notify::{Event, EventKind, RecursiveMode, Watcher};
use serde::Serialize;

#[derive(Serialize)]
#[serde(rename_all = "camelCase")]
struct WatchEvent {
    paths: Vec<String>,
    git_related: bool,
    kinds: Vec<&'static str>,
}

pub fn run_watch() -> Result<(), String> {
    let root = parse_root_arg()?;
    if !root.is_dir() {
        return Err(format!("watch root is not a directory: {}", root.display()));
    }

    let (tx, rx) = mpsc::channel();
    let mut watcher = notify::recommended_watcher(move |result| {
        let _ = tx.send(result);
    })
    .map_err(|error| error.to_string())?;
    watcher
        .watch(&root, RecursiveMode::Recursive)
        .map_err(|error| error.to_string())?;

    let stdout = io::stdout();
    let mut stdout = stdout.lock();
    for result in rx {
        let event = result.map_err(|error| error.to_string())?;
        if let Some(event) = watch_event_from_notify(&root, event) {
            serde_json::to_writer(&mut stdout, &event).map_err(|error| error.to_string())?;
            stdout.write_all(b"\n").map_err(|error| error.to_string())?;
            stdout.flush().map_err(|error| error.to_string())?;
        }
    }
    Ok(())
}

fn parse_root_arg() -> Result<PathBuf, String> {
    let mut args = std::env::args().skip(1);
    while let Some(arg) = args.next() {
        if arg == "--root" {
            let Some(root) = args.next() else {
                return Err("--root requires a path".into());
            };
            return Ok(PathBuf::from(root));
        }
    }
    Err("usage: nexterm-agent watch --root <path>".into())
}

fn kind_name(kind: &EventKind) -> &'static str {
    match kind {
        EventKind::Create(_) => "create",
        EventKind::Remove(_) => "remove",
        EventKind::Modify(_) | EventKind::Other | EventKind::Access(_) => "modify",
        EventKind::Any => "modify",
    }
}

fn watch_event_from_notify(root: &Path, event: Event) -> Option<WatchEvent> {
    if matches!(event.kind, EventKind::Access(_)) {
        return None;
    }

    let kind = kind_name(&event.kind);
    let mut paths: BTreeSet<String> = BTreeSet::new();
    let mut git_related = false;
    for path in event.paths {
        let normalized = normalize_path(&path);
        if is_git_related_path(root, Path::new(&normalized)) {
            git_related = true;
        }
        paths.insert(normalized);
    }

    let count = paths.len();
    Some(WatchEvent {
        paths: paths.into_iter().collect(),
        git_related,
        kinds: vec![kind; count],
    })
}

fn normalize_path(path: &Path) -> String {
    path.to_string_lossy().replace('\\', "/")
}

fn is_git_related_path(root: &Path, path: &Path) -> bool {
    let relative = path.strip_prefix(root).unwrap_or(path);
    relative
        .components()
        .any(|component| component.as_os_str() == std::ffi::OsStr::new(".git"))
}

#[cfg(test)]
mod tests {
    use super::*;
    use notify::event::ModifyKind;

    #[test]
    fn event_sorts_paths_marks_git_and_kinds() {
        let root = PathBuf::from("/home/dev/repo");
        let event = Event::new(EventKind::Modify(ModifyKind::Any))
            .add_path(root.join("src/main.rs"))
            .add_path(root.join(".git/index"));

        let event = watch_event_from_notify(&root, event).expect("event");

        assert_eq!(
            event.paths,
            vec![
                "/home/dev/repo/.git/index".to_string(),
                "/home/dev/repo/src/main.rs".to_string(),
            ]
        );
        assert!(event.git_related);
        assert_eq!(event.kinds, vec!["modify", "modify"]);
    }

    #[test]
    fn access_events_are_filtered() {
        let root = PathBuf::from("/home/dev/repo");
        let event = Event::new(EventKind::Access(notify::event::AccessKind::Close(
            notify::event::AccessMode::Write,
        )))
        .add_path(root.join("x"));
        assert!(watch_event_from_notify(&root, event).is_none());
    }
}
