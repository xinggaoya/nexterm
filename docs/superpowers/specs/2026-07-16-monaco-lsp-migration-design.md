# Nexterm 编辑器迁移：CodeMirror 6 → Monaco Editor + LSP

> 设计日期：2026-07-16
> 状态：草案（待用户最终 review 后冻结）
> 涉及模块：`src/modules/editor/`、`src-tauri/src/modules/lsp/`

## 1. 背景与目标

### 1.1 当前现状

编辑器模块基于 **CodeMirror 6** 实现，提供：

- `EditorPane.vue`（482 行）— 主编辑器，集成行号 / 折叠 / 自动补全 / 括号匹配 / 9 套主题 / Markdown split+preview / Vim
- `DiffCodeMirror.vue` — 基于 `@codemirror/merge` 的 unified diff 视图
- `lib/languageResolver.ts`（382 行）— 50+ 语言的动态 import 加载
- `lib/extensions.ts` — Compartments（语言 / 只读 / 换行 / Vim）与主题覆盖
- `lib/themes.ts` — 9 套 `@uiw/codemirror-theme-*` 主题
- `lib/vim.ts` — `@replit/codemirror-vim` 集成（`:w` / `:q` / `:wq` / `:x` + 方向键映射）
- `editorCommands.ts` — `editor.save` / `editor.closeActive` / `editor.gotoLine` 命令注册
- 关联模块：`tabs` / `source-control` / `markdown` / `preview` / `commands`

依赖共 ~40 个 npm 包（28 个 `@codemirror/*` + 9 个 `@uiw/*` + 2 个其他），`vite.config.ts` 中有专项 chunk 拆分。

### 1.2 目标

- **IDE 级编辑体验**：IntelliSense、多光标、定义跳转、引用查找、代码片段
- **统一架构**：Tauri Rust 启动并守护所有语言服务器（LSP），WebView 仅负责 UI 与 JSON-RPC 客户端
- **保持现有 UX**：9 套主题、行号 / 状态栏 / 工具条 / Markdown 预览 / Vim / 保存冲突对话框 / 外部变更检测

### 1.3 非目标

- 不重新设计 Tab / Diff 缓存 / Git 数据来源
- 不引入新的 IPC 总线
- 不重写 Markdown 渲染（`@/modules/markdown/` 保持不变）

## 2. 分阶段交付

| 阶段 | 范围 | 阶段后状态 |
| --- | --- | --- |
| **Section 1** | Monaco 骨架 + Diff + 内置 TS/JS/HTML/CSS/JSON 智能服务 | 用户获得 Monaco 编辑器与 Diff，所有现有 UX 保留；LSP 尚未启用 |
| **Section 2** | LSP 传输层（stdio-via-Tauri-IPC）+ mock-lsp | 传输层独立可测，与具体语言解耦 |
| **Section 3** | 真实 LSP（rust-analyzer / pyright / gopls / typescript-language-server）逐个接入 | 完整 IDE 体验 |

每个阶段独立可 merge、可回滚、可独立验收。

## 3. Section 1 — Monaco 骨架

### 3.1 新增依赖

```
monaco-editor                 ^0.52.x
monaco-vim                    ^0.4.x
vite-plugin-monaco-editor     ^1.1.x
monaco-themes                 ^0.1.x      # 9 套主题等价映射
```

### 3.2 移除依赖

- 全部 `@codemirror/*`（28 个包：state / view / commands / language / search / lint / autocomplete / merge / lang-* / legacy-modes）
- 全部 `@uiw/codemirror-theme-*`（9 个主题包）
- `@replit/codemirror-vim`
- `@lezer/highlight`（仅 CodeMirror 引用）

### 3.3 目录调整

