//! 本机文件系统根枚举。
//!
//! 应用内文件选择器（picker 模块）在本机环境下的"盘符 / 根目录"快捷入口
//! 数据源。Windows 用 `GetLogicalDriveStringsW` 枚举盘符；其他平台只有一个
//! POSIX 根。

/// 返回本机可用的文件系统根，webview 内统一为 "/" 分隔的规范化形态：
/// - Windows: `["C:/", "D:/", ...]`
/// - 其他平台: `["/"]`
pub fn list_roots() -> Vec<String> {
    #[cfg(windows)]
    {
        // 512 个 u16 足够容纳 26 个盘符（每项 "C:\" + 结束符共 4 个 char）。
        let mut buffer = [0u16; 512];
        let len = unsafe {
            windows_sys::Win32::Storage::FileSystem::GetLogicalDriveStringsW(
                buffer.len() as u32,
                buffer.as_mut_ptr(),
            )
        };
        if len == 0 || len as usize >= buffer.len() {
            return Vec::new();
        }
        parse_drive_strings(&String::from_utf16_lossy(&buffer[..len as usize]))
    }
    #[cfg(not(windows))]
    {
        vec!["/".to_string()]
    }
}

/// 把 `GetLogicalDriveStringsW` 的 `C:\0D:\0\0` 形态解析为 `["C:/", "D:/"]`。
#[cfg(windows)]
fn parse_drive_strings(raw: &str) -> Vec<String> {
    raw.split('\0')
        .filter(|drive| !drive.is_empty())
        .map(|drive| format!("{}/", drive.trim_end_matches('\\')))
        .collect()
}

#[cfg(all(test, windows))]
mod tests {
    use super::*;

    #[test]
    fn parse_drive_strings_splits_and_normalizes() {
        assert_eq!(
            parse_drive_strings("C:\\\0D:\\\0E:\\\0"),
            vec!["C:/".to_string(), "D:/".to_string(), "E:/".to_string()]
        );
        assert!(parse_drive_strings("").is_empty());
        assert_eq!(parse_drive_strings("\0\0"), Vec::<String>::new());
    }

    #[test]
    fn list_roots_returns_at_least_one_root() {
        // 有真实文件系统的机器上至少存在一个可用根。
        assert!(!list_roots().is_empty());
        for root in list_roots() {
            assert!(root.ends_with('/') && root.len() >= 2, "got: {root}");
        }
    }
}

#[cfg(all(test, not(windows)))]
mod unix_tests {
    use super::*;

    #[test]
    fn list_roots_returns_posix_root() {
        assert_eq!(list_roots(), vec!["/".to_string()]);
    }
}
