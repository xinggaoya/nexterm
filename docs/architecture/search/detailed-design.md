# search 详细设计

## fs_grep 集成

`fs_grep` 由 Rust 端使用 `ignore::WalkBuilder` + `grep-regex` + `grep-searcher` 实现，详见 `src-tauri/src/modules/fs/grep.rs`。本模块仅消费其结果，不参与后端实现。

## 匹配模式：纯文本（默认）/ 正则

后端 `fs_grep` 只按 Rust 正则解析 pattern。为避免普通字符搜索（`a.b`、`foo(bar)`、`C++`）误触正则语义，面板默认以**纯文本子串**模式工作：前端 `escapeRegExp` 转义后下发，等价于 `rg -F`，且本地 / WSL / SSH 三条路由行为一致。`.*` 按钮切换到正则模式，pattern 原样透传。转义与匹配模式实现在 `lib/highlight.ts` / `lib/findInFilesService.ts`。

## 命中高亮

`buildHighlightSegments`（`lib/highlight.ts`）在显示层切分命中片段：字面量模式按大小写规则查找子串，正则模式用 JS `RegExp`（`g` 标志，零长匹配保护）。JS 与 Rust 正则语法存在差异时高亮可能缺失，但只影响显示，不影响匹配结果。

## 防抖与节流

`FindInFilesPanel` 对 pattern / case / include / regex 任一变化做 250ms debounce。Enter 立即触发并取消挂起的防抖。

## 大仓库处理

- 超过 200 条结果（DEFAULT_MAX_RESULTS）后 Rust 端截断并设置 `truncated = true`，前端用横幅提示用户细化。
- 命中按 `path` 聚合分组（后端并行遍历会交错推送不同文件的命中，不能用「连续相同 path」分组），组内按行号排序去重，组头展示文件名图标、相对路径与命中数。
- 组头可折叠/展开；结果分页「先渲染 40 组 + 触底加载」。

## 键盘与焦点

- 面板挂载即聚焦输入框。
- ↑/↓ 在（展开的）结果间移动高亮并滚动到可见区，Enter 打开当前项，Escape 清空并回到输入框。点击行触发 `open-result`（path + line）。

## 未实现（下一轮）

- exclude 模式：Rust 端 fs_grep 已支持 `glob` 过滤包含项；下一轮加 exclude 输入。
- 跨工作区持久化：搜索词和最近结果不写入 preferences，避免污染启动状态。