```
src/modules/editor/
  EditorPane.vue                # 改用 monaco.editor.create（替换原 CodeMirror 实例）
  DiffEditor.vue          NEW   # 替换原 DiffCodeMirror.vue，基于 monaco.editor.createDiffEditor
  MarkdownEditorPreview.vue     # 保留
  EditorToolbar.vue             # 保留
  EditorStatusBar.vue           # 保留
  GitDiffPane.vue               # 用 DiffEditor 替换 DiffCodeMirror
  GitDiffStack.vue              # 保留
  editorCommands.ts             # 保留
  editorTypes.ts                # 微调 EditorPaneHandle
  index.ts                      # 保留（导出 GitDiffStack + EditorPaneHandle）
  lib/
    documentService.ts          # 保留（与编辑器解耦）
    diffCache.ts                # 保留
    diffStats.ts                # 保留
    editorConfig.ts        NEW  # IEditorConstructionOptions 工厂（字号 / 行号 / 折叠 / 主题）
    themes.ts              NEW  # 9 套主题 → monaco.editor.defineTheme 适配
    languageMap.ts         NEW  # 文件扩展名 → monaco 语言 id（替代 languageResolver）
    vim.ts                REWRT # monaco-vim 适配 + :w/:q handler
```

### 3.4 Monaco 实例生命周期

`EditorPane.vue` 核心映射：

```ts
const editor = monaco.editor.create(host.value, {
  value: content,
  language: languageId,
  theme: prefs.editorTheme,
  automaticLayout: true,
  fontFamily: detectMonoFontFamily(),
  fontSize: 13,
  lineNumbers: "on",
  folding: true,
  bracketMatching: "always",
  autoClosingBrackets: "always",
  tabSize: 2,
  wordWrap: prefs.editorWordWrap ? "on" : "off",
  minimap: { enabled: false },
  renderWhitespace: "none",
  scrollBeyondLastLine: false,
  smoothScrolling: true,
  fixedOverflowWidgets: true,
  readOnly: false,
});

editor.onDidChangeModelContent(() => {
  const next = editor.getValue();
  buffer.value = next;
  setDirty(next !== savedContent.value);
});

editor.onDidChangeCursorPosition((e) => {
  line.value = e.position.lineNumber;
  column.value = e.position.column;
  selectionLength.value = editor.getModel()?.getValueLengthInRange(editor.getSelection()!) ?? 0;
});
```

`onBeforeUnmount` → 逐一 `dispose` 之前保存的 `IDisposable`（onDidChangeModelContent / onDidChangeCursorPosition 返回值），再调用 `editor.dispose()` 并 `editor.getModel()?.dispose()` 清理 model 引用。

### 3.5 `EditorPaneHandle` 适配

保留现有方法语义，移除无外部消费方的方法：

```ts
export type EditorPaneHandle = {
  focus: () => void;
  getSelection: () => string | null;
  getPath: () => string;
  save: () => Promise<void>;
  openGotoLine: () => void;
  reload: () => Promise<void>;
  undo: () => void;
  redo: () => void;
};
```

移除：`setQuery` / `findNext` / `findPrevious` / `clearQuery`（Monaco 自带搜索面板）。

### 3.6 Diff 视图

`DiffEditor.vue`：

```ts
const diffEditor = monaco.editor.createDiffEditor(host.value, {
  enableSplitViewResizing: false,
  renderSideBySide: true,
  automaticLayout: true,
  readOnly: true,
  theme: prefs.editorTheme,
});
diffEditor.setModel({
  original: monaco.editor.createModel(props.originalContent, languageId),
  modified: monaco.editor.createModel(props.modifiedContent, languageId),
});
```

`GitDiffPane.vue` 仍负责数据获取与缓存（`diffCache.ts`），仅把渲染交给 `DiffEditor.vue`。

### 3.7 主题系统

`lib/themes.ts`：将 9 套现有主题的 token 颜色转换为 monaco 的 `editor.tokenTheme` / `colors` 规则。优先复用 `monaco-themes` 包提供的等价 token；颜色微调统一通过 `monaco.editor.defineTheme` 在 `app onMounted` 时注册一次。

主题列表（保持不变）：atomone、aura、copilot、github-dark、github-light、nord、tokyo-night、xcode-dark、xcode-light。

`prefs.editorTheme` 切换时调用 `monaco.editor.setTheme(id)`；若 model 不存在则下次 mount 时生效。

### 3.8 Vim 集成

