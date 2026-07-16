# Go LSP 集成（gopls）

## 二进制要求

```bash
go install golang.org/x/tools/gopls@latest
```

## 启动方式

打开 `*.go` 文件后，`src-tauri/src/modules/lsp/servers/go.rs::spec`
通过 `which::which("gopls")` 检测 binary。

## 配置

gopls 当前不暴露额外设置。所有 gopls 内部行为通过工作区
`.vscode/settings.json` 控制（未来可桥接到 Nexterm preferences）。
