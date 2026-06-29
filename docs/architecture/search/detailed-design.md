# search 详细设计

## fs_grep 集成

`fs_grep` 由 Rust 端使用 `ignore::WalkBuilder` + `grep-regex` + `grep-searcher` 实现，详见 `src-tauri/src/modules/fs/grep.rs`。本模块仅消费其结果，不参与后端实现。

## 防抖与节流

`FindInFilesPanel` 对 pattern / case / include 任一变化做 250ms debounce。点击 Enter 立即触发。

## 大仓库处理

- 超过 200 条结果（DEFAULT_MAX_RESULTS）后 Rust 端截断并设置 `truncated = true`，前端用横幅提示用户细化。
- 命中按 `path` 分组，每组在 UI 上展示相对路径（`hit.rel`），点击单行触发 `open-result`。

## 未实现（下一轮）

- openAtLine：精准跳到结果对应行；当前仅 `tabs.openFileTab(path, true)` 打开文件。
- exclude 模式：Rust 端 fs_grep 已支持 `glob` 过滤包含项；下一轮加 exclude 输入。
- 跨工作区持久化：搜索词和最近结果不写入 preferences，避免污染启动状态。
