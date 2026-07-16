// Prevents additional console window on Windows in release, DO NOT REMOVE!!
#![cfg_attr(not(debug_assertions), windows_subsystem = "windows")]

fn main() {
    // LSP mock server 模式：与 LSP 客户端走 stdio，用于 Section 2 传输层 e2e 验证。
    if std::env::args().any(|a| a == "--mock-lsp") {
        nexterm_lib::modules::lsp::mock::run_mock_stdio()
            .expect("mock-lsp crashed");
        return;
    }
    nexterm_lib::run()
}
