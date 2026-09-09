# Nexterm 架构文档

> 这是 Nexterm 架构文档的入口。所有文档**全部中文**，专有名词保留英文。
> 仓库根的 `CODE_WIKI.md` / `AGENTS.md` / `NEXTERM.md` 是工程记忆与协作约束；本目录是设计文档。

## 推荐阅读路径

| 你的角色 | 建议顺序 |
|----------|----------|
| 第一次进入仓库 | [01-overview.md](./01-overview.md) -> [02-module-contracts.md](./02-module-contracts.md) -> [05-glossary.md](./05-glossary.md) -> 你关心的模块 README |
| 新增前端业务模块 | [02-module-contracts.md](./02-module-contracts.md) -> [03-development-workflow.md](./03-development-workflow.md) -> 相似模块的 README（参考） |
| 新增 / 修改 Tauri 命令 | [01-overview.md](./01-overview.md) -> [04-security-model.md](./04-security-model.md) -> 对应后端模块的 `detailed-design.md` |
| 排查前端 bug | [02-module-contracts.md](./02-module-contracts.md) -> [03-development-workflow.md](./03-development-workflow.md) 调试章节 -> 模块 README |
| 排查后端 bug | [04-security-model.md](./04-security-model.md) -> [03-development-workflow.md](./03-development-workflow.md) 调试章节 -> 对应模块 `detailed-design.md` |

## 文件清单

| 文件 | 作用 |
|------|------|
| [01-overview.md](./01-overview.md) | 全局架构、设计原则、数据流 |
| [02-module-contracts.md](./02-module-contracts.md) | 模块边界、跨模块通信规则、Pinia 写法、命名规范 |
| [03-development-workflow.md](./03-development-workflow.md) | 开发、调试、日志、提交、新增模块、WSL 构建 |
| [04-security-model.md](./04-security-model.md) | WorkspaceRegistry、Job Object、Transcript、ConPTY 序列化、深链解析 |
| [05-glossary.md](./05-glossary.md) | 术语表 |
| [overview.md](./overview.md) | 与 01-overview.md 主题相同，更偏概览图；推荐直接读 01 |

## 模块索引

| 模块 | README | 详细设计 |
|------|--------|----------|
| 终端 terminal | [terminal/README.md](./terminal/README.md) | [terminal/detailed-design.md](./terminal/detailed-design.md) |
| 编辑器 editor | [editor/README.md](./editor/README.md) | [editor/detailed-design.md](./editor/detailed-design.md) |
| 文件浏览 explorer | [explorer/README.md](./explorer/README.md) | [explorer/detailed-design.md](./explorer/detailed-design.md) |
| 源代码控制 source-control | [source-control/README.md](./source-control/README.md) | [source-control/detailed-design.md](./source-control/detailed-design.md) |
| Git 历史 git-history | [git-history/README.md](./git-history/README.md) | [git-history/detailed-design.md](./git-history/detailed-design.md) |
| 标签页 tabs | [tabs/README.md](./tabs/README.md) | [tabs/detailed-design.md](./tabs/detailed-design.md) |
| 设置 settings | [settings/README.md](./settings/README.md) | [settings/detailed-design.md](./settings/detailed-design.md) |
| 命令 commands | [commands/README.md](./commands/README.md) | [commands/detailed-design.md](./commands/detailed-design.md) |
| 工作区 workspace | [workspace/README.md](./workspace/README.md) | [workspace/detailed-design.md](./workspace/detailed-design.md) |
| 主题 theme | [theme/README.md](./theme/README.md) | [theme/detailed-design.md](./theme/detailed-design.md) |
| 通知 notifications | [notifications/README.md](./notifications/README.md) | [notifications/detailed-design.md](./notifications/detailed-design.md) |
| 国际化 i18n | [i18n/README.md](./i18n/README.md) | [i18n/detailed-design.md](./i18n/detailed-design.md) |
| 预览 preview | [preview/README.md](./preview/README.md) | [preview/detailed-design.md](./preview/detailed-design.md) |
| Markdown 渲染 markdown | [markdown/README.md](./markdown/README.md) | [markdown/detailed-design.md](./markdown/detailed-design.md) |
| 图片预览 file-preview | [file-preview/README.md](./file-preview/README.md) | — |
| WSL 常驻代理 agent | [agent/README.md](./agent/README.md) | — |
| SSH ssh | [ssh/README.md](./ssh/README.md) | — |
| Pinia 状态管理 pinia | [pinia/README.md](./pinia/README.md) | [pinia/detailed-design.md](./pinia/detailed-design.md) |

## 文档维护约定

- 模块 README 的标准结构见 [./_template.md](./_template.md)（若不存在则按本目录内任意 README 的 1~8 节顺序补齐）。
- 修改任何模块的 IPC 契约时，必须同步更新：模块 README + `src/lib/native.ts` 注释 + `src-tauri/src/lib.rs` 注释 + 顶层 `01-overview.md` 的"数据流"小节。
- 修改任何 store 的字段时，必须更新对应模块 README 的"Pinia 状态"小节。
