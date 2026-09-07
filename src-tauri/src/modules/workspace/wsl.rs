use std::path::PathBuf;

use serde::Serialize;

use super::env::WorkspaceEnv;
#[cfg(windows)]
use crate::modules::process::suppress_command_window;

#[derive(Clone, Debug, Serialize)]
pub struct WslDistro {
    pub name: String,
    pub default: bool,
    pub running: bool,
}

// Stable error prefix the frontend can pattern-match on to tell the user that
// WSL itself is missing or disabled (vs. e.g. an invalid distro name). The
// shape is `WslNotAvailable: <hint>` so a single string still fits the existing
// `Result<_, String>` Tauri commands without a new error enum.
pub(crate) const WSL_NOT_AVAILABLE_PREFIX: &str = "WslNotAvailable: ";

#[cfg(windows)]
fn wsl_spawn_error(context: &str, error: std::io::Error) -> String {
    match error.kind() {
        std::io::ErrorKind::NotFound => format!(
            "{WSL_NOT_AVAILABLE_PREFIX}Windows Subsystem for Linux is not installed. \
             Run 'wsl --install' from an elevated command prompt, then restart Nexterm. \
             ({context}: {error})"
        ),
        std::io::ErrorKind::PermissionDenied => format!(
            "{WSL_NOT_AVAILABLE_PREFIX}WSL is installed but the app does not have permission \
             to launch wsl.exe. Check that virtualization is enabled and that no Group Policy \
             is blocking WSL. ({context}: {error})"
        ),
        _ => format!("{context}: {error}"),
    }
}

#[cfg(windows)]
pub fn resolve_path(path: &str, workspace: &WorkspaceEnv) -> PathBuf {
    match workspace {
        WorkspaceEnv::Local => PathBuf::from(path),
        WorkspaceEnv::Wsl { distro } => wsl_path_to_host(distro, path),
        // SSH 路径不经宿主文件系统;调用方应先过 reject_ssh_unsupported。
        WorkspaceEnv::Ssh { .. } => PathBuf::from(path),
    }
}

#[cfg(not(windows))]
pub fn resolve_path(path: &str, _workspace: &WorkspaceEnv) -> PathBuf {
    PathBuf::from(path)
}

/// True for WSL distro names safe to splice into a UNC path. Real WSL distros
/// are alphanumeric with `.`, `_`, `-` separators (e.g. `Ubuntu-22.04`). Reject
/// anything that could traverse out of the `\\wsl.localhost\<distro>\` prefix
/// (`..`, `\`, `/`, `:`, `?`, `*`, control bytes) or empty names.
#[cfg(windows)]
fn is_safe_distro_name(name: &str) -> bool {
    if name.is_empty() || name.len() > 255 {
        return false;
    }
    if name == "." || name == ".." || name.starts_with('.') {
        return false;
    }
    name.chars()
        .all(|c| c.is_ascii_alphanumeric() || matches!(c, '.' | '_' | '-' | ' '))
        && !name.contains("..")
}

#[cfg(windows)]
pub(crate) fn validate_wsl_distro_name(distro: &str) -> Result<(), String> {
    if is_safe_distro_name(distro) {
        Ok(())
    } else {
        Err(format!("unsafe WSL distro name: {distro}"))
    }
}

#[cfg(windows)]
fn normalize_wsl_absolute_path(path: &str) -> String {
    let normalized = path.trim().replace('\\', "/");
    if normalized == "/" {
        return "/".into();
    }
    let trimmed = normalized.trim_end_matches('/');
    if trimmed.is_empty() {
        "/".into()
    } else {
        trimmed.to_string()
    }
}

#[cfg(windows)]
fn strip_wsl_unc_prefix(normalized: &str) -> Option<&str> {
    let lower = normalized.to_ascii_lowercase();
    for prefix in ["//wsl.localhost/", "//wsl$/"] {
        if lower.starts_with(prefix) {
            return Some(&normalized[prefix.len()..]);
        }
    }
    None
}

#[cfg(windows)]
fn is_incomplete_wsl_unc_path(normalized: &str) -> bool {
    let lower = normalized.to_ascii_lowercase();
    lower == "//wsl.localhost"
        || lower == "//wsl.localhost/"
        || lower == "//wsl$"
        || lower == "//wsl$/"
}