```ts
import { initVimMode, Vim } from "monaco-vim";

export function attachVim(editor: IStandaloneCodeEditor, handlers: VimHandlers) {
  const statusNode = createStatusBarNode();
  const vim = initVimMode(editor, statusNode);

  Vim.defineEx("write", "w", () => handlers.save());
  Vim.defineEx("quit", "q", () => handlers.close());
  Vim.defineEx("wq", "wq", () => { handlers.save(); handlers.close(); });
  Vim.defineEx("xit", "x", () => { handlers.save(); handlers.close(); });

  // 方向键 remap（沿用现有约束）
  Vim.map("<Up>", "k", "normal");
  Vim.map("<Down>", "j", "normal");
  Vim.map("<Left>", "h", "normal");
  Vim.map("<Right>", "l", "normal");

  return { dispose() { vim.dispose(); statusNode.remove(); } };
}
```

由 `prefs.vimMode` 控制挂载／卸载：

```ts
watch(() => prefs.vimMode, (enabled) => {
  vimDisposable?.dispose();
  if (enabled) vimDisposable = attachVim(editor, { save, close });
});
```

### 3.9 Markdown split / preview

`MarkdownEditorPreview.vue` 与现有 CSS 一致不变；`mode` 在 `EditorPane.vue` 中通过 `data-mode` 控制三个 panel 的 `v-show`。

`monaco.languages.register({ id: "markdown", extensions: [".md", ".markdown", ".mdx"] })` 让 Monaco 自动识别。预览通过 `marked` 共享渲染（与现状一致）。

### 3.10 vite.config.ts 调整

```ts
import monacoEditorPlugin from "vite-plugin-monaco-editor";

plugins: [
  vue(),
  AutoImport({ ... }),
  Components({ ... }),
  monacoEditorPlugin({
    languageWorkers: ["editorWorkerService", ["typescript", "json", "html", "css"]],
    customWorkers: [],
  }),
  tailwindcss(),
],

manualChunks: (id) => {
  if (!id.includes("node_modules")) return;
  if (id.includes("/xterm/") || id.includes("@xterm/")) return "xterm";
  if (id.includes("monaco-editor") || id.includes("/monaco-vim/") || id.includes("monaco-themes")) return "monaco";
  if (id.includes("/vue/") || id.includes("/@vue/") || id.includes("/naive-ui/") || id.includes("/pinia/") || id.includes("/vue-router/")) return "vue-vendor";
},
```

移除原 codemirror 分支。

### 3.11 Section 1 完成标志

- `package.json` 中 `@codemirror/*` / `@uiw/*` / `@replit/*` / `@lezer/*` 全部移除
- `pnpm test` 全部通过（重写后的 `EditorPane.vue.test.ts`、`languageMap.test.ts`）
- `pnpm build` 通过
- `cargo clippy --all-targets --locked -- -D warnings` 通过
- 视觉：现有 UX（主题切换 / Markdown 预览 / 状态栏 / Vim / 保存冲突 / 外部变更）保持一致

## 4. Section 2 — LSP 传输层

### 4.1 目标

让前端能通过 `vscode-jsonrpc` `MessageTransport` 接口与 Rust 管理的 LSP 子进程通信，**不依赖任何具体 LSP 实现**。本阶段后端只跑 `mock-lsp`（echo 风格的回显 server）用于验证传输层往返。

### 4.2 新增 Rust 模块

```
src-tauri/src/modules/lsp/
  mod.rs            # LspRegistry: Mutex<HashMap<SessionId, LspSession>>
  session.rs        # LspSession: child handle + stdin writer + stdout reader task
  framing.rs        # JSON-RPC 帧编解码（Content-Length 头 + JSON body）
  mock.rs           # mock-lsp：echo + 空 diagnostics
  commands.rs       # Tauri 命令注册（lsp_start/write/stop/list/resolve_command）
  errors.rs         # LspError → String
```

复用 `src-tauri/src/modules/lock.rs` 提供的 `mutex_lock`。

### 4.3 数据流

```
WebView (Vite)                                │ Tauri IPC         │ Rust lsp/
──────────────────────────────────────────────┼───────────────────┼─────────────────────────────────
LspTransport.send(json)                       │                   │
  └─ invoke("lsp_write", {id, message})       │ ─────────────────►│ stdin BufWriter
                                              │                   │   framing::write_frame()
◄── Channel<LspMessage> ── stdout frames ─────│                   │ stdout reader task:
                                              │                   │   loop { read_frame → channel.send }
                                              │                   │
nexterm://lsp-exit (event)                    │ ◄────────────────│ child.wait() returns
```

