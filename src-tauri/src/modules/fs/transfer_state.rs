//! 搬运进度与取消的宿主侧状态。
//!
//! 前端给每次搬运分配一个 `operation_id`，用它订阅进度事件、也用它发起取消。
//! 后端把取消请求记在共享的 `AtomicBool` 上，fs-core 的进度回调每次都读它
//! —— 因此取消是**协作式**的：正在复制的文件会在下一个 256KiB 分块处停下，
//! 而不是被线程杀掉（杀线程会留下半个文件，且 Job Object 之外的清理很难做）。
//!
//! 为什么不放在 fs-core 里：它不该依赖 Tauri 的 AppHandle / 事件总线。共享
//! crate 只提供"回调返回 Err 即中止"的机制，事件与状态由宿主这一层负责。

use std::collections::HashMap;
use std::sync::atomic::{AtomicBool, Ordering};
use std::sync::{Arc, Mutex};

use serde::Serialize;
use tauri::{AppHandle, Emitter};

use nexterm_fs_core::TransferProgress;

/// 搬运进度事件名。前端 `native.onFsTransferProgress` 订阅。
pub const FS_TRANSFER_PROGRESS_EVENT: &str = "nexterm://fs-transfer-progress";

/// 发给前端的进度载荷。`operation_id` 让前端能把事件对应到具体一次搬运
/// （多选拖拽、并发粘贴、窗口内多个工作区都可能同时有搬运在跑）。
#[derive(Debug, Clone, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct FsTransferProgressEvent {
    pub operation_id: u64,
    #[serde(flatten)]
    pub progress: TransferProgress,
}

/// 一次搬运的取消标志。
#[derive(Clone, Default)]
pub struct TransferCancellation {
    flag: Arc<AtomicBool>,
}

impl TransferCancellation {
    pub fn new() -> Self {
        Self::default()
    }

    pub fn cancel(&self) {
        self.flag.store(true, Ordering::SeqCst);
    }

    pub fn is_cancelled(&self) -> bool {
        self.flag.load(Ordering::SeqCst)
    }
}

/// 进行中的搬运：`operation_id` → 取消标志。
#[derive(Default)]
pub struct FsTransferState {
    inflight: Mutex<HashMap<u64, TransferCancellation>>,
}

impl FsTransferState {
    /// 登记一次搬运，返回它的取消句柄。
    pub fn begin(&self, operation_id: Option<u64>) -> TransferCancellation {
        let cancellation = TransferCancellation::new();
        if let Some(id) = operation_id {
            if let Ok(mut map) = self.inflight.lock() {
                map.insert(id, cancellation.clone());
            }
        }
        cancellation
    }

    /// 搬运结束（无论成功 / 失败 / 取消）后清理登记。
    pub fn finish(&self, operation_id: Option<u64>) {
        let Some(id) = operation_id else { return };
        if let Ok(mut map) = self.inflight.lock() {
            map.remove(&id);
        }
    }

    /// 请求取消。返回 false 表示这个 operation 不存在（已完成或从未开始）。
    pub fn cancel(&self, operation_id: u64) -> bool {
        self.inflight
            .lock()
            .ok()
            .and_then(|map| map.get(&operation_id).cloned())
            .map(|c| {
                c.cancel();
                true
            })
            .unwrap_or(false)
    }

    /// 是否仍在进行中（前端用它决定要不要展示"搬运中"的 UI）。
    pub fn is_active(&self, operation_id: u64) -> bool {
        self.inflight
            .lock()
            .map(|map| map.contains_key(&operation_id))
            .unwrap_or(false)
    }
}

/// 发进度事件。失败只记日志：进度丢失不该让搬运本身失败。
pub fn emit_progress(app: &AppHandle, operation_id: u64, progress: TransferProgress) {
    if let Err(error) = app.emit(
        FS_TRANSFER_PROGRESS_EVENT,
        FsTransferProgressEvent {
            operation_id,
            progress,
        },
    ) {
        log::debug!("fs transfer progress emit failed: {error}");
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn cancellation_flag_round_trips() {
        let cancellation = TransferCancellation::new();
        assert!(!cancellation.is_cancelled());
        cancellation.cancel();
        assert!(cancellation.is_cancelled());
    }

    #[test]
    fn state_tracks_inflight_operations() {
        let state = FsTransferState::default();
        assert!(!state.is_active(7));
        let cancellation = state.begin(Some(7));
        assert!(state.is_active(7));
        assert!(!state.cancel(999), "未知的 operation 不该被当成取消成功");
        assert!(state.cancel(7));
        assert!(cancellation.is_cancelled());
        state.finish(Some(7));
        assert!(!state.is_active(7));
    }

    #[test]
    fn begin_without_id_still_yields_a_usable_handle() {
        let state = FsTransferState::default();
        let cancellation = state.begin(None);
        cancellation.cancel();
        assert!(cancellation.is_cancelled());
        // 无 id 的搬运不需要登记，finish 也不该 panic
        state.finish(None);
    }
}
