# TypeScript LSP 集成（typescript-language-server）

## 二进制要求

```bash
npm install -g typescript-language-server
```

## 启动方式

打开 `*.ts` / `*.tsx` / `*.js` / `*.jsx` 等文件后，
`src-tauri/src/modules/lsp/servers/typescript.rs::spec`
通过 `which::which("typescript-language-server")` 检测。

启动参数固定：`--stdio`（LSP 标准通信模式）。

## 配置：T-1 默认 + 切换开关

`editorLspTypescriptMode = "builtin" | "lsp"`

- **builtin**（默认）
  - 仅 CodeMirror 基础语法高亮 + 文档内单词补全
  - 首屏启动快、不需要额外 binary
- **lsp**
  - 所有 TS/JS 智能走 `typescript-language-server`
  - 提供补全 / hover / rename / references / workspace symbols

切换生效：watch `editorLspTypescriptMode` 触发 `attachOrDetachLsp`
（`src/modules/editor/lib/editorPaneLsp.ts`）。