### 4.4 Tauri 命令

```rust
#[tauri::command]
pub async fn lsp_start(
    spec: LspServerSpec,              // { id, language, command, args, env, cwd }
    workspace: WorkspaceEnv,
    channel: Channel<LspMessage>,     // Tauri Channel，单向 server → client
) -> Result<LspSessionId, LspError>;

#[tauri::command]
pub async fn lsp_write(
    id: LspSessionId,
    message: String,                  // 完整 JSON-RPC 帧
) -> Result<(), LspError>;

#[tauri::command]
pub async fn lsp_stop(id: LspSessionId) -> Result<(), LspError>;

#[tauri::command]
pub async fn lsp_list() -> Result<Vec<LspSessionInfo>, LspError>;

#[tauri::command]
pub async fn lsp_resolve_command(
    language: String,                 // "rust" | "python" | "go" | "typescript"
) -> Result<Option<LspResolvedCommand>, LspError>;
```

`LspMessage` schema：

```rust
#[derive(Serialize, Clone)]
#[serde(tag = "kind")]
enum LspMessage {
    Frame { payload: String },
    ParseError { message: String },
    Stderr { message: String },
}
```

### 4.5 前端 Transport

`src/modules/lsp/lspTransport.ts`：

```ts
import type { MessageTransport } from "vscode-jsonrpc";
import type { Channel } from "@tauri-apps/api/core";
import { invoke } from "@tauri-apps/api/core";

export class TauriLspTransport implements MessageTransport, Disposable {
  async listen(): Promise<void> {
    this.channel = await invoke<number>("lsp_start", { spec: this.spec });
    this.channel.onmessage = (msg) => {
      if (msg.kind === "frame") this._emitter.fire(msg.payload);
      if (msg.kind === "stderr") console.warn("[lsp]", msg.message);
    };
  }

  send(message: string | Message): void {
    const body = typeof message === "string" ? message : JSON.stringify(message);
    void invoke("lsp_write", { id: this.sessionId, message: body });
  }

  dispose(): void {
    void invoke("lsp_stop", { id: this.sessionId });
    this.channel?.close();
  }
}
```

### 4.6 生命周期与崩溃恢复

- `EditorPane.vue` mount 时**不启动 LSP**，懒启动
- 文件打开 → 检查 `languageMap[ext]` 是否有 LSP spec → 创建 `TauriLspTransport` + `monaco-languageclient` 的 `LanguageClient`，调用 `client.start()`
- `onBeforeUnmount` → `client.stop()` + `transport.dispose()`
- workbench 关闭 → `LspRegistry` drop 时对每个 session 发 SIGTERM，5s 后 SIGKILL
- LSP 崩溃 → `nexterm://lsp-exit` 事件触发前端重建，指数退避（500ms / 1s / 2s / 4s / 8s 上限）

### 4.7 严格边界

- `src/lib/native.ts` 新增 `native.lspStart / lspWrite / lspStop / lspList / lspResolveCommand`（沿用 `nativeBoundary.test.ts` 约束）
- ESLint 规则不变
- Rust 用 `lock.rs` 处理 mutex poison

### 4.8 Section 2 完成标志

- `lsp_start(mock-lsp)` 能正确回显 `initialize` / `did_open` / `shutdown`
- `lspTransport.test.ts` 走完一个完整 JSON-RPC 往返
- `lspBenchmark.test.ts`：1MB diagnostic 全量响应不丢帧
- 心跳模拟：mock 30s 无响应 → 前端正确 cleanup

## 5. Section 3 — 真实 LSP 接入

### 5.1 目标

逐个语言接入 LSP 服务，每个语言独立一个 PR + 一个 Rust 子模块。

### 5.2 Rust 子模块结构

```
src-tauri/src/modules/lsp/
  servers/
    mod.rs
    rust.rs        # rust-analyzer
    python.rs      # pyright-langserver
    go.rs          # gopls
    typescript.rs  # typescript-language-server
```

每个 `servers/<lang>.rs`：

