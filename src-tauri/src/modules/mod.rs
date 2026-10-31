pub mod agent;
/// CrabNebula DevTools 集成：只在 debug 构建编译（release 不注册插桩插件）。
#[cfg(debug_assertions)]
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