#[cfg(windows)]
fn wsl_unc_to_linux_path(distro: &str, path: &str) -> Result<Option<String>, String> {
    let normalized = path.trim().replace('\\', "/");
    let Some(rest) = strip_wsl_unc_prefix(&normalized) else {
        if is_incomplete_wsl_unc_path(&normalized) {
            return Err(format!("WSL UNC path must include a distro name: {path}"));
        }
        return Ok(None);
    };
    let mut parts = rest.splitn(2, '/');
    let selected_distro = parts.next().unwrap_or("");
    if selected_distro.is_empty() {
        return Err(format!("WSL UNC path must include a distro name: {path}"));
    }
    if !selected_distro.eq_ignore_ascii_case(distro) {
        return Err(format!(
            "selected WSL path belongs to distro {selected_distro}, but current WSL workspace is {distro}"
        ));
    }
    let suffix = parts.next().unwrap_or("");
    let linux = if suffix.is_empty() {
        "/".to_string()
    } else {
        format!("/{suffix}")
    };
    Ok(Some(normalize_wsl_absolute_path(&linux)))
}

#[cfg(windows)]
pub(super) fn normalize_wsl_workspace_request_path(distro: &str, path: &str) -> Result<String, String> {
    validate_wsl_distro_name(distro)?;
    if let Some(linux_path) = wsl_unc_to_linux_path(distro, path)? {
        return Ok(linux_path);
    }
    let normalized = normalize_wsl_absolute_path(path);
    if !normalized.starts_with('/') || normalized.starts_with("//") {
        return Err(format!(
            "expected an absolute WSL path for {distro}, got {path}"
        ));
    }
    Ok(normalized)
}

#[cfg(windows)]
fn wsl_drvfs_to_windows(path: &str) -> Option<PathBuf> {
    let normalized = path.replace('\\', "/");
    let rest = normalized.strip_prefix("/mnt/")?;
    let mut parts = rest.splitn(2, '/');
    let drive = parts.next()?;
    if drive.len() != 1 {
        return None;
    }
    let drive = drive.chars().next()?;
    if !drive.is_ascii_alphabetic() {
        return None;
    }
    let suffix = parts.next().unwrap_or("").replace('/', "\\");
    let mut host = format!("{}:\\", drive.to_ascii_uppercase());
    if !suffix.is_empty() {
        host.push_str(&suffix);
    }
    Some(PathBuf::from(host))
}

