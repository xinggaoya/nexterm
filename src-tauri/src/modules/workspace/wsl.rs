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
#[cfg(windows)]
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
pub(super) fn normalize_wsl_workspace_request_path(
    distro: &str,
    path: &str,
) -> Result<String, String> {
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

/// 把客户端给的路径还原成 **Linux 侧**的路径。
///
/// WSL 工作区的 fs 命令最终由 `wsl.exe` / WSL agent 执行，那两边只认 Linux
/// 路径。宿主侧的 UNC 形式（`\\wsl.localhost\Ubuntu\home\...`）在 Linux 里
/// 根本不存在，直接传过去必然 `not a directory`。
///
/// 非 Windows 平台没有 WSL，原样返回。
pub(crate) fn wsl_client_path(workspace: &WorkspaceEnv, raw: &str) -> String {
    #[cfg(windows)]
    {
        if let WorkspaceEnv::Wsl { distro } = workspace {
            if let Ok(Some(linux)) = wsl_unc_to_linux_path(distro, raw) {
                return linux;
            }
            return normalize_wsl_absolute_path(raw);
        }
        raw.to_string()
    }
    #[cfg(not(windows))]
    {
        let _ = workspace;
        raw.to_string()
    }
}

/// 解码子进程输出（stdout / stderr）。
///
/// `wsl.exe` 的输出是 UTF-16LE，**且常常多一个尾字节**。早期实现在判定
/// UTF-16LE 之前先要求「长度为偶数」，于是整个 stderr 退回 UTF-8 解码 ——
/// 界面上看到的就是一串带 NUL 的乱码（`w s l :  本地主机 ...`）。
#[cfg(windows)]
pub fn decode_command_output(bytes: &[u8]) -> String {
    let text = if bytes.starts_with(&[0xff, 0xfe]) {
        decode_utf16le(&bytes[2..])
    } else if looks_utf16le(bytes) {
        decode_utf16le(bytes)
    } else {
        String::from_utf8_lossy(bytes).into_owned()
    };
    strip_control_chars(&text)
}

#[cfg(windows)]
fn decode_utf16le(bytes: &[u8]) -> String {
    let units: Vec<u16> = bytes
        .as_chunks::<2>()
        .0
        .iter()
        .map(|c| u16::from_le_bytes(*c))
        .collect();
    String::from_utf16_lossy(&units)
}

/// 去掉控制字符。
///
/// 子进程 stderr 里混进来的二进制噪声会以 NUL 呈现；直接塞进错误消息，
/// 界面上就是一串乱码方块。保留 `\n` / `\t`，多行错误仍然可读。
#[cfg(windows)]
fn strip_control_chars(text: &str) -> String {
    text.chars()
        .filter(|c| !c.is_control() || *c == '\n' || *c == '\t')
        .collect()
}

#[cfg(windows)]
fn looks_utf16le(bytes: &[u8]) -> bool {
    if bytes.len() < 4 {
        return false;
    }
    // UTF-16LE 的 ASCII 区段：高字节（奇数位）几乎全是 0。
    // 不用「长度必须是偶数」做前提：wsl.exe 的横幅常带一个多余的尾字节。
    let nul_odd = bytes.iter().skip(1).step_by(2).filter(|b| **b == 0).count();
    nul_odd * 4 >= bytes.len()
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
    fn wsl_client_path_returns_linux_paths_for_wsl_workspaces() {
        let wsl = WorkspaceEnv::Wsl {
            distro: "Ubuntu".to_string(),
        };
        // 已经是 Linux 路径 → 原样（规范化后）返回。
        assert_eq!(
            wsl_client_path(&wsl, "/home/vinicios/repo"),
            "/home/vinicios/repo"
        );
        // 宿主侧的 UNC 形式 → 还原成 Linux 路径。fs 命令最终由 wsl.exe /
        // WSL agent 执行，那两边只认 Linux 路径。
        assert_eq!(
            wsl_client_path(&wsl, r"\\wsl.localhost\Ubuntu\home\vinicios\repo"),
            "/home/vinicios/repo"
        );
        assert_eq!(
            wsl_client_path(&wsl, "//wsl.localhost/Ubuntu/home/vinicios/repo"),
            "/home/vinicios/repo"
        );
        // 非 WSL 工作区：原样返回。
        assert_eq!(
            wsl_client_path(&WorkspaceEnv::Local, r"C:\repo"),
            r"C:\repo"
        );
    }

    #[test]
    fn decode_command_output_reads_utf16le_without_even_length_requirement() {
        // wsl.exe 的输出是 UTF-16LE，且常带一个多余的尾字节。旧实现要求
        // 「长度为偶数」才按 UTF-16LE 解码，于是整段退回 UTF-8，错误消息
        // 里就是一串带 NUL 的乱码。
        let mut bytes: Vec<u8> = "wsl: localhost"
            .encode_utf16()
            .flat_map(|u| u.to_le_bytes())
            .collect();
        bytes.push(0x41); // 奇数长度
        let decoded = decode_command_output(&bytes);
        assert!(decoded.starts_with("wsl: localhost"), "got: {decoded}");
        assert!(!decoded.contains('\0'), "got: {decoded:?}");
    }

    #[test]
    fn decode_command_output_strips_control_characters() {
        // 二进制噪声里的 NUL 不该出现在面向用户的错误消息里。
        let decoded = decode_command_output(b"boom\0\0\x01 failed");
        assert_eq!(decoded, "boom failed");
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
