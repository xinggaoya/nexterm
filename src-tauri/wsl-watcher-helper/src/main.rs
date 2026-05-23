use std::collections::BTreeSet;
use std::io::{self, Write};
use std::path::{Path, PathBuf};
use std::sync::mpsc;

use notify::{Event, EventKind, RecursiveMode, Watcher};
use serde::Serialize;

#[derive(Serialize)]
#[serde(rename_all = "camelCase")]
struct HelperEvent {
    paths: Vec<String>,
    git_related: bool,
}

fn main() {
    if let Err(error) = run() {
        eprintln!("{error}");
        std::process::exit(1);
    }
}

fn run() -> Result<(), String> {
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
        if let Some(event) = helper_event_from_notify(&root, event) {
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
    Err("usage: nexterm-wsl-watcher --root <path>".into())
}

fn helper_event_from_notify(root: &Path, event: Event) -> Option<HelperEvent> {
    if matches!(event.kind, EventKind::Access(_)) {
        return None;
    }

    let mut paths = BTreeSet::new();
    let mut git_related = false;
    for path in event.paths {
        let path = normalize_path(&path);
        if is_git_related_path(root, Path::new(&path)) {
            git_related = true;
        }
        paths.insert(path);
    }

    Some(HelperEvent {
        paths: paths.into_iter().collect(),
        git_related,
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
    fn helper_event_sorts_paths_and_marks_git_changes() {
        let root = PathBuf::from("/home/dev/repo");
        let event = Event::new(EventKind::Modify(ModifyKind::Any))
            .add_path(root.join("src/main.rs"))
            .add_path(root.join(".git/index"));

        let event = helper_event_from_notify(&root, event).expect("helper event");

        assert_eq!(
            event.paths,
            vec![
                "/home/dev/repo/.git/index".to_string(),
                "/home/dev/repo/src/main.rs".to_string(),
            ]
        );
        assert!(event.git_related);
    }
}
