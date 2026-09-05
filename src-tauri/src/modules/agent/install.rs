//! nexterm-agent 的安装与资产解析。
//!
//! 与 wsl-watcher-helper 同一套模式:Linux 二进制在构建期以 musl 静态编译,
//! 通过 build.rs 探测后 `include_bytes!` 内嵌;运行期经
//! `wsl.exe sh -c 'mkdir && cat > && chmod'` 管道写入发行版的用户缓存目录。
//! 资产不存在时(开发机未构建)agent 直接判定不可用,调用方走 legacy 路径。

use std::sync::{Mutex, OnceLock};

/// 与主程序同版本发布;安装路径携带版本号,升级后旧版本二进制自然失效。
const AGENT_VERSION: &str = env!("CARGO_PKG_VERSION");

/// 两次构建间缓存 wsl_home,省掉每次 spawn 前的 `wsl.exe` 探测。
fn home_cache() -> &'static Mutex<std::collections::HashMap<String, String>> {
    static CACHE: OnceLock<Mutex<std::collections::HashMap<String, String>>> = OnceLock::new();
    CACHE.get_or_init(|| Mutex::new(std::collections::HashMap::new()))
}

/// 二进制资产字节(SSH 推送安装与嵌入共用的解析点)。
pub(crate) fn agent_version() -> &'static str {
    AGENT_VERSION
}

/// 进程内测试(cargo test)默认禁用 agent:避免测试期间真的往 WSL 里
/// 安装/拉起进程。显式设置 `NEXTERM_AGENT_E2E=1` 可重新启用 —— 供
/// `#[ignore]` 级别的端到端测试(`cargo test -- --ignored`)使用。
pub(crate) fn asset_available() -> bool {
    if cfg!(test) {
        return std::env::var("NEXTERM_AGENT_E2E").as_deref() == Ok("1") && asset_bytes().is_ok();
    }
    asset_bytes().is_ok()
}

pub(crate) fn asset_bytes() -> Result<Vec<u8>, String> {
    #[cfg(nexterm_agent_asset)]
    {
        Ok(include_bytes!(env!("NEXTERM_AGENT_ASSET")).to_vec())
    }

    #[cfg(not(nexterm_agent_asset))]
    {
        let path = std::env::var("NEXTERM_AGENT").map_err(|_| {
            "nexterm-agent asset is not bundled (build nexterm-agent for \
             x86_64-unknown-linux-musl to embed it)"
                .to_string()
        })?;
        std::fs::read(&path).map_err(|error| format!("read NEXTERM_AGENT asset {path}: {error}"))
    }
}

/// 确保当前版本二进制已写入发行版,返回 Linux 侧绝对路径。
pub(crate) fn ensure_agent_installed(distro: &str) -> Result<String, String> {
    crate::modules::workspace::validate_wsl_distro_name(distro)?;
    let arch = match std::env::consts::ARCH {
        "x86_64" => "x86_64",
        other => {
            return Err(format!(
                "nexterm-agent is not bundled for host architecture {other}"
            ))
        }
    };
    let bytes = asset_bytes()?;
    let home = cached_wsl_home(distro)?;
    let linux_path = agent_install_path(&home, arch);
    let unc_path = crate::modules::workspace::wsl_path_to_unc(distro, &linux_path);
    let needs_write = match std::fs::metadata(&unc_path) {
        // 大小不一致说明上一次写入被中断,重写覆盖。
        Ok(meta) => meta.len() != bytes.len() as u64,
        Err(_) => true,
    };
    if needs_write {
        write_bytes_to_wsl(distro, &linux_path, &bytes)?;
    }
    Ok(linux_path)
}

fn cached_wsl_home(distro: &str) -> Result<String, String> {
    if let Ok(cache) = home_cache().lock() {
        if let Some(home) = cache.get(distro) {
            return Ok(home.clone());
        }
    }
    let home = crate::modules::workspace::wsl_home(distro.to_string())?;
    if let Ok(mut cache) = home_cache().lock() {
        cache.insert(distro.to_string(), home.clone());
    }
    Ok(home)
}

fn agent_install_path(home: &str, arch: &str) -> String {
    format!(
        "{}/.cache/nexterm/agent/nexterm-agent-{AGENT_VERSION}-{arch}",
        home.trim_end_matches('/')
    )
}

fn write_bytes_to_wsl(distro: &str, target_path: &str, bytes: &[u8]) -> Result<(), String> {
    use std::io::Write;
    use std::process::{Command, Stdio};

    let mut command = Command::new("wsl.exe");
    command
        .arg("-d")
        .arg(distro)
        .arg("--exec")
        .arg("sh")
        .arg("-c")
        .arg("mkdir -p \"$(dirname \"$1\")\" && cat > \"$1\" && chmod 755 \"$1\"")
        .arg("sh")
        .arg(target_path)
        .stdin(Stdio::piped())
        .stdout(Stdio::null())
        .stderr(Stdio::piped());
    crate::modules::process::suppress_command_window(&mut command);
    let mut child = command.spawn().map_err(|error| error.to_string())?;
    {
        let stdin = child
            .stdin
            .as_mut()
            .ok_or_else(|| "failed to open agent installer stdin".to_string())?;
        stdin.write_all(bytes).map_err(|error| error.to_string())?;
    }
    let output = child.wait_with_output().map_err(|error| error.to_string())?;
    if output.status.success() {
        Ok(())
    } else {
        Err(
            crate::modules::workspace::decode_command_output(&output.stderr)
                .trim()
                .to_string(),
        )
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn install_path_pins_version_and_arch() {
        assert_eq!(
            agent_install_path("/home/dev/", "x86_64"),
            format!("/home/dev/.cache/nexterm/agent/nexterm-agent-{AGENT_VERSION}-x86_64")
        );
    }

    #[test]
    fn asset_is_unavailable_under_test() {
        // 契约:测试进程内 agent 默认不可用(无论是否内置了 musl 资产),
        // 保证测试不往真实 WSL 里安装/拉起进程;E2E 逃生口仅显式 env 生效。
        std::env::remove_var("NEXTERM_AGENT_E2E");
        assert!(!asset_available());
    }

    #[test]
    fn cached_home_second_read_hits_cache() {
        // 直接操作缓存,验证缓存读写路径;不发 wsl.exe 调用。
        if let Ok(mut cache) = home_cache().lock() {
            cache.insert("TestDistro".to_string(), "/home/cached".to_string());
        }
        assert_eq!(cached_wsl_home("TestDistro").expect("cached"), "/home/cached");
        if let Ok(mut cache) = home_cache().lock() {
            cache.remove("TestDistro");
        }
    }
}
