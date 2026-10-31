//! CrabNebula DevTools 集成（仅 debug 构建注册插件）。
//!
//! 组成：
//! - `tauri-plugin-devtools`：后端插桩，把 Tauri IPC 调用、事件、`log::` 记录
//!   暴露给本机插桩服务（默认 `127.0.0.1:3033`）。
//! - `tauri-plugin-devtools-app`：嵌入式 DevTools UI（应用内抽屉），需要本机
//!   安装 CrabNebula DevTools 桌面端。
//!
//! ## 为什么需要日志桥接
//!
//! `tauri-plugin-devtools` 初始化时会安装全局 tracing subscriber，并通过
//! `tracing-log` 的 `LogTracer` **抢占全局 `log` logger**；而
//! `tauri-plugin-log` 的 setup 也要 `log::set_boxed_logger` 抢占同一个槽位。
//! 全局 logger 只能有一个，二者直接共存会让 debug 构建启动失败。
//!
//! 本项目的约定：
//! 1. devtools 先初始化，拿到全局 `log` logger —— backend 的 `log::` 记录被转成
//!    tracing event，既进入 DevTools UI，也经 `attach_logger` 桥接回 stdout / 日志文件；
//! 2. debug 构建下 `tauri-plugin-log` 使用 `skip_logger()`，放弃全局 logger 槽位，
//!    只保留 `plugin:log|log` 命令（前端日志经 `log::logger()` 依然能进 tracing）；
//! 3. release 构建不注册 devtools，`tauri-plugin-log` 保持原样（自带 stdout + 日志文件）。

use std::path::PathBuf;

use tauri::{plugin::TauriPlugin, Runtime};
// `fern` 由 tauri-plugin-log 重新导出，避免重复引入依赖。
use tauri_plugin_log::fern;

/// 日志文件名（与 `tauri-plugin-log` 保持一致：包名 + `.log`）。
const LOG_FILE_NAME: &str = concat!(env!("CARGO_PKG_NAME"), ".log");

/// devtools 插件 + 嵌入式 UI 插件。
pub(crate) struct DevtoolsPlugins<R: Runtime> {
    /// 后端插桩插件。
    pub(crate) devtools: TauriPlugin<R>,
    /// 嵌入式 DevTools UI 插件。
    pub(crate) devtools_app: TauriPlugin<R>,
}

/// 初始化 devtools 插件。**必须在 `tauri::Builder` 之前调用**：
/// 它会安装全局 tracing subscriber 与全局 `log` logger，越早安装能捕获到的
/// 启动期事件越多。
pub(crate) fn init<R: Runtime>(identifier: &str) -> DevtoolsPlugins<R> {
    let mut builder = tauri_plugin_devtools::Builder::default();
    // 把 tracing event（包含由 `log::` 记录转换而来的）再写回 stdout / 日志文件。
    builder.attach_logger(log_bridge(identifier));
    DevtoolsPlugins {
        devtools: builder.init(),
        devtools_app: tauri_plugin_devtools_app::init(),
    }
}

/// 构建桥接 logger：stdout + app 日志目录文件。
///
/// debug 构建下 `tauri-plugin-log` 让出全局 logger 槽位，输出改由这里承接，
/// 保持 "终端可见 + 落盘" 的行为与 release 一致。
fn log_bridge(identifier: &str) -> Box<dyn log::Log> {
    let format =
        time::macros::format_description!("[[[year]-[month]-[day]][[[hour]:[minute]:[second]]");
    let mut dispatch = fern::Dispatch::new()
        // 与 release 下的 `tauri-plugin-log` 保持同一级别。
        .level(log::LevelFilter::Info)
        .format(move |out, message, record| {
            let timestamp = time::OffsetDateTime::now_utc()
                .format(&format)
                .unwrap_or_else(|_| "-".to_string());
            out.finish(format_args!(
                "{}[{}][{}] {}",
                timestamp,
                record.target(),
                record.level(),
                message
            ))
        });
    dispatch = dispatch.chain(std::io::stdout());

    if let Some(path) = log_file_path(identifier) {
        match fern::log_file(&path) {
            Ok(file) => dispatch = dispatch.chain(file),
            Err(error) => {
                log::warn!("failed to open log file {}: {error}", path.display());
            }
        }
    }

    // fern 的 `into_log` 返回 (级别, logger)，级别已由 dispatch 自身决定。
    let (_level, logger) = dispatch.into_log();
    logger
}

