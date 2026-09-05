#[cfg(windows)]
use std::process::Command;

#[cfg(windows)]
use crate::modules::process::suppress_command_window;
use crate::modules::workspace::WorkspaceEnv;
#[cfg(windows)]
use crate::modules::workspace::{decode_command_output, validate_wsl_distro_name};

#[derive(Clone, Debug, PartialEq, Eq)]
pub struct WslDirEntry {
    pub name: String,
    pub kind: WslEntryKind,
    pub size: u64,
    pub mtime: u64,
}

#[derive(Clone, Debug, PartialEq, Eq)]
pub enum WslEntryKind {
    File,
    Dir,
    Symlink,
}

#[derive(Clone, Debug, PartialEq, Eq)]
pub struct WslFileStat {
    pub size: u64,
    pub mtime: u64,
    pub kind: WslEntryKind,
}

pub fn should_use_wsl_ops(path: &str, workspace: &WorkspaceEnv) -> bool {
    matches!(workspace, WorkspaceEnv::Wsl { .. }) && !is_wsl_drvfs_path(path)
}

fn is_wsl_drvfs_path(path: &str) -> bool {
    let normalized = path.replace('\\', "/");
    let Some(rest) = normalized.strip_prefix("/mnt/") else {
        return false;
    };
    let drive = rest.split('/').next().unwrap_or("");
    drive.len() == 1 && drive.as_bytes()[0].is_ascii_alphabetic()
}

#[cfg(windows)]
fn run_wsl_bytes(distro: &str, program: &str, args: &[&str]) -> Result<Vec<u8>, String> {
    validate_wsl_distro_name(distro)?;
    let mut cmd = Command::new("wsl.exe");
    cmd.arg("-d")
        .arg(distro)
        .arg("--exec")
        .arg(program)
        .args(args);
    suppress_command_window(&mut cmd);
    let output = cmd.output().map_err(|e| e.to_string())?;
    if output.status.success() {
        Ok(output.stdout)
    } else {
        let stderr = decode_command_output(&output.stderr);
        Err(stderr.trim().to_string())
    }
}

#[cfg(not(windows))]
fn run_wsl_bytes(distro: &str, program: &str, args: &[&str]) -> Result<Vec<u8>, String> {
    let _ = distro;
    let _ = program;
    let _ = args;
    Err("WSL is only available on Windows".into())
}

/// agent 优先、legacy 兜底:资产缺失/熔断/任何 agent 错误都会落到
/// 原 `wsl.exe` 路径,错误信息保持不变(测试与前端依赖这些消息)。
pub fn read_file(distro: &str, path: &str) -> Result<Vec<u8>, String> {
    if let Ok(bytes) = crate::modules::agent::read_file(distro, path) {
        return Ok(bytes);
    }
    run_wsl_bytes(distro, "cat", &[path])
        .map_err(|error| format!("fs_read_file WSL({path}) failed: {error}"))
}

pub fn stat_path(distro: &str, path: &str) -> Result<WslFileStat, String> {
    if let Ok(stat) = crate::modules::agent::stat(distro, path) {
        return Ok(stat);
    }
    let output = run_wsl_bytes(distro, "sh", &["-c", STAT_SCRIPT, "sh", path])
        .map_err(|error| format!("fs_stat WSL({path}) failed: {error}"))?;
    parse_stat_line(&String::from_utf8_lossy(&output))
        .ok_or_else(|| format!("fs_stat WSL({path}) returned invalid metadata"))
}

pub fn read_dir(distro: &str, path: &str) -> Result<Vec<WslDirEntry>, String> {
    if let Ok(entries) = crate::modules::agent::read_dir(distro, path) {
        return Ok(entries);
    }
    let output = run_wsl_bytes(distro, "sh", &["-c", READ_DIR_SCRIPT, "sh", path])
        .map_err(|error| format!("fs_read_dir WSL({path}) failed: {error}"))?;
    parse_dir_output(&String::from_utf8_lossy(&output))
        .ok_or_else(|| format!("fs_read_dir WSL({path}) returned invalid entries"))
}

const STAT_SCRIPT: &str = r#"p=$1
if [ -e "$p" ]; then
  kind=file
  [ -d "$p" ] && kind=dir
  set -- $(stat -Lc '%s %Y' "$p") || exit 1
