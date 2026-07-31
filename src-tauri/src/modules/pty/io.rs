use std::io::Write;

use portable_pty::PtySize;

use super::PtyState;
use crate::modules::lock::{mutex_lock, rwlock_read};

/// PTY resize 允许的最小列数。低于此值会拒绝 resize：FitAddon 在容器尚未
/// 完成布局（如非活动 workspace 刚切回）时可能算出 cols=2（其 MINIMUM_COLS），
/// 把 2x1 resize 透传到 shell 会触发 SIGWINCH 风暴，WSL 下 zsh 插件
/// （syntax-highlighting / autosuggestions）在极小列宽下重算高亮/补全会
/// 崩溃（double free or corruption / free(): invalid size）。4 是安全的最小
/// 可读宽度。
pub const MIN_RESIZE_COLS: u16 = 4;
/// PTY resize 允许的最小行数。
pub const MIN_RESIZE_ROWS: u16 = 1;

/// 校验 resize 维度。纯函数，便于对边界行为做契约测试。
fn validate_resize_dims(cols: u16, rows: u16) -> Result<(), String> {
    if cols < MIN_RESIZE_COLS || rows < MIN_RESIZE_ROWS {
        return Err(format!(
            "pty resize rejected: dims {cols}x{rows} below minimum {}x{} \
             (likely a not-yet-laid-out container); ignoring to avoid SIGWINCH storm",
            MIN_RESIZE_COLS, MIN_RESIZE_ROWS
        ));
    }
    Ok(())
}

impl PtyState {
    pub fn write_session(&self, id: u32, data: &str) -> Result<(), String> {
        let session = rwlock_read(&self.sessions, "pty sessions")?
            .get(&id)
            .cloned()
            .ok_or_else(|| format!("unknown pty session: {id}"))?;
        let result = mutex_lock(&session.writer, "pty writer")?
            .write_all(data.as_bytes())
            .map_err(|e| e.to_string());
        result
    }

    pub fn resize_session(&self, id: u32, cols: u16, rows: u16) -> Result<(), String> {
        validate_resize_dims(cols, rows).inspect_err(|e| {
            log::warn!("pty_resize id={id}: {e}");
        })?;
        let session = rwlock_read(&self.sessions, "pty sessions")?
            .get(&id)
            .cloned()
            .ok_or_else(|| format!("unknown pty session: {id}"))?;
        let result = mutex_lock(&session.master, "pty master")?
            .resize(PtySize {
                rows,
                cols,
                pixel_width: 0,
                pixel_height: 0,
            })
            .map_err(|e| e.to_string());
        result
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn accepts_minimum_valid_dims() {
        assert!(validate_resize_dims(MIN_RESIZE_COLS, MIN_RESIZE_ROWS).is_ok());
        assert!(validate_resize_dims(80, 24).is_ok());
    }

    #[test]
    fn rejects_sub_minimal_cols() {
        // FitAddon 的 MINIMUM_COLS=2 会在容器未布局时出现 —— 必须被拒，
        // 否则 shell 收到 SIGWINCH 后在极小列宽下崩溃
        // （double free or corruption / free(): invalid size）。
        let err = validate_resize_dims(2, 24).unwrap_err();
        assert!(err.contains("below minimum"), "got: {err}");
    }

    #[test]
    fn rejects_zero_rows() {
        let err = validate_resize_dims(80, 0).unwrap_err();
        assert!(err.contains("below minimum"), "got: {err}");
    }

    #[test]
    fn rejects_dims_far_below_minimum() {
        assert!(validate_resize_dims(1, 0).is_err());
        assert!(validate_resize_dims(0, 0).is_err());
    }
}
