# Python LSP 集成（pyright-langserver / pylsp）

## 二进制要求

```bash
# 推荐：pyright（微软维护，类型驱动）
npm install -g pyright
# pyright 自带 langserver：`pyright-langserver --stdio`

# 备选：python-language-server
pip install python-lsp-server[all]
# 提供 `pylsp` 命令
```

## 启动方式

打开 `*.py` 文件后，`src-tauri/src/modules/lsp/servers/python.rs::spec`
按优先级 `pyright-langserver` → `pylsp` 通过 `which::which` 检测。

## 配置

Python LSP 不在设置面板暴露选项。虚拟环境（venv / conda）的
自动检测留待后续补入；目前 LSP 启动到 Python interpreter 的
`python` 默认路径，需要用户在 shell 中提前 `activate`。
