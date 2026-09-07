# 03. 开发工作流

## 1. 环境准备

### 1.1 工具链

| 工具 | 必需版本 |
|------|----------|
| Node.js | 18+（推荐 20 LTS） |
| pnpm | 9+（强制，不允许 npm / yarn / bun） |
| Rust | stable 工具链（`rustup`） |
| Tauri CLI | 由 `@tauri-apps/cli` 提供，使用 `pnpm tauri` 调用 |
| Git | 最新稳定 |
| WSL | 仅 Windows 需要时 |

### 1.2 首次拉取

```bash
pnpm i
```

## 2. 日常命令

| 命令 | 用途 |
|------|------|
| `pnpm dev` | 启动 Vite dev server（端口 3180） |
| `pnpm tauri dev` | 启动 Tauri 桌面应用 dev 模式（包含 Vite） |
| `pnpm exec vue-tsc --noEmit` | 仅类型检查（裸 tsc 解析不了 .vue） |
| `pnpm build` | 类型检查 + 生产构建（产出 `dist/`） |
| `pnpm test` | Vitest 单次运行 |
| `pnpm test:watch` | Vitest 监听模式 |
| `cd src-tauri && cargo check --all-targets --locked` | Rust 类型检查（含 nexterm-agent） |
| `cd src-tauri && cargo clippy --all-targets --locked -- -D warnings` | Rust lint（PR 前必跑） |

## 3. 调试

### 3.1 前端

- 开发时 `pnpm dev`，浏览器开发者工具可正常打开（在 Tauri 中通过右键检查元素）。
- `import.meta.env.DEV` 在开发模式为 `true`，可加开发期断言。
- `useEventListener` 自动配对 add/remove，无需手写 cleanup。

### 3.2 Rust

- `tauri-plugin-log` 写入 webview 控制台（`pnpm tauri dev` 时可见）+ 文件。
- panic 由 `panic_report::install_panic_hook` 统一结构化输出：`[nexterm] panic in thread <name>: <message> at <file:line:col>`。
- `log::LevelFilter::Info` 是默认级别（可在 `lib.rs` 调整）。

### 3.3 常见问题

- **PTY 没输出 / 卡住**：检查 ConPTY 序列化保护（`pty_open` 互斥），不要并发启动两个 PTY。
- **WSL 文件变化漏掉**：watcher 由 `nexterm-agent watch` 提供，确认其 stdout JSON 行格式没改。
- **偏好不持久化**：`store.ts` 走 `LazyStore`，所有写入都是 200ms 防抖；等待 `prefs.hydrate()` 完成后再读。
- **Terminal 输出乱码**：检查 `da_filter`（`src-tauri/src/modules/pty/da_filter.rs`）和 `shell_init` 是否对当前 shell 注入正确。

## 4. 提交流程

### 4.1 Conventional Commits

```
feat: 新增功能
fix: 修复 bug
refactor: 重构（不改变行为）
chore: 杂项（依赖、构建、配置）
merge: 合并 / sync
```

每个 commit 聚焦单一改动。Bug 修复 + 重构分两个 commit。

### 4.2 PR 前自检

- [ ] `pnpm test` 全部通过（允许 2 个预存在失败，见 AGENTS.md "Testing & QA"）
- [ ] `pnpm build` 通过
- [ ] `cd src-tauri && cargo clippy --all-targets --locked -- -D warnings` 通过
- [ ] 若改了 IPC 契约，更新 `native.ts` + `lib.rs` + 模块 README
- [ ] 若改了 store 字段，更新对应模块 README 的"Pinia 状态"小节
- [ ] 涉及模块所有权 / 框架迁移 / 安全相关：附边界测试
- [ ] UI 改动：附截图或录屏

### 4.3 PR 描述模板

```markdown
## 摘要
- 改了什么，为什么

## 测试
- `pnpm test`：X 通过 / Y 失败（说明）
- `pnpm build`：通过
- `cargo clippy`：通过

## 关联 Issue
- closes #...

## 截图 / 录屏
- （如有 UI 改动）
```

## 5. 新增前端模块

按以下步骤新增一个 `<module>`：

1. **创建目录**：`src/modules/<module>/`。
2. **入口文件**：`index.ts` 仅 re-export 类型、composable、注册函数。
3. **Pinia store**（如需要）：`<name>Pinia.ts`，setup-function 模式。
4. **Tauri 调用**：所有 IPC 走 `@/lib/native`，不直接 `invoke`。
5. **注册命令**（如需要）：在 `src/modules/commands/<name>Commands.ts` 中通过 `commandSpecs` 注册。
6. **设置分区**（如需要）：新增 `src/settings/sections/<Module>Section.vue`，并在 `tabs.ts` 注册。
7. **i18n key**：在 `src/modules/i18n/locales/zh-CN.ts` 和 `en-US.ts` 中加 key。
8. **测试**：`*.test.ts` 与 `*.vue.test.ts` co-located；如涉及跨模块边界，加 `*Boundary.test.ts`。
9. **文档**：`docs/architecture/<module>/README.md` + `detailed-design.md`，并在 `docs/architecture/README.md` 索引中添加。

## 6. 新增 / 修改 Tauri 命令

1. **Rust 实现**：在 `src-tauri/src/modules/<domain>/` 添加 `#[tauri::command]`，参数 `workspace: Option<WorkspaceEnv>` 必填。
2. **注册**：在 `src-tauri/src/lib.rs::invoke_handler` 列表中添加。
3. **授权**：在 `WorkspaceRegistry` 之外执行的命令必须先过 `authorize_*`。
4. **前端类型**：`src/lib/native.ts` 添加方法签名 + JSDoc，类型与 Rust 完全一致。
5. **调用方**：在需要该命令的模块的 composable / 组件中通过 `native.*` 调用。
6. **文档**：在对应模块 README 的"Tauri 命令"表添加一行；如影响全局架构，更新 `01-overview.md`。

## 7. WSL 构建

`nexterm-agent` 是独立 crate(经 musl 静态编译后由 `build.rs` 自动内嵌
主程序;watcher 能力已并入 agent 的 `watch` 子命令):

```bash
cd src-tauri
# 纯 Rust 依赖,Windows 宿主可在 WSL 内用 rust-lld 链接
RUSTFLAGS="-C linker=rust-lld" cargo build -p nexterm-agent --release --target x86_64-unknown-linux-musl
```

产物位于 `target/x86_64-unknown-linux-musl/release/` 时会被 `build.rs`
自动探测并 `include_bytes!` 内嵌;缺失时对应功能自动降级(agent → legacy
`wsl.exe` 路径,watcher → 轮询),不影响发布。agent 端到端冒烟：

```bash
cargo run --example agent_smoke -- Ubuntu /tmp
```

agent `watch` 子命令的 stdout 输出约定(每 notify 事件一行):

```json
{"paths":["/home/..."],"gitRelated":false,"kinds":["create"]}
```

主进程通过 spawn + readline 消费,转换成 `WorkspaceFsChangedEvent` 发给前端。

## 8. 发布前检查

- [ ] `pnpm i --frozen-lockfile` 通过
- [ ] `pnpm build` 通过
- [ ] `pnpm tauri build`（macOS / Windows / Linux 各自平台）
- [ ] `cargo clippy --all-targets --locked -- -D warnings` 通过
- [ ] 没有未提交的 `.env` / 本地配置
- [ ] `dist/` 与 `src-tauri/target/` 不在 git 索引中