#[cfg(windows)]
pub fn wsl_path_to_unc(distro: &str, path: &str) -> PathBuf {
    // Defense-in-depth: refuse to construct a UNC path with a distro name that
    // could escape the WSL share root via `..`, `\`, or other path metachars.
    // Returns a clearly-invalid path that downstream `is_dir()`/`metadata()`
    // checks will reject. The webview's distro list comes from `wsl.exe --list`
    // and is normally trustworthy, but a locally-registered malicious distro
    // can name itself with traversal characters; this filter blocks that.
    if !is_safe_distro_name(distro) {
        return PathBuf::from(r"\\wsl.localhost\__nexterm_invalid_distro__");
    }
    let normalized = path.replace('\\', "/");
    let trimmed = normalized.trim_start_matches('/');
    let primary = PathBuf::from(format!(
        r"\\wsl.localhost\{}\{}",
        distro,
        trimmed.replace('/', r"\")
    ));
    if primary.exists() {
        return primary;
    }
    PathBuf::from(format!(r"\\wsl$\{}\{}", distro, trimmed.replace('/', r"\")))
}

#[cfg(windows)]
pub fn wsl_path_to_host(distro: &str, path: &str) -> PathBuf {
    // `/mnt/<drive>` is drvfs-backed Windows storage. Accessing it through the
    // WSL UNC share can return "Access is denied" on Windows even though the
    // same path is readable inside WSL. Use the native drive path instead.
    wsl_drvfs_to_windows(path).unwrap_or_else(|| wsl_path_to_unc(distro, path))
}

#[cfg(windows)]
pub fn decode_command_output(bytes: &[u8]) -> String {
    if bytes.starts_with(&[0xff, 0xfe]) || looks_utf16le(bytes) {
        let start = if bytes.starts_with(&[0xff, 0xfe]) {
            2
        } else {
            0
        };
        let units: Vec<u16> = bytes[start..]
            .as_chunks::<2>()
            .0
            .iter()
            .map(|c| u16::from_le_bytes(*c))
            .collect();
        String::from_utf16_lossy(&units)
    } else {
        String::from_utf8_lossy(bytes).into_owned()
    }
}

#[cfg(windows)]
fn looks_utf16le(bytes: &[u8]) -> bool {
    if bytes.len() < 4 || !bytes.len().is_multiple_of(2) {
        return false;
    }
    let nul_odd = bytes.iter().skip(1).step_by(2).filter(|b| **b == 0).count();
    nul_odd * 2 >= bytes.len() / 2
}

#[cfg(windows)]
fn run_wsl(args: &[&str]) -> Result<String, String> {
    let mut cmd = std::process::Command::new("wsl.exe");
    cmd.args(args);
    suppress_command_window(&mut cmd);
    let out = cmd
        .output()
        .map_err(|error| wsl_spawn_error("wsl.exe", error))?;
    if !out.status.success() {
        let stderr = decode_command_output(&out.stderr);
        return Err(stderr.trim().to_string());
    }
    Ok(decode_command_output(&out.stdout))
}

#[cfg(windows)]
pub(crate) fn wsl_exec_capture(
    distro: &str,
    program: &str,
    args: &[&str],
) -> Result<String, String> {
    validate_wsl_distro_name(distro)?;
    let mut cmd = std::process::Command::new("wsl.exe");
    cmd.arg("-d")
        .arg(distro)
        .arg("--exec")
        .arg(program)
        .args(args);
    suppress_command_window(&mut cmd);
    let out = cmd
        .output()
        .map_err(|error| wsl_spawn_error("wsl.exe", error))?;
    if !out.status.success() {
        let stderr = decode_command_output(&out.stderr);
        return Err(stderr.trim().to_string());
    }
    Ok(decode_command_output(&out.stdout))
}

#[cfg(windows)]
pub(super) fn run_wsl_sh(distro: &str, script: &str) -> Result<String, String> {
    // Probe helpers must avoid login-shell startup files. User `.profile`
    // output on stdout would corrupt the parsed value (`$HOME`, login shell).
    wsl_exec_capture(distro, "sh", &["-c", script])
}

#[cfg(windows)]
pub(crate) fn normalize_wsl_value(output: String, fallback: &str) -> String {
    let value = output
        .lines()
        .rev()
        .map(str::trim)
        .find(|line| !line.is_empty())
        .unwrap_or("");
    if value.is_empty() {
        fallback.to_string()
    } else {
        value.to_string()
    }
}

#[cfg(windows)]
pub(super) fn list_distros_blocking() -> Result<Vec<WslDistro>, String> {
    let out = run_wsl(&["--list", "--verbose"])?;
    let mut distros = Vec::new();
    for raw in out.lines().skip(1) {
        let line = raw.trim();
        if line.is_empty() {
            continue;
        }
        let default = line.starts_with('*');
        let line = line.trim_start_matches('*').trim();
        let parts: Vec<&str> = line.split_whitespace().collect();
        if parts.len() < 3 {
            continue;
        }
        let state_idx = parts.len() - 2;
        let name = parts[..state_idx].join(" ");
        let state = parts[state_idx];
        distros.push(WslDistro {
            name,
            default,
            running: state.eq_ignore_ascii_case("Running"),
        });
    }
    Ok(distros)
}

#[cfg(all(test, windows))]
mod tests {
    use super::*;

    #[test]
    fn distro_validator_accepts_real_names() {
        assert!(is_safe_distro_name("Ubuntu"));
        assert!(is_safe_distro_name("Ubuntu-22.04"));
        assert!(is_safe_distro_name("Debian"));
        assert!(is_safe_distro_name("Alpine_3.18"));
        assert!(is_safe_distro_name("openSUSE-Tumbleweed"));
    }

    #[test]
    fn distro_validator_rejects_path_traversal() {
        assert!(!is_safe_distro_name(".."));
        assert!(!is_safe_distro_name("..\\..\\Windows"));
        assert!(!is_safe_distro_name("../foo"));
        assert!(!is_safe_distro_name("foo/bar"));
        assert!(!is_safe_distro_name("foo\\bar"));
        assert!(!is_safe_distro_name("foo..bar"));
    }

    #[test]
    fn distro_validator_rejects_special_chars() {
        assert!(!is_safe_distro_name("foo:bar"));
        assert!(!is_safe_distro_name("foo?bar"));
        assert!(!is_safe_distro_name("foo*bar"));
        assert!(!is_safe_distro_name("foo\0bar"));
        assert!(!is_safe_distro_name(""));
        assert!(!is_safe_distro_name(".hidden"));
    }

    #[test]
    fn wsl_path_to_unc_blocks_traversal_distro() {
        // Malicious distro name must produce a path that is_dir() will reject,
        // never escape the WSL share root.
        let p = wsl_path_to_unc("..\\..\\..\\Windows", "/etc/passwd");
        let s = p.to_string_lossy();
        assert!(s.contains("__nexterm_invalid_distro__"), "got: {s}");
        assert!(!s.contains("\\..\\"), "got: {s}");
    }

    #[test]
    fn wsl_path_to_unc_accepts_valid_distro() {
        let p = wsl_path_to_unc("Ubuntu", "/etc/hosts");
        let s = p.to_string_lossy();
        assert!(!s.contains("__nexterm_invalid_distro__"), "got: {s}");
    }

    #[test]
    fn resolve_path_keeps_local_paths_unchanged() {
        let path = r"C:\Users\vinicios\repo";
        assert_eq!(
            resolve_path(path, &WorkspaceEnv::Local),
            PathBuf::from(path)
        );
    }

    #[test]
    fn resolve_path_maps_wsl_paths_to_host() {
        let workspace = WorkspaceEnv::Wsl {
            distro: "Ubuntu".into(),
        };
        assert_eq!(
            resolve_path("/home/vinicios/repo", &workspace),
            wsl_path_to_host("Ubuntu", "/home/vinicios/repo")
        );
    }

    #[test]
    fn wsl_drvfs_root_maps_to_windows_drive() {
        assert_eq!(wsl_drvfs_to_windows("/mnt/c"), Some(PathBuf::from(r"C:\")));
    }

    #[test]
    fn wsl_drvfs_child_maps_to_windows_drive() {
        assert_eq!(
            wsl_drvfs_to_windows("/mnt/d/Users/vinicios/repo"),
            Some(PathBuf::from(r"D:\Users\vinicios\repo"))
        );
    }

    #[test]
    fn wsl_drvfs_rejects_non_drive_mounts() {
        assert_eq!(wsl_drvfs_to_windows("/mnt/wsl"), None);
        assert_eq!(wsl_drvfs_to_windows("/home/vinicios"), None);
    }

    #[test]
    fn wsl_workspace_request_keeps_linux_path_for_client_state() {
        assert_eq!(
            normalize_wsl_workspace_request_path("Ubuntu", "/home/vinicios/repo").unwrap(),
            "/home/vinicios/repo"
        );
    }

    #[test]
    fn wsl_workspace_request_converts_localhost_unc_to_linux_path() {
        assert_eq!(
            normalize_wsl_workspace_request_path(
                "Ubuntu",
                r"\\wsl.localhost\Ubuntu\home\vinicios\repo"
            )
            .unwrap(),
            "/home/vinicios/repo"
        );
    }

    #[test]
    fn wsl_workspace_request_converts_legacy_unc_to_linux_path() {
        assert_eq!(
            normalize_wsl_workspace_request_path("Ubuntu", r"\\wsl$\Ubuntu\home\vinicios").unwrap(),
            "/home/vinicios"
        );
    }

    #[test]
    fn wsl_workspace_request_rejects_other_distro_unc() {
        let err =
            normalize_wsl_workspace_request_path("Ubuntu", r"\\wsl.localhost\Debian\home\vinicios")
                .expect_err("cross-distro UNC must be rejected");

        assert!(err.contains("Debian"), "got: {err}");
        assert!(err.contains("Ubuntu"), "got: {err}");
    }

    #[test]
    fn wsl_workspace_request_rejects_windows_drive_path() {
        let err = normalize_wsl_workspace_request_path("Ubuntu", r"D:\repo")
            .expect_err("Windows drive paths are not valid WSL workspace roots");

        assert!(err.contains("absolute WSL path"), "got: {err}");
    }

    #[test]
    fn wsl_workspace_request_rejects_non_wsl_unc_path() {
        let err = normalize_wsl_workspace_request_path("Ubuntu", r"\\server\share\repo")
            .expect_err("non-WSL UNC paths are not valid WSL workspace roots");

        assert!(err.contains("absolute WSL path"), "got: {err}");
    }

    #[test]
    fn normalize_wsl_value_uses_last_nonempty_line() {
        assert_eq!(
            normalize_wsl_value("banner\n  /bin/zsh \n".into(), "/bin/sh"),
            "/bin/zsh"
        );
    }

    #[test]
    fn normalize_wsl_value_falls_back_when_empty() {
        assert_eq!(normalize_wsl_value(" \n".into(), "/bin/sh"), "/bin/sh");
    }
}
