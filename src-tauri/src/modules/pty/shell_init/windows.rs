//! Windows 平台的 shell 启动:本地按用户选择的 shell profile(白名单
//! 解析见 `shell::profiles`)注入对应集成——PowerShell 走 profile.ps1,
//! Git Bash 走 --rcfile;WSL 发行版先探测登录 shell,把集成脚本经 UNC
//! 路径写进发行版的 `~/.cache/nexterm/shell-integration/`,再组装
//! wsl.exe 启动参数。

use std::ffi::OsString;
use std::fs;
use std::path::{Path, PathBuf};

use portable_pty::CommandBuilder;

use crate::modules::shell::profiles::{self, ShellKind as LocalShellKind};
use crate::modules::workspace::WorkspaceEnv;

const PROFILE_PS1: &str = include_str!("../scripts/profile.ps1");

#[derive(Clone, Copy, Debug, Eq, PartialEq)]
enum ShellKind {
    Zsh,
    Bash,
    Fish,
    Other,
}

impl ShellKind {
    fn from_path(path: &str) -> Self {
        match path.rsplit('/').next().unwrap_or("") {
            "zsh" => Self::Zsh,
            "bash" => Self::Bash,
            "fish" => Self::Fish,
            _ => Self::Other,
        }
    }
}

#[derive(Clone, Debug, Eq, PartialEq)]
enum WslShellIntegration {
    Zsh {
        zdotdir: String,
        user_zdotdir: Option<String>,
    },
    Bash {
        rcfile: String,
    },
    Fish,
    None,
}

#[derive(Clone, Debug, Eq, PartialEq)]
struct WslLaunchSpec {
    args: Vec<String>,
}

pub fn build(
    cwd: Option<String>,
    shell_id: Option<&str>,
    workspace: WorkspaceEnv,
) -> Result<CommandBuilder, String> {
    if let WorkspaceEnv::Wsl { distro } = workspace {
        return build_wsl(cwd, distro);
    }
    let resolved = profiles::resolve_local_shell(shell_id);

    let mut cmd = CommandBuilder::new(&resolved.program);
    super::apply_common(&mut cmd, cwd);

    match resolved.kind {
        LocalShellKind::Powershell => {
            match prepare_ps_profile() {
                Ok(profile) => {
                    cmd.arg("-NoLogo");
                    cmd.arg("-NoExit");
                    cmd.arg("-ExecutionPolicy");
                    cmd.arg("Bypass");
                    cmd.arg("-File");
                    cmd.arg(profile);
                }
                Err(e) => {
                    log::warn!("powershell shell integration disabled: {e}");
                }
            }
        }
        LocalShellKind::Bash => {
            // bash 只在交互模式下读 --rcfile，且 -l 会忽略它——集成脚本
            // 自身会链回 /etc/profile 与用户 rc 文件来模拟登录初始化。
            match prepare_local_bash_rcfile() {
                Ok(rcfile) => {
                    cmd.arg("--rcfile");
                    cmd.arg(rcfile);
                }
                Err(e) => {
                    log::warn!("bash shell integration disabled: {e}");
                }
            }
            cmd.arg("-i");
        }
        LocalShellKind::Cmd | LocalShellKind::Zsh | LocalShellKind::Fish | LocalShellKind::Other => {
            log::info!(
                "spawning {} without shell integration",
                resolved.program.display()
            );
        }
    }

    log::info!(
        "spawning Windows shell: {} (profile {})",
        resolved.program.display(),
        resolved.id
    );
    Ok(cmd)
}

