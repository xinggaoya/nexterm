//! shell 启动命令构建的公共入口。按平台分文件:
//! - `unix`:macOS / Linux 登录 shell 集成;
//! - `windows`:本地 PowerShell/CMD 与 WSL 发行版 shell 集成。
//!
//! 六份 shell 集成脚本在本模块统一定义,unix 与 windows 两侧
//! 通过这里的访问器取用,避免重复 include_str!。

use std::path::PathBuf;

use portable_pty::CommandBuilder;

use crate::modules::workspace::{self, WorkspaceEnv};

#[cfg(unix)]
mod unix;
#[cfg(windows)]
mod windows;

const BASHRC_SCRIPT: &str = include_str!("../scripts/bashrc.bash");
const ZSHENV_SCRIPT: &str = include_str!("../scripts/zshenv.zsh");
const ZPROFILE_SCRIPT: &str = include_str!("../scripts/zprofile.zsh");
const ZLOGIN_SCRIPT: &str = include_str!("../scripts/zlogin.zsh");
const ZSHRC_SCRIPT: &str = include_str!("../scripts/zshrc.zsh");
const FISH_INIT_SCRIPT: &str = include_str!("../scripts/init.fish");

pub(super) fn bashrc_script() -> &'static str {
    BASHRC_SCRIPT
}

pub(super) fn zshenv_script() -> &'static str {
    ZSHENV_SCRIPT
}

pub(super) fn zprofile_script() -> &'static str {
    ZPROFILE_SCRIPT
}

pub(super) fn zlogin_script() -> &'static str {
    ZLOGIN_SCRIPT
}

pub(super) fn zshrc_script() -> &'static str {
    ZSHRC_SCRIPT
}

pub(super) fn fish_init_script() -> &'static str {
    FISH_INIT_SCRIPT
}

pub fn build_command(
    cwd: Option<String>,
    shell_id: Option<&str>,
    workspace: WorkspaceEnv,
) -> Result<CommandBuilder, String> {
    #[cfg(unix)]
    {
        let _ = workspace;
        unix::build(cwd, shell_id)
    }
    #[cfg(windows)]
    {
        windows::build(cwd, shell_id, workspace)
    }
}

pub(super) fn ensure_utf8_locale(cmd: &mut CommandBuilder) {
    let is_utf8 = |v: &str| {
        let up = v.to_ascii_uppercase();
        up.contains("UTF-8") || up.contains("UTF8")
    };
    let already_utf8 = ["LC_ALL", "LC_CTYPE", "LANG"]
        .iter()
        .any(|k| std::env::var(k).ok().as_deref().is_some_and(is_utf8));
    if already_utf8 {
        return;
    }
    #[cfg(target_os = "macos")]
    let fallback = "en_US.UTF-8";
    #[cfg(all(unix, not(target_os = "macos")))]
    let fallback = "C.UTF-8";
    #[cfg(windows)]
    let fallback = "en_US.UTF-8";
    cmd.env("LANG", fallback);
}

pub(super) fn apply_common(cmd: &mut CommandBuilder, cwd: Option<String>) {
    cmd.env("TERM", "xterm-256color");
    cmd.env("COLORTERM", "truecolor");
    cmd.env("NEXTERM_TERMINAL", "1");
    ensure_utf8_locale(cmd);

    let resolved_cwd = cwd
        .map(PathBuf::from)
        .filter(|p| p.is_dir())
        .or_else(|| workspace::launch_cwd_snapshot().filter(|p| p.is_dir()))
        .or_else(|| dirs::home_dir().filter(|p| p.is_dir()));
    if let Some(cwd) = resolved_cwd {
        #[cfg(windows)]
        let cwd = PathBuf::from(cwd.to_string_lossy().replace('/', "\\"));
        log::info!("pty cwd: {}", cwd.display());
        cmd.cwd(cwd);
    } else {
        log::warn!("pty cwd: no usable directory, inheriting from process");
    }
}