elif [ -L "$p" ]; then
  kind=symlink
  set -- $(stat -c '%s %Y' "$p") || exit 1
else
  printf 'not found: %s\n' "$p" >&2
  exit 1
fi
printf '%s\t%s\t%s000\n' "$kind" "$1" "$2"
"#;

const READ_DIR_SCRIPT: &str = r#"root=$1
[ -d "$root" ] || {
  printf 'not a directory: %s\n' "$root" >&2
  exit 1
}
for p in "$root"/* "$root"/.[!.]* "$root"/..?*; do
  [ -e "$p" ] || [ -L "$p" ] || continue
  name=${p##*/}
  [ "$name" = "." ] || [ "$name" = ".." ] && continue
  if [ -e "$p" ]; then
    kind=file
    [ -d "$p" ] && kind=dir
    set -- $(stat -Lc '%s %Y' "$p") || continue
  elif [ -L "$p" ]; then
    kind=symlink
    set -- $(stat -c '%s %Y' "$p") || continue
  else
    continue
  fi
  safe_name=$(printf '%s' "$name" | tr '\t\n' '  ')
  printf '%s\t%s\t%s000\t%s\n' "$kind" "$1" "$2" "$safe_name"
done
"#;

fn parse_kind(raw: &str) -> Option<WslEntryKind> {
    match raw {
        "file" => Some(WslEntryKind::File),
        "dir" => Some(WslEntryKind::Dir),
        "symlink" => Some(WslEntryKind::Symlink),
        _ => None,
    }
}

fn parse_stat_line(output: &str) -> Option<WslFileStat> {
    let line = output.lines().find(|line| !line.trim().is_empty())?;
    let mut parts = line.split('\t');
    let kind = parse_kind(parts.next()?)?;
    let size = parts.next()?.parse().ok()?;
    let mtime = parts.next()?.parse().ok()?;
    Some(WslFileStat { size, mtime, kind })
}

fn parse_dir_output(output: &str) -> Option<Vec<WslDirEntry>> {
    let mut entries = Vec::new();
    for line in output.lines().filter(|line| !line.trim().is_empty()) {
        let mut parts = line.splitn(4, '\t');
        let kind = parse_kind(parts.next()?)?;
        let size = parts.next()?.parse().ok()?;
        let mtime = parts.next()?.parse().ok()?;
        let name = parts.next()?.to_string();
        entries.push(WslDirEntry {
            name,
            kind,
            size,
            mtime,
        });
    }
    Some(entries)
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn detects_drvfs_paths() {
        assert!(is_wsl_drvfs_path("/mnt/c/Users/dev/repo"));
        assert!(is_wsl_drvfs_path("/mnt/d"));
        assert!(!is_wsl_drvfs_path("/mnt/wsl"));
        assert!(!is_wsl_drvfs_path("/home/dev/repo"));
    }

    #[test]
    fn wsl_ops_only_apply_to_non_drvfs_wsl_paths() {
        let workspace = WorkspaceEnv::Wsl {
            distro: "Ubuntu".into(),
        };

        assert!(should_use_wsl_ops("/home/dev/repo", &workspace));
        assert!(!should_use_wsl_ops("/mnt/c/repo", &workspace));
        assert!(!should_use_wsl_ops("/home/dev/repo", &WorkspaceEnv::Local));
    }

    #[test]
    fn parses_stat_line() {
        assert_eq!(
            parse_stat_line("file\t12\t345\n"),
            Some(WslFileStat {
                kind: WslEntryKind::File,
                size: 12,
                mtime: 345,
            })
        );
    }

    #[test]
    fn parses_directory_output() {
        let entries = parse_dir_output("dir\t0\t1\tsrc\nfile\t42\t2\tmain.rs\n").unwrap();

        assert_eq!(
            entries,
            vec![
                WslDirEntry {
                    name: "src".into(),
                    kind: WslEntryKind::Dir,
                    size: 0,
                    mtime: 1,
                },
                WslDirEntry {
                    name: "main.rs".into(),
                    kind: WslEntryKind::File,
                    size: 42,
                    mtime: 2,
                },
            ]
        );
    }
}
