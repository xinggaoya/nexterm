pub mod agent;
/// CrabNebula DevTools 集成：只在编译了 `crabnebula-devtools` feature 时存在。
///
/// 该 feature 默认关闭 —— 它会连带启用 `tauri/tracing`，进而让
/// `tauri-runtime-wry` 的 `eval_script` 变成阻塞式 UI 线程往返，
/// 与 IPC handler 互锁成永久死锁。详见 `docs/architecture/06-crabnebula-devtools.md`。
#[cfg(feature = "crabnebula-devtools")]
pub(crate) mod devtools;
pub mod fs;
pub mod git;
pub(crate) mod lock;
pub mod lsp;
pub(crate) mod process;
pub mod pty;
pub mod shell;
pub mod ssh;
pub mod workspace;