fn build_wsl(cwd: Option<String>, distro: String) -> Result<CommandBuilder, String> {
    crate::modules::workspace::validate_wsl_distro_name(&distro)?;
    let shell_path = crate::modules::workspace::wsl_login_shell(distro.clone())?;
    let shell_kind = ShellKind::from_path(&shell_path);
    let integration = match shell_kind {
        ShellKind::Zsh => match prepare_wsl_zdotdir(&distro) {
            Ok(zdotdir) => {
                let user_zdotdir = match probe_wsl_zdotdir(&distro, &shell_path) {
                    Ok(path) if !path.is_empty() && path != zdotdir => Some(path),
                    Ok(_) => None,
                    Err(e) => {
                        log::warn!("WSL zsh ZDOTDIR probe failed for {distro}: {e}");
                        None
                    }
                };
                WslShellIntegration::Zsh {
                    zdotdir,
                    user_zdotdir,
                }
            }
            Err(e) => {
                log::warn!("WSL zsh shell integration disabled for {distro}: {e}");
                WslShellIntegration::None
            }
        },
        ShellKind::Bash => match prepare_wsl_bash_rcfile(&distro) {
            Ok(rcfile) => WslShellIntegration::Bash { rcfile },
            Err(e) => {
                log::warn!("WSL bash shell integration disabled for {distro}: {e}");
                WslShellIntegration::None
            }
        },
        ShellKind::Fish => match prepare_wsl_fish_conf_d(&distro) {
            Ok(()) => WslShellIntegration::Fish,
            Err(e) => {
                log::warn!("WSL fish shell integration disabled for {distro}: {e}");
                WslShellIntegration::None
            }
        },
        ShellKind::Other => {
            log::info!(
                "unsupported WSL shell '{}', spawning without integration",
                shell_path
            );
            WslShellIntegration::None
        }
    };
    let spec =
        build_wsl_launch_spec(cwd.as_deref(), &distro, &shell_path, shell_kind, integration);
    let mut cmd = CommandBuilder::new("wsl.exe");
    for arg in &spec.args {
        cmd.arg(arg);
    }
    cmd.env("TERM", "xterm-256color");
    cmd.env("COLORTERM", "truecolor");
    cmd.env("NEXTERM_TERMINAL", "1");
    super::ensure_utf8_locale(&mut cmd);
    log::info!("spawning WSL shell: {distro} ({shell_path})");
    Ok(cmd)
}

fn build_wsl_launch_spec(
    cwd: Option<&str>,
    distro: &str,
    shell_path: &str,
    shell_kind: ShellKind,
    integration: WslShellIntegration,
) -> WslLaunchSpec {
    let mut args = vec![
        "-d".to_string(),
        distro.to_string(),
        "--cd".to_string(),
        cwd.filter(|s| !s.is_empty()).unwrap_or("~").to_string(),
        "--exec".to_string(),
    ];
    match (shell_kind, integration) {
        (
            ShellKind::Zsh,
            WslShellIntegration::Zsh {
                zdotdir,
                user_zdotdir,
            },
        ) => {
            args.push("env".to_string());
            if let Some(user_zdotdir) = user_zdotdir {
                args.push(format!("NEXTERM_USER_ZDOTDIR={user_zdotdir}"));
            }
            args.push(format!("ZDOTDIR={zdotdir}"));
            args.push(shell_path.to_string());
            args.push("-l".to_string());
        }
        (ShellKind::Bash, WslShellIntegration::Bash { rcfile }) => {
            args.push(shell_path.to_string());
            args.push("--rcfile".to_string());
            args.push(rcfile);
            args.push("-i".to_string());
        }
        (ShellKind::Fish, WslShellIntegration::Fish) => {
            args.push(shell_path.to_string());
            args.push("-i".to_string());
        }
        (ShellKind::Zsh, WslShellIntegration::None) => {
            args.push(shell_path.to_string());
            args.push("-l".to_string());
        }
        (ShellKind::Bash, WslShellIntegration::None)
        | (ShellKind::Fish, WslShellIntegration::None) => {
            args.push(shell_path.to_string());
            args.push("-i".to_string());
        }
        (ShellKind::Other, _) => args.push(shell_path.to_string()),
        _ => {
            args.push(shell_path.to_string());
        }
    }
    WslLaunchSpec { args }
}