```rust
pub fn rust_analyzer_spec(cwd: &Path) -> LspServerSpec {
    let path = which::which("rust-analyzer")
        .or_else(|_| which::which("rustup"))
        .expect("rust-analyzer not found");
    LspServerSpec {
        id: "rust-analyzer",
        language: "rust",
        command: path,
        args: vec![],
        env: defaults(),
        cwd: Some(cwd.into()),
        root_uri_resolver: RootUriResolver::WorkspaceRoot,
    }
}
```

### 5.3 前端 languageMap 扩展

```ts
const LANG_TO_SERVER: Record<string, LspServerSpecKey | undefined> = {
  rust:        { id: "rust-analyzer",          rootless: false },
  python:      { id: "pyright-langserver",     rootless: false },
  go:          { id: "gopls",                  rootless: false },
  typescript:  { id: "typescript-language-server", rootless: true },
  javascript:  { id: "typescript-language-server", rootless: true },
};
```

### 5.4 TypeScript 处理（方案 T-1）

**默认**：保留 Monaco 自带 TS worker（更轻、首屏快、IntelliSense 已可用），LSP 只接 Rust / Python / Go。

高级用户可通过 `editor.lsp.typescript.mode = "lsp"` 切换为统一走 `typescript-language-server`。

切换时禁用 Monaco 的 TS worker：

```ts
self.MonacoEnvironment = {
  getWorker(_, label) {
    if (label === "typescript" || label === "javascript") {
      return new EditorWorker();  // fallback
    }
    return new TsWorker();        // default
  },
};
```

### 5.5 二进制检测

`lsp_resolve_command`：

```rust
pub async fn lsp_resolve_command(language: String) -> Result<Option<LspResolvedCommand>> {
    match language.as_str() {
        "rust"        => Ok(which("rust-analyzer").ok().map(into)),
        "python"      => Ok(which("pyright-langserver")
                          .or_else(|_| which("pylsp")).ok().map(into)),
        "go"          => Ok(which("gopls").ok().map(into)),
        _             => Ok(None),
    }
}
```

前端拿不到二进制时显示 `editor.lsp.serverMissing` toast（i18n），不阻塞编辑器打开。

### 5.6 Section 3 完成标志（每语言）

- `src-tauri/src/modules/lsp/servers/<lang>.rs` + `src/modules/lsp/serverConfigs/<lang>.ts`
- 集成测试：打开对应仓库关键文件能拿到 hover / completion / definition
- 文档：`docs/architecture/lsp/<lang>.md`
- e2e 截图：hover 截图 + completion 截图

## 6. 数据流与 IPC 契约

### 6.1 编辑器数据流（Section 1 完成后）

```
┌──────────────┐        ┌────────────────┐         ┌──────────────────────┐
│ FileExplorer │───────►│  tabsPinia     │───────►│  Workbench.vue        │
│ MarkdownList │ open   │  (EditorTab)   │ active  │  <EditorPane :path/> │
└──────────────┘        └────────────────┘         └──────────────────────┘
                                                          │
                                                          ▼
                                                   ┌──────────────────┐
                                                   │  Monaco editor   │
                                                   │  + monaco-vim    │
                                                   └──────────────────┘
                                                          │
                                       documentService    │
                                       (native.fsReadFile/│WriteFile)
                                                          ▼
                                                   ┌──────────────────┐
                                                   │  Tauri Rust      │
                                                   │  fs module       │
                                                   └──────────────────┘
```

### 6.2 LSP 数据流（Section 2/3 完成后）

```
┌──────────────┐     ┌──────────────────┐    ┌────────────────────────┐
│ EditorPane   │────►│ LspManager       │───►│ TauriLspTransport      │
│ (Monaco)     │     │ (lazy start)     │    │ vscode-jsonrpc impl    │
└──────────────┘     └──────────────────┘    └────────────────────────┘
                                                       │
                                          Channel<...> │  invoke(...)
                                                       ▼
                                                ┌────────────────────┐
                                                │ Rust lsp/          │
                                                │ ├─ framing          │
                                                │ ├─ session manager  │
                                                │ └─ child tokio proc │
                                                └────────────────────┘
                                                       │
                                                       ▼
                                                ┌────────────────────┐
                                                │ real LSP process   │
                                                │ (rust-analyzer...) │
                                                └────────────────────┘
```

