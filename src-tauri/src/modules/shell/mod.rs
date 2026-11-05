pub mod background;
pub mod profiles;
pub mod ringbuffer;

use std::collections::HashMap;
use std::process::Command;
use std::sync::atomic::{AtomicU32, Ordering};
use std::sync::{Arc, RwLock};

use crate::modules::lock::{rwlock_read, rwlock_write};
// `suppress_command_window` 在所有平台都有定义（windows 下真正隐藏窗口，其余平台
// 是空实现），而 `#[cfg(unix)]` 分支也会调用它 —— import 不能只限 windows。
use crate::modules::process::suppress_command_window;
#[cfg(windows)]
use crate::modules::workspace::validate_wsl_distro_name;
use crate::modules::workspace::{authorize_spawn_cwd, WorkspaceEnv, WorkspaceRegistry};

use background::{BackgroundLogResponse, BackgroundProc, BackgroundProcInfo};

// ──────────────────────────────────────────────────────────────────────────
// Background process state.
// ──────────────────────────────────────────────────────────────────────────

pub struct ShellState {
    bg: RwLock<HashMap<u32, Arc<BackgroundProc>>>,
    next_bg_id: AtomicU32,
}

impl Default for ShellState {
    fn default() -> Self {
        Self {
            bg: RwLock::new(HashMap::new()),
            next_bg_id: AtomicU32::new(1),
        }
    }
}

#[tauri::command]
pub fn shell_bg_spawn(
    state: tauri::State<ShellState>,
    registry: tauri::State<WorkspaceRegistry>,
    command: String,
    cwd: Option<String>,
    workspace: Option<WorkspaceEnv>,
) -> Result<u32, String> {
    let workspace = WorkspaceEnv::from_option(workspace);
    crate::modules::workspace::reject_ssh_unsupported(&workspace, "shell command")?;
    authorize_spawn_cwd(&registry, cwd.as_deref(), &workspace)?;
    let proc = background::spawn(command, cwd, workspace)?;
    let id = state.next_bg_id.fetch_add(1, Ordering::Relaxed);
    rwlock_write(&state.bg, "background processes")?.insert(id, proc);
    Ok(id)
}

#[tauri::command]
pub fn shell_bg_logs(
    state: tauri::State<ShellState>,
    handle: u32,
    since_offset: Option<u64>,
) -> Result<BackgroundLogResponse, String> {
    let proc = rwlock_read(&state.bg, "background processes")?
        .get(&handle)
        .cloned()
        .ok_or_else(|| "no background handle".to_string())?;
    Ok(proc.read_logs(since_offset.unwrap_or(0)))
}

#[tauri::command]
pub fn shell_bg_kill(state: tauri::State<ShellState>, handle: u32) -> Result<(), String> {
    // 必须从表里移除：只 kill 不 remove 会让每个后台进程永久占用
    // 4 MiB 的环形缓冲 + SharedChild，`Drop` 也永不触发，
    // `shell_bg_list` 还会无限增长地列出所有历史僵尸任务。
    let proc = rwlock_write(&state.bg, "background processes")?.remove(&handle);
    if let Some(proc) = proc {
        proc.kill();
    }
    Ok(())
}

/// 已自行退出的后台进程会在返回前顺手回收（见 `reap_exited`）。
#[tauri::command]
pub fn shell_bg_list(state: tauri::State<ShellState>) -> Result<Vec<BackgroundProcInfo>, String> {
    reap_exited(&state);
    let map = rwlock_read(&state.bg, "background processes")?;
    let mut out = Vec::with_capacity(map.len());
    for (id, p) in map.iter() {
        out.push(p.info(*id));
    }
    out.sort_by_key(|i| i.handle);
    Ok(out)
}

/// 回收已经结束的后台进程条目。
///
/// 进程自己跑完（不需要前端显式 kill）时，没有任何地方会把它从表里
/// 拿走。列表接口顺手清一次，代价是一次 O(n) 扫描。
fn reap_exited(state: &ShellState) {
    let Ok(mut map) = rwlock_write(&state.bg, "background processes") else {
        return;
    };
    let finished: Vec<u32> = map
        .iter()
        .filter(|(_, proc)| proc.has_exited())
        .map(|(id, _)| *id)
        .collect();
    for id in finished {
        map.remove(&id);
    }
}

/// 探测本机可用的终端 shell profile（设置界面"默认 Shell"下拉）。
/// 只返回实际存在的条目；前端选择的是 id，路径解析收敛在后端白名单里。
#[tauri::command]
pub fn shell_list_profiles() -> Vec<profiles::ShellProfile> {
    profiles::detected_profiles()
}

pub(crate) fn build_oneshot_command(
    command: &str,
    #[cfg_attr(not(windows), allow(unused_variables))] workspace: &WorkspaceEnv,
    #[cfg_attr(not(windows), allow(unused_variables))] cwd: Option<&str>,
) -> Result<Command, String> {
    #[cfg(windows)]
    if let WorkspaceEnv::Wsl { distro } = workspace {
        validate_wsl_distro_name(distro)?;
        let mut cmd = Command::new("wsl.exe");
        cmd.arg("-d").arg(distro);
        if let Some(cwd) = cwd.filter(|s| !s.is_empty()) {
            cmd.arg("--cd").arg(cwd);
        }
        cmd.arg("--exec").arg("sh").arg("-lc").arg(command);
        suppress_command_window(&mut cmd);
        return Ok(cmd);
    }
    #[cfg(unix)]
    {
        let mut cmd = Command::new("/bin/sh");
        cmd.arg("-c").arg(command);
        suppress_command_window(&mut cmd);
        Ok(cmd)
    }
    #[cfg(windows)]
    {
        let shell = profiles::windows_shell_path();
        let mut cmd = Command::new(&shell);
        let is_cmd = shell
            .file_name()
            .and_then(|s| s.to_str())
            .map(|s| s.eq_ignore_ascii_case("cmd.exe"))
            .unwrap_or(false);
        if is_cmd {
            cmd.arg("/C").arg(command);
        } else {
            cmd.arg("-NoProfile").arg("-Command").arg(command);
        }
        suppress_command_window(&mut cmd);
        Ok(cmd)
    }
}
