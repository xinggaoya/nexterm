pub mod modules;
mod panic_report;

use modules::{fs, git, lsp, pty, shell, workspace};
use std::sync::Mutex;
use tauri::{AppHandle, Emitter, Manager, Runtime, State};
use tauri_plugin_deep_link::DeepLinkExt;
use tauri_plugin_window_state::StateFlags;

/// Drained on first read so HMR / re-mounts can't replay the launch dir.
#[derive(Default)]
struct LaunchDir(Mutex<Option<String>>);

#[tauri::command]
fn get_launch_dir(state: State<'_, LaunchDir>) -> Option<String> {
    match modules::lock::mutex_lock(&state.0, "launch dir") {
        Ok(mut launch_dir) => launch_dir.take(),
        Err(error) => {
            log::error!("{error}");
            None
        }
    }
}

fn parse_launch_dir() -> Option<String> {
    for arg in std::env::args().skip(1) {
        if arg.starts_with('-') {
            continue;
        }
        let Ok(canon) = std::fs::canonicalize(&arg) else {
            continue;
        };
        if !canon.is_dir() {
            continue;
        }
        let s = canon.to_string_lossy();
        return Some(s.strip_prefix(r"\\?\").unwrap_or(&s).to_string());
    }
    None
}

/// Tauri event name the frontend listens to for deep-link requests. Payload
/// mirrors the URL `nexterm://open?workspacePath=...&workspaceEnv=...&wslDistro=...`
/// query parameters parsed by `src/lib/launchDir.ts`.
pub const DEEP_LINK_OPEN_EVENT: &str = "nexterm://deep-link-open";

/// Subset of a deep-link URL the frontend cares about. Serialized into the
/// `nexterm://deep-link-open` event so the launching workspace can be opened
/// without further parsing in the webview.
#[derive(serde::Serialize, Clone, Debug)]
#[serde(rename_all = "camelCase")]
pub struct DeepLinkOpenRequest {
    pub path: String,
    pub env: String,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub wsl_distro: Option<String>,
}

fn parse_deep_link_query(url: &url::Url) -> Option<DeepLinkOpenRequest> {
    if url.scheme() != "nexterm" {
        return None;
    }
    // `nexterm://open?workspacePath=...&workspaceEnv=...&wslDistro=...`
    if url.host_str() == Some("open") {
        let mut params: std::collections::HashMap<String, String> = url
            .query_pairs()
            .map(|(k, v)| (k.into_owned(), v.into_owned()))
            .collect();
        let path = params.remove("workspacePath");
        let env = params.remove("workspaceEnv");
        let wsl_distro = params.remove("wslDistro");
        if let (Some(path), Some(env)) = (path, env) {
            return Some(DeepLinkOpenRequest { path, env, wsl_distro });
        }
    }
    // `nexterm:///absolute/path` or `nexterm://host/absolute/path` style URLs
    // are treated as local workspace paths.
    let trimmed = url.path().trim_start_matches('/');
    if !trimmed.is_empty() {
        return Some(DeepLinkOpenRequest {
            path: trimmed.to_string(),
            env: "local".to_string(),
            wsl_distro: None,
        });
    }
    None
}

fn emit_deep_link_open<R: Runtime>(app: &AppHandle<R>, request: DeepLinkOpenRequest) {
    if let Err(error) = app.emit(DEEP_LINK_OPEN_EVENT, request) {
        log::warn!("failed to emit deep-link open event: {error}");
    }
}

/// Toggle the webview DevTools for the main window. Lets users inspect the
/// frontend without right-click (which the app disables for its custom
/// context menus). Works in debug builds by default; in release builds the
/// `devtools` Cargo feature must be enabled on the `tauri` dependency.
#[tauri::command]
fn toggle_devtools(app: tauri::AppHandle) -> bool {
    // The main window's label is the app identifier in Tauri 2.
    let label = app.config().identifier.clone();
    let Some(window) = app.get_webview_window(&label) else {
        // Fall back to the first available webview window (covers multi-window
        // scenarios where the main label differs).
        let windows = app.webview_windows();
        if let Some(window) = windows.values().next() {
            if window.is_devtools_open() {
                window.close_devtools();
            } else {
                window.open_devtools();
            }
            return window.is_devtools_open();
        }
        return false;
    };
    if window.is_devtools_open() {
        window.close_devtools();
    } else {
        window.open_devtools();
    }
    window.is_devtools_open()
}

/// Whether DevTools is currently open for the main window.
#[tauri::command]
fn is_devtools_open(app: tauri::AppHandle) -> bool {
    let label = app.config().identifier.clone();
    app.get_webview_window(&label)
        .map(|w| w.is_devtools_open())
        .unwrap_or(false)
}

#[cfg_attr(mobile, tauri::mobile_entry_point)]
pub fn run() {
    panic_report::install_panic_hook();
    workspace::init_launch_cwd();
    let launch_dir = parse_launch_dir();

    if let Err(error) = tauri::Builder::default()
        // Skip restoring VISIBLE — frontend calls window.show() after first
        // paint so the user never sees a transparent window-shadow flash on
        // Windows/Linux.
        .plugin(
            tauri_plugin_window_state::Builder::new()
                .with_state_flags(StateFlags::all() & !StateFlags::VISIBLE)
                .build(),
        )
        .plugin(tauri_plugin_autostart::Builder::new().build())
        .plugin(tauri_plugin_store::Builder::new().build())
        .plugin(tauri_plugin_os::init())
        .plugin(tauri_plugin_dialog::init())
        .plugin(tauri_plugin_clipboard_manager::init())
        .plugin(tauri_plugin_notification::init())
        .plugin(
            tauri_plugin_log::Builder::new()
                .level(tauri_plugin_log::log::LevelFilter::Info)
                .build(),
        )
        .plugin(tauri_plugin_opener::init())
        .plugin(tauri_plugin_positioner::init())
        .plugin(tauri_plugin_process::init())
        .plugin(tauri_plugin_deep_link::init())
        .setup(|app| {
            // Register the deep-link handler early so cold-start URLs (delivered
            // by the OS as CLI args on Windows/Linux) are emitted to the
            // frontend before `LaunchDir` is consumed by the bootstrap path.
            let app_handle = app.handle().clone();
            app.deep_link().on_open_url(move |event| {
                for url in event.urls() {
                    if let Some(request) = parse_deep_link_query(&url) {
                        emit_deep_link_open(&app_handle, request);
                    }
                }
            });
            // Surface any deep-link URL the plugin captured before our
            // listener attached (cold start on macOS/iOS). The plugin stores
            // it internally; re-emit it via our own event so the frontend
            // only needs a single subscription.
            if let Ok(Some(urls)) = app.deep_link().get_current() {
                let app_handle = app.handle().clone();
                for url in urls {
                    if let Some(request) = parse_deep_link_query(&url) {
                        emit_deep_link_open(&app_handle, request);
                    }
                }
            }
            Ok(())
        })
        .manage(pty::PtyState::default())
        .manage(shell::ShellState::default())
        .manage(fs::watcher::FsWatcherState::default())
        .manage({
            let registry = workspace::WorkspaceRegistry::default();
            workspace::bootstrap_registry_with_launch_dir(
                &registry,
                launch_dir.as_deref().map(std::path::Path::new),
            );
            registry
        })
        .manage(LaunchDir(Mutex::new(launch_dir)))
        .manage(lsp::LspRegistry::default())
        .invoke_handler(tauri::generate_handler![
            pty::pty_open,
            pty::pty_write,
            pty::pty_resize,
            pty::pty_close,
            pty::pty_kill,
            fs::tree::fs_read_dir,
            fs::file::fs_read_file,
            fs::file::fs_write_file,
            fs::mutate::fs_create_file,
            fs::mutate::fs_create_dir,
            fs::mutate::fs_rename,
            fs::mutate::fs_delete,
            fs::mutate::fs_copy,
            fs::search::fs_search,
            fs::search::fs_list_files,
            fs::grep::fs_grep,
            fs::grep::fs_glob,
            fs::watcher::fs_watch_workspace,
            fs::watcher::fs_unwatch_workspace,
            toggle_devtools,
            is_devtools_open,
            git::commands::git_resolve_repo,
            git::commands::git_panel_snapshot,
            git::commands::git_status,
            git::commands::git_diff,
            git::commands::git_diff_content,
            git::commands::git_stage,
            git::commands::git_unstage,
            git::commands::git_discard,
            git::commands::git_commit,
            git::commands::git_fetch,
            git::commands::git_pull_ff_only,
            git::commands::git_push,
            git::commands::git_branch_list,
            git::commands::git_checkout_branch,
            git::commands::git_create_branch,
            git::commands::git_stash_list,
            git::commands::git_stash_push,
            git::commands::git_stash_pop,
            git::commands::git_stash_drop,
            git::commands::git_stash_apply,
            git::commands::git_log,
            git::commands::git_show_commit,
            git::commands::git_commit_files,
            git::commands::git_commit_file_diff,
            git::commands::git_remote_url,
            git::commands::git_discover_repositories,
            shell::shell_run_command,
            shell::shell_bg_spawn,
            shell::shell_bg_logs,
            shell::shell_bg_kill,
            shell::shell_bg_list,
            workspace::wsl_list_distros,
            workspace::wsl_home,
            workspace::workspace_authorize,
            lsp::commands::lsp_start,
            lsp::commands::lsp_write,
            lsp::commands::lsp_stop,
            lsp::commands::lsp_list,
            lsp::commands::lsp_resolve_command,
            get_launch_dir,
        ])
        .run(tauri::generate_context!())
    {
        log::error!("error while running tauri application: {error}");
        eprintln!("[nexterm] error while running tauri application: {error}");
    }
}