fn probe_wsl_zdotdir(distro: &str, shell_path: &str) -> Result<String, String> {
    let out = crate::modules::workspace::wsl_exec_capture(
        distro,
        shell_path,
        &["-c", r#"printf %s "${ZDOTDIR:-$HOME}""#],
    )?;
    Ok(crate::modules::workspace::normalize_wsl_value(out, ""))
}

fn prepare_wsl_integration_dir(distro: &str, shell: &str) -> Result<(String, PathBuf), String> {
    let home = crate::modules::workspace::wsl_home(distro.to_string())?;
    let linux_dir = format!(
        "{}/.cache/nexterm/shell-integration/{shell}",
        home.trim_end_matches('/')
    );
    let unc_dir = crate::modules::workspace::wsl_path_to_unc(distro, &linux_dir);
    fs::create_dir_all(&unc_dir).map_err(|e| format!("create {}: {e}", unc_dir.display()))?;
    Ok((linux_dir, unc_dir))
}

fn normalize_script(content: &str) -> String {
    content.replace("\r\n", "\n")
}

fn prepare_wsl_zdotdir(distro: &str) -> Result<String, String> {
    let (linux_dir, unc_dir) = prepare_wsl_integration_dir(distro, "zsh")?;
    write_if_changed(
        &unc_dir.join(".zshenv"),
        &normalize_script(super::zshenv_script()),
    )?;
    write_if_changed(
        &unc_dir.join(".zprofile"),
        &normalize_script(super::zprofile_script()),
    )?;
    write_if_changed(
        &unc_dir.join(".zshrc"),
        &normalize_script(super::zshrc_script()),
    )?;
    write_if_changed(
        &unc_dir.join(".zlogin"),
        &normalize_script(super::zlogin_script()),
    )?;
    Ok(linux_dir)
}

fn prepare_wsl_bash_rcfile(distro: &str) -> Result<String, String> {
    let (linux_dir, _unc_dir) = prepare_wsl_integration_dir(distro, "bash")?;
    let linux_rc = format!("{linux_dir}/bashrc");
    let unc_file = crate::modules::workspace::wsl_path_to_unc(distro, &linux_rc);
    let content = normalize_script(super::bashrc_script());
    write_if_changed(&unc_file, &content)?;
    Ok(linux_rc)
}

fn prepare_wsl_fish_conf_d(distro: &str) -> Result<(), String> {
    let home = crate::modules::workspace::wsl_home(distro.to_string())?;
    let linux_dir = format!("{}/.config/fish/conf.d", home.trim_end_matches('/'));
    let unc_dir = crate::modules::workspace::wsl_path_to_unc(distro, &linux_dir);
    fs::create_dir_all(&unc_dir).map_err(|e| format!("create {}: {e}", unc_dir.display()))?;
    let unc_file = unc_dir.join("nexterm.fish");
    let content = normalize_script(super::fish_init_script());
    write_if_changed(&unc_file, &content)?;
    Ok(())
}

fn integration_root() -> Result<PathBuf, String> {
    let home = dirs::home_dir().ok_or_else(|| "could not resolve home dir".to_string())?;
    let root = home.join(".cache").join("nexterm").join("shell-integration");
    fs::create_dir_all(&root).map_err(|e| format!("create {}: {e}", root.display()))?;
    Ok(root)
}

fn prepare_ps_profile() -> Result<PathBuf, String> {
    let dir = integration_root()?.join("powershell");
    fs::create_dir_all(&dir).map_err(|e| format!("create {}: {e}", dir.display()))?;
    let file = dir.join("profile.ps1");
    write_if_changed(&file, PROFILE_PS1)?;
    Ok(file)
}

/// Git Bash / Cygwin bash 的集成:rcfile 指向与 WSL bash 共用的 bashrc
/// 脚本。MSYS bash 对 CRLF 敏感,写入前统一换行;传给 bash 的参数用
/// 正斜杠路径,避免反斜杠被当转义处理。
fn prepare_local_bash_rcfile() -> Result<PathBuf, String> {
    let dir = integration_root()?.join("bash");
    fs::create_dir_all(&dir).map_err(|e| format!("create {}: {e}", dir.display()))?;
    let rc = dir.join("bashrc");
    write_if_changed(&rc, &normalize_script(super::bashrc_script()))?;
    Ok(PathBuf::from(rc.to_string_lossy().replace('\\', "/")))
}

fn write_if_changed(path: &Path, content: &str) -> Result<(), String> {
    if let Ok(existing) = fs::read_to_string(path) {
        if existing == content {
            return Ok(());
        }
    }
    let mut tmp: OsString = path.as_os_str().to_owned();
    tmp.push(".__nexterm_tmp__");
    let tmp = PathBuf::from(tmp);
    fs::write(&tmp, content).map_err(|e| format!("write {}: {e}", tmp.display()))?;
    fs::rename(&tmp, path).map_err(|e| {
        let _ = fs::remove_file(&tmp);
        format!("rename {} -> {}: {e}", tmp.display(), path.display())
    })
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn builds_wsl_zsh_launch_spec_with_env_and_login() {
        let spec = build_wsl_launch_spec(
            Some("/home/vinicios/repo"),
            "Ubuntu",
            "/usr/bin/zsh",
            ShellKind::Zsh,
            WslShellIntegration::Zsh {
                zdotdir: "/home/vinicios/.cache/nexterm/shell-integration/zsh".into(),
                user_zdotdir: None,
            },
        );
        assert_eq!(
            spec.args,
            vec![
                "-d".to_string(),
                "Ubuntu".to_string(),
                "--cd".to_string(),
                "/home/vinicios/repo".to_string(),
                "--exec".to_string(),
                "env".to_string(),
                "ZDOTDIR=/home/vinicios/.cache/nexterm/shell-integration/zsh".to_string(),
                "/usr/bin/zsh".to_string(),
                "-l".to_string(),
            ]
        );
    }

    #[test]
    fn builds_wsl_zsh_launch_spec_with_user_zdotdir_probe() {
        let spec = build_wsl_launch_spec(
            Some("/home/vinicios/repo"),
            "Ubuntu",
            "/usr/bin/zsh",
            ShellKind::Zsh,
            WslShellIntegration::Zsh {
                zdotdir: "/home/vinicios/.cache/nexterm/shell-integration/zsh".into(),
                user_zdotdir: Some("/home/vinicios/.config/zsh".into()),
            },
        );
        assert_eq!(
            spec.args,
            vec![
                "-d".to_string(),
                "Ubuntu".to_string(),
                "--cd".to_string(),
                "/home/vinicios/repo".to_string(),
                "--exec".to_string(),
                "env".to_string(),
                "NEXTERM_USER_ZDOTDIR=/home/vinicios/.config/zsh".to_string(),
                "ZDOTDIR=/home/vinicios/.cache/nexterm/shell-integration/zsh".to_string(),
                "/usr/bin/zsh".to_string(),
                "-l".to_string(),
            ]
        );
    }

    #[test]
    fn builds_wsl_zsh_launch_spec_without_integration_still_uses_login_shell() {
        let spec = build_wsl_launch_spec(
            Some("/home/vinicios/repo"),
            "Ubuntu",
            "/usr/bin/zsh",
            ShellKind::Zsh,
            WslShellIntegration::None,
        );
        assert_eq!(
            spec.args,
            vec![
                "-d".to_string(),
                "Ubuntu".to_string(),
                "--cd".to_string(),
                "/home/vinicios/repo".to_string(),
                "--exec".to_string(),
                "/usr/bin/zsh".to_string(),
                "-l".to_string(),
            ]
        );
    }

    #[test]
    fn builds_wsl_bash_launch_spec_with_rcfile() {
        let spec = build_wsl_launch_spec(
            Some("/home/vinicios/repo"),
            "Ubuntu",
            "/bin/bash",
            ShellKind::Bash,
            WslShellIntegration::Bash {
                rcfile: "/home/vinicios/.cache/nexterm/shell-integration/bash/bashrc".into(),
            },
        );
        assert_eq!(
            spec.args,
            vec![
                "-d".to_string(),
                "Ubuntu".to_string(),
                "--cd".to_string(),
                "/home/vinicios/repo".to_string(),
                "--exec".to_string(),
                "/bin/bash".to_string(),
                "--rcfile".to_string(),
                "/home/vinicios/.cache/nexterm/shell-integration/bash/bashrc".to_string(),
                "-i".to_string(),
            ]
        );
    }

    #[test]
    fn builds_wsl_fish_launch_spec_without_init_command() {
        let spec = build_wsl_launch_spec(
            Some("/home/vinicios/repo"),
            "Ubuntu",
            "/usr/bin/fish",
            ShellKind::Fish,
            WslShellIntegration::Fish,
        );
        assert_eq!(
            spec.args,
            vec![
                "-d".to_string(),
                "Ubuntu".to_string(),
                "--cd".to_string(),
                "/home/vinicios/repo".to_string(),
                "--exec".to_string(),
                "/usr/bin/fish".to_string(),
                "-i".to_string(),
            ]
        );
    }

    #[test]
    fn builds_wsl_other_shell_without_integration() {
        let spec = build_wsl_launch_spec(
            None,
            "Ubuntu",
            "/usr/bin/nu",
            ShellKind::Other,
            WslShellIntegration::None,
        );
        assert_eq!(
            spec.args,
            vec![
                "-d".to_string(),
                "Ubuntu".to_string(),
                "--cd".to_string(),
                "~".to_string(),
                "--exec".to_string(),
                "/usr/bin/nu".to_string(),
            ]
        );
    }
}