### 6.3 IPC 契约

新增的 Tauri 命令**全部**经由 `@/lib/native.ts` 暴露：

```ts
// src/lib/native.ts (新增)
export const native = {
  ...,
  lspStart: (spec: LspServerSpec) => invoke<number>("lsp_start", { spec }),
  lspWrite: (id: number, message: string) => invoke<void>("lsp_write", { id, message }),
  lspStop: (id: number) => invoke<void>("lsp_stop", { id }),
  lspList: () => invoke<LspSessionInfo[]>("lsp_list"),
  lspResolveCommand: (language: string) => invoke<LspResolvedCommand | null>("lsp_resolve_command", { language }),
};
```

新增边界测试 `src/modules/lsp/lspIpcBoundary.test.ts`：禁止前端的 `EditorPane.vue` / `LspManager` 等直接 `invoke("lsp_*")`，必须经由 `native.lsp*`。

## 7. 测试、风险、时间预估

### 7.1 测试矩阵

| 类别 | 文件 |
| --- | --- |
| Rust 单元 | `lsp/framing.test.rs` |
| Rust 集成 | `lsp_integration.test.rs`：spawn `mock-lsp` 端到端发/收 |
| 前端单测 | `EditorPane.vue.test.ts`（重写选择器）、`languageMap.test.ts`、`lspTransport.test.ts`、`vim.test.ts` |
| 边界测试 | `editorVueBoundary.test.ts` 加 Monaco guard；新增 `lspIpcBoundary.test.ts` |
| 性能 | `lspBenchmark.test.ts`：1MB diagnostic 不丢；Monaco 首屏 vs CodeMirror 对比 |

### 7.2 风险清单

| 风险 | 等级 | 应对 |
| --- | --- | --- |
| Monaco bundle 过大 | 中 | vite 插件按需加载；首屏 JS 预算监控 |
| LSP 子进程残留 | 中 | `LspRegistry` drop SIGTERM + 5s + SIGKILL；workbench 退出强制清理 |
| Channel 大消息丢帧 | 中 | 帧分片测试 + 监控；fallback 到 `invoke("lsp_write_blob")` POST 大文件 |
| 主题映射视觉差异 | 低 | 复用 `monaco-themes` 等价 token，调参一晚上 |
| Vim 体验回退 | 中 | `monaco-vim` 在 `i` / `Esc` / 文本对象上有历史 bug，逐项对照测试 |
| LSP 启动阻塞首屏 | 低 | 懒启动：等 file 真正打开才启 |

### 7.3 时间预估

| 阶段 | 估计 |
| --- | --- |
| Section 1（Monaco 骨架） | 3–5 天 + 1–2 天主题迁移 + 1 天测试重写 |
| Section 2（LSP 传输） | 3–4 天 Rust + 2 天前端 + 1 天 mock 测试 |
| Section 3（每种语言） | 1–2 天 / 4 种 ≈ 5–8 天 |

合计约 **3 周**，Section 1 → Section 2 顺序推进。

## 8. 文档产出

- `docs/superpowers/specs/2026-07-16-monaco-lsp-migration-design.md`（本文档）
- `docs/architecture/lsp/README.md`：LSP 模块总览
- `docs/architecture/lsp/<lang>.md`：每语言独立文档（Section 3 推进时增补）
- `docs/architecture/editor/README.md`：在 Section 1 完成时同步更新为 Monaco 描述

## 9. 决策记录

| 项 | 决策 |
| --- | --- |
| 替换范围 | 全量（Editor + Git Diff） |
| IntelliSense 深度 | LSP（monaco-languageclient） |
| 架构模式 | Rust 启 LSP、stdio-via-Tauri-IPC |
| Monaco 分包 | monaco-editor + vite-plugin-monaco-editor |
| TypeScript 处理 | 默认 T-1（Monaco 内置 worker），保留切换开关 |
| 拆阶段交付 | Section 1 → Section 2 → Section 3 |

---

> Spec review pass：无占位 / 内部一致 / 单一 PR 不可达分解目标 / 关键术语统一。等待用户最终确认。