/// app 日志目录下的日志文件路径。
fn log_file_path(identifier: &str) -> Option<PathBuf> {
    app_log_dir(identifier).map(|dir| dir.join(LOG_FILE_NAME))
}

/// 解析 app 日志目录。
///
/// 与 `tauri::path::PathResolver::app_log_dir` 保持一致：
/// - macOS：`~/Library/Logs/<identifier>`
/// - 其它：`{<data local dir>}/<identifier>/logs`
///
/// debug 初始化阶段拿不到 `AppHandle`，无法直接调用 `PathResolver`，因此按同样
/// 的规则解析。
pub(crate) fn app_log_dir(identifier: &str) -> Option<PathBuf> {
    #[cfg(target_os = "macos")]
    {
        dirs::home_dir().map(|dir| dir.join("Library").join("Logs").join(identifier))
    }
    #[cfg(not(target_os = "macos"))]
    {
        dirs::data_local_dir().map(|dir| dir.join(identifier).join("logs"))
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn app_log_dir_contains_identifier() {
        let dir = app_log_dir("app.xinggaoya.nexterm").expect("log dir should resolve");
        let rendered = dir.to_string_lossy().replace('\\', "/");
        assert!(rendered.contains("app.xinggaoya.nexterm"), "{rendered}");
    }

    #[test]
    fn log_file_path_uses_nexterm_log_name() {
        let path = log_file_path("app.xinggaoya.nexterm").expect("log file path should resolve");
        assert_eq!(
            path.file_name().and_then(|n| n.to_str()),
            Some(LOG_FILE_NAME)
        );
    }

    #[test]
    fn log_bridge_respects_info_level() {
        let logger = log_bridge("app.xinggaoya.nexterm");
        let metadata = |level| log::Metadata::builder().level(level).build();
        assert!(logger.enabled(&metadata(log::Level::Info)));
        assert!(logger.enabled(&metadata(log::Level::Error)));
        assert!(!logger.enabled(&metadata(log::Level::Debug)));
    }

    /// 回归测试：devtools 插件与 `tauri-plugin-log` 共存时，log 插件必须
    /// `skip_logger()`，否则两者抢同一个全局 `log` logger 会让应用启动失败。
    ///
    /// 该测试会安装全局 tracing subscriber，因此整个测试进程只能跑一次。
    #[test]
    fn devtools_plugin_requires_log_plugin_to_skip_its_logger() {
        let plugins = super::init("app.xinggaoya.nexterm");

        let app = tauri::test::mock_builder()
            .plugin(plugins.devtools)
            .plugin(
                tauri_plugin_log::Builder::new()
                    .level(tauri_plugin_log::log::LevelFilter::Info)
                    .skip_logger()
                    .build(),
            )
            .build(tauri::test::mock_context(tauri::test::noop_assets()))
            .expect("mock app should build with devtools + skip_logger log plugin");
        drop(app);

        // 不 skip_logger 时，全局 logger 槽位已被 devtools 占用，log 插件
        // 的 setup 会失败 —— 这正是 debug 构建必须 skip_logger 的原因。
        let conflict = tauri::test::mock_builder()
            .plugin(
                tauri_plugin_log::Builder::new()
                    .level(tauri_plugin_log::log::LevelFilter::Info)
                    .build(),
            )
            .build(tauri::test::mock_context(tauri::test::noop_assets()));
        assert!(
            conflict.is_err(),
            "log plugin without skip_logger must not be able to take the global logger"
        );
    }
}
