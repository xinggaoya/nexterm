# search 模块

## 职责

在工作区范围内提供「Find in Files」能力 —— 通过 Rust 后端的 `fs_grep` 命令执行基于 ripgrep 的内容搜索，将结果按文件分组渲染，点击行项后通知 Workbench 打开对应文件。

## 模块边界

- `src/modules/search/FindInFilesPanel.vue`：UI 组件，包含 pattern 输入、case 切换、include glob、结果列表。
- `src/modules/search/lib/findInFilesService.ts`：包装 `native.fsGrep`，屏蔽 IPC 细节。
- `src/modules/search/lib/findInFilesBoundary.test.ts`：边界测试，确保 search 模块不直接 `invoke()`。
- `src/modules/search/lib/findInFilesService.test.ts`：参数映射与空白 pattern 短路单测。
- `src/modules/search/index.ts`：模块出口。

## IPC 契约

- `native.fsGrep(pattern, root, opts?)`：调用 Rust `fs_grep`，返回 `{ hits, truncated, filesScanned }`。
- 结果通过 `open-result` 事件 emit 路径与行号，由 MainApp 调 `tabs.openFileTab(path, true)` 打开编辑器。
- 精准跳行（openAtLine）属于下一轮扩展；本轮只打开文件到第 1 行。

## 状态归属

- 搜索输入 / case / include / 命中列表：组件内 `ref`，不跨模块共享。
- 后端 fs_grep 状态：完全在 Rust 端，无前端缓存。

## 集成点

- FileExplorer 新增 mode 切换（files / content），通过 `<FindInFilesPanel>` 子面板渲染。
- 命令 `search.findInFiles`（Ctrl+Shift+F）通过 `Workbench.openFindInFiles` → `FileExplorer.setMode('content')` 切换。
- 结果点击 emit `open-result` → FileExplorer → Workbench → MainApp → `tabs.openFileTab`。

## 测试

- 边界测试：禁止 search 模块直接 `invoke()` 或 import `@tauri-apps/api`。
- Service 单测：参数映射、空白 pattern 短路、glob 省略。
- 集成验证：手动在工作区打开搜索面板，确认结果与编辑器跳转。
