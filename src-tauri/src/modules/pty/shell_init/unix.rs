//! unix 平台的登录 shell 集成:默认取 passwd 登录 shell(或 `$SHELL`),
//! 也可按用户选择的 shell profile(`shell::profiles` 白名单)指定程序;
//! 把 Nexterm 的集成脚本落到 `~/.cache/nexterm/shell-integration/`
//! 并以对应机制注入(ZDOTDIR / --rcfile / conf.d)。

use std::ffi::OsString;
use std::fs;
use std::path::{Path, PathBuf};

use portable_pty::CommandBuilder;

use crate::modules::shell::profiles::{self, ShellKind};

pub fn build(cwd: Option<String>, shell_id: Option<&str>) -> Result<CommandBuilder, String> {
    let explicit = shell_id
        .filter(|s| !s.is_empty() && *s != "auto")
        .and_then(profiles::resolve_unix_shell_program);
    let (shell, shell_path) = match explicit {
        Some(path) => (ShellKind::from_program(Path::new(&path)), path),
        None => {
            let path = profiles::default_unix_shell_program()
                .filter(|s| !s.is_empty())
                .unwrap_or_else(|| "/bin/zsh".into());
            (ShellKind::from_program(Path::new(&path)), path)
        }
    };
    let mut cmd = CommandBuilder::new(&shell_path);
    super::apply_common(&mut cmd, cwd);

    match shell {
        ShellKind::Zsh => {
            match prepare_zdotdir() {
                Ok(zdotdir) => {
                    // Guard against Nexterm-in-Nexterm :)
                    if let Ok(user_zd) = std::env::var("ZDOTDIR") {
                        if Path::new(&user_zd) != zdotdir.as_path() {
                            cmd.env("NEXTERM_USER_ZDOTDIR", user_zd);
                        }
                    }
                    cmd.env("ZDOTDIR", &zdotdir);
                }
                Err(e) => {
                    log::warn!("zsh shell integration disabled: {e}");
                }
            }
            // Login shell so /etc/zprofile runs path_helper on macOS — without
            // this, GUI-launched apps get a minimal PATH missing Homebrew.
            cmd.arg("-l");
        }
        ShellKind::Bash => {
            match prepare_bash_rcfile() {
                Ok(rc) => {
                    cmd.arg("--rcfile");
                    cmd.arg(rc);
                }
                Err(e) => {
                    log::warn!("bash shell integration disabled: {e}");
                }
            }
            // bash ignores --rcfile under -l, so we use -i and source
            // /etc/profile from inside our rcfile to emulate login init.
            cmd.arg("-i");
        }
        ShellKind::Fish => {
            if let Err(e) = prepare_fish_conf_d() {
                log::warn!("fish shell integration disabled: {e}");
            }
            cmd.arg("-i");
        }
        ShellKind::Powershell | ShellKind::Cmd | ShellKind::Other => {
            log::info!(
                "unsupported shell '{}', spawning without integration",
                shell_path
            );
        }
    }
    Ok(cmd)
}

fn integration_root() -> Result<PathBuf, String> {
    let home = dirs::home_dir().ok_or_else(|| "could not resolve home dir".to_string())?;
    let root = home.join(".cache").join("nexterm").join("shell-integration");
    fs::create_dir_all(&root).map_err(|e| format!("create {}: {e}", root.display()))?;
    Ok(root)
}

fn prepare_zdotdir() -> Result<PathBuf, String> {
    let dir = integration_root()?.join("zsh");
    fs::create_dir_all(&dir).map_err(|e| format!("create {}: {e}", dir.display()))?;
    write_if_changed(&dir.join(".zshenv"), super::zshenv_script())?;
    write_if_changed(&dir.join(".zprofile"), super::zprofile_script())?;
    write_if_changed(&dir.join(".zshrc"), super::zshrc_script())?;
    write_if_changed(&dir.join(".zlogin"), super::zlogin_script())?;
    Ok(dir)
}

fn prepare_bash_rcfile() -> Result<PathBuf, String> {
    let dir = integration_root()?.join("bash");
    fs::create_dir_all(&dir).map_err(|e| format!("create {}: {e}", dir.display()))?;
    let rc = dir.join("bashrc");
    write_if_changed(&rc, super::bashrc_script())?;
    Ok(rc)
}

fn prepare_fish_conf_d() -> Result<(), String> {
    let home = dirs::home_dir().ok_or_else(|| "could not resolve home dir".to_string())?;
    let dir = home.join(".config").join("fish").join("conf.d");
    fs::create_dir_all(&dir).map_err(|e| format!("create {}: {e}", dir.display()))?;
    write_if_changed(&dir.join("nexterm.fish"), super::fish_init_script())?;
    Ok(())
}

fn write_if_changed(path: &Path, content: &str) -> Result<(), String> {
    if let Ok(existing) = fs::read_to_string(path) {
        if existing == content {
            return Ok(());
        }
    }
    // Atomic replace: a parallel shell startup must never source a half-written file.
    let mut tmp: OsString = path.as_os_str().to_owned();
    tmp.push(".__nexterm_tmp__");
    let tmp = PathBuf::from(tmp);
    fs::write(&tmp, content).map_err(|e| format!("write {}: {e}", tmp.display()))?;
    fs::rename(&tmp, path).map_err(|e| {
        let _ = fs::remove_file(&tmp);
        format!("rename {} -> {}: {e}", tmp.display(), path.display())
    })
}
