# 贡献指南

感谢你对 Nexterm 感兴趣!欢迎贡献代码、报告 bug、提出新功能建议或改进文档。

## 行为准则

参与本项目即代表你同意遵守 [行为准则](./CODE_OF_CONDUCT.md)。

## 报告 Bug

在提交 issue 前,请先:

1. 搜索已有 issue 避免重复
2. 确认使用最新版本

提交 bug 时请包含:

- 操作系统与版本(Windows 10/11、macOS 13+、Ubuntu 22.04+)
- Nexterm 版本号
- 复现步骤
- 预期行为 vs 实际行为
- 截图或录屏(如有)
- 相关日志(应用日志目录见菜单 Help → Open Logs)

## 提出新功能

新功能建议请使用 issue 模板,描述:

- 用例与动机
- 期望的 UX 行为
- 与现有功能的关系(冲突/补充)
- 可选的实现思路

## 提交代码

### 开发环境

```bash
# 安装 pnpm
npm i -g pnpm@11

# 克隆并安装
git clone https://github.com/xinggaoya/nexterm.git
cd nexterm
pnpm install

# 安装 Rust 工具链(若未安装)
curl --proto '=https' --tlsv1.2 -sSf https://sh.rustup.rs | sh
```

### 分支与提交

- 从 `main` 创建特性分支:`git checkout -b feat/your-feature`
- 提交信息遵循 [Conventional Commits](https://www.conventionalcommits.org/zh-hans/):
  - `feat: 新功能`
  - `fix: 修复`
  - `refactor: 重构`
  - `docs: 文档`
  - `chore: 工程杂项`
  - `style: 样式(不影响逻辑)`
  - `test: 测试`
- 一个提交只做一件事
- 提交前在本地完成所有检查

### 本地检查

提交 PR 前必须通过:

```bash
pnpm exec vue-tsc --noEmit
pnpm test
pnpm build
cd src-tauri
cargo check --all-targets --locked
cargo clippy --all-targets --locked -- -D warnings
cargo test --locked
```

CI 会在 PR 上自动跑这些检查。任一红就需要修复后才能合并。

### 模块边界

请阅读 [NEXTERM.md](./NEXTERM.md) 与 [docs/architecture/01-overview.md](./docs/architecture/01-overview.md),
理解前端 ↔ Rust IPC 契约、Pinia store 边界、模块职责划分。

硬性规则:

- 前端不得直接访问文件系统、进程、shell、密钥 — 全部走 `@/lib/native`
- Rust 模块按 domain 分区(`pty` / `shell` / `fs` / `git` / `workspace` 等),不得跨模块私有互调
- 修改 IPC 契约须同步更新 `@/lib/native.ts` 与 `src-tauri/src/lib.rs` 注册

### PR 流程

1. fork 仓库
2. 创建特性分支
3. 提交 + 本地检查通过
4. 推送到 fork
5. 在主仓库发起 PR
6. 在 PR 描述中说明:
   - 变更动机与背景
   - 关键实现思路
   - 截图/录屏(UI 变更)
   - 关联的 issue
7. 等待 CI 通过 + 维护者 review
8. 解决 review 反馈,合并前 squash

### 文档同步

修改实现时同步更新:

- 涉及新模块 → 添加 `docs/architecture/<module>/README.md`
- 涉及 IPC 契约 → 更新 `docs/architecture/02-module-contracts.md`
- 涉及偏好 → 更新 `AGENTS.md` 的偏好章节
- 涉及重大行为变更 → 在 [CHANGELOG.md](./CHANGELOG.md) 的 `[Unreleased]` 段添加

## 调试技巧

```bash
# 仅前端调试
pnpm dev

# 完整 Tauri 开发模式(推荐)
pnpm tauri dev

# Rust 后端日志
RUST_LOG=debug pnpm tauri dev

# 重置前端自动构建产物
pnpm build --force
```

## 许可

提交 PR 即代表你同意按 [Apache License 2.0](./LICENSE) 许可你的贡献。
