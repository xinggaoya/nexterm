# Web 化重构（web-server）

> 状态：**设计阶段**，尚未实施。本文是方向决策与技术方案，不是实现计划。
> 涉及 `nexterm-core` / `nexterm-server` 两个新 crate，以及 `src/lib/native.ts`
> 的形态调整。

## 0. 背景：这个方向做过一次

`git show b0dd854` —— 仓库里曾经有一套 axum + WebSocket 的远程终端：

- `src/remote/RemoteApp.vue`（227 行精简 UI）+ `src/remote/main.ts` + `remote.html`
- `src-tauri/src/modules/remote/mod.rs`（497 行，含 `PtyRemoteSession` 平行实现）
- token 拼在 URL query（`/?token=...`），绑 `0.0.0.0`
- 输出用 80ms 轮询 + `sinceOffset` + base64 拉取

该特性被整体删除（−2261 行），并新增 `src/app/noRemoteTerminalBoundary.test.ts`
作为防回流边界测试。

**它失败的原因不是技术选型，是架构方式**：新建了一套 UI + 一套 PTY 实现，
等于把项目做了两遍，两个实现各自漂移。

本次方案与它的根本区别：

| | 旧方案（已删除） | 本方案 |
|---|---|---|
| UI | `RemoteApp.vue` 精简副本 | **同一份 SPA**，不 fork |
| 终端 | `PtyRemoteSession` 平行实现 | **同一个 `TerminalSession` trait** |
| 输出 | 80ms 轮询拉取 | WS 推送 + offset 续传 |
| 目标 | 浏览器能看终端 | 服务端成为唯一状态权威 |

**铁律：不 fork UI，不 fork RPC 实现。** 这条要用边界测试钉死（见 §9）。

---

## 1. 已确认的决策

| 决策点 | 结论 |
|--------|------|
| 服务端形态 | **内嵌在桌面应用进程内**（`nexterm` 启动时拉起 server） |
| 桌面窗口链路 | **也走本地 server**（WebView 加载 `http://127.0.0.1:<port>`） |
| 移动端定位 | **全功能等价**（终端 / 编辑 / git 完整可用） |
| 外部访问安全 | 本期不做（见 §10 的默认取值说明） |

**决策 1 + 2 的重要推论（简化）**：

"桌面也走本地 server" 让 Tauri IPC 从主链路上彻底退场。原来
`native.ts` 需要同时照顾 `invoke` 和未来的 `fetch` 两条路；现在变成：

- **ServerDriver** —— pty / fs / git / shell / lsp / ssh / agent / workspace
  **全部**走 JSON-RPC。Tauri 版本的这部分**整体退役**。
- **DesktopShellDriver** —— 只剩纯 OS 集成：
  `dialog` / `notification` / `clipboard-manager` / `opener` /
  `updater` / `autostart` / `deep-link` / 窗口控制。

RPC 实现从 2 份变回 1 份，`nativeBoundary.test.ts` 的断言反而更简单
（"业务能力只有一条出口"），而不是更复杂。这是本次选择的最大收益。

**决策 1 的约束（必须写明）**：内嵌 server 意味着**桌面应用退出 = 所有
PTY 消失 = 手机断连**。多端能力以"应用常驻（托盘）"为前提。
→ 因此 server 必须按**可独立成守护进程**的形状写（§2.3），这是本方案
唯一的硬性架构约束，用来给未来的 `nextermd` 留缝。

---

## 2. 目标拓扑

```
┌──────────────────────────────────────────────────────────────────┐
│  nexterm 进程（Tauri）                                             │
│                                                                   │
│  ┌────────────────────────────────────────────────────────────┐  │
│  │  Supervisor —— 唯一允许出现 tauri 类型的地方                  │  │
│  │  · 解析端口 / 启动 ServerCore / 就绪握手                     │  │
│  │  · 托盘、通知、深链、更新、窗口生命周期                       │  │
│  └─────────────────────────┬──────────────────────────────────┘  │
│                            │ start / stop                        │
│  ┌─────────────────────────▼──────────────────────────────────┐  │
│  │  nexterm-server（axum，**不依赖 tauri crate**）                │  │
│  │  · 静态资源 dist/（或 dev 时交回 Vite）                       │  │
│  │  · POST /api/rpc   —— 一次性请求（JSON-RPC 2.0）             │  │
│  │  · GET  /api/stream —— 单连接多路复用（JSON-RPC over WS）    │  │
│  └─────────────────────────┬──────────────────────────────────┘  │
│                            │ Arc<CoreHandle>                      │
│  ┌─────────────────────────▼──────────────────────────────────┐  │
│  │  nexterm-core —— 状态权威                                   │  │
│  │  pty │ fs │ git │ shell │ lsp │ ssh │ agent │ workspace      │  │
│  │  ★ sessions / terminals / workspaces / layout 全部在此       │  │
│  └─────────────────────────┬──────────────────────────────────┘  │
└────────────────────────────┼─────────────────────────────────────┘
                             │ HTTP + WebSocket（127.0.0.1:port）
            ┌────────────────┴─────────────────┐
            │                                  │
   ┌────────▼─────────┐              ┌─────────▼──────────┐
   │  Tauri WebView   │              │ 浏览器（PC/手机）    │
   │  同一份 SPA       │              │  同一份 SPA          │
   └──────────────────┘              └────────────────────┘
```

### 2.1 一份 SPA

`src/` **不新增第二个入口**。`index.html` 构建产物同时被：

- Tauri WebView 通过 `http://127.0.0.1:<port>` 加载
- 任何浏览器通过同一地址加载

移动端与桌面端**跑的是完全相同的字节**。响应式差异只在运行时按
`viewport` / 设备能力切换布局，不做两套组件树。

### 2.2 dev 与 prod 的 origin 差异

| 模式 | SPA 来源 | RPC 端点 |
|------|---------|---------|
| `pnpm tauri dev` | Vite `:3180` | 同源代理到 `127.0.0.1:<port>` |
| `pnpm build` + 桌面 | Rust server 托管 `dist/` | 同源 `127.0.0.1:<port>` |
| 浏览器 dev | Vite `:3180` | 同源代理 |

**设计规则：ServerDriver 只用相对 URL（`/api/rpc`、`/api/stream`），
base 在启动时注入一次。** 绝不能硬编码 `http://127.0.0.1:7777`，
否则 dev 模式和浏览器直连都会坏掉，且 HMR 会因为跨源而失效
（HMR 需要 Vite 自己的 origin 提供 ws）。

dev 下由 `vite.config.ts` 的 `server.proxy` 把 `/api`（含 ws）转发到 Rust。

### 2.3 crate 拆分

```
src-tauri/
  src/                 nexterm        (Tauri 主程序 = Supervisor)
  core/                nexterm-core   纯业务，不依赖 tauri
  server/              nexterm-server axum 传输层，不依赖 tauri
  agent/               nexterm-agent  （已有，协议共享）
  fs-core/             nexterm-fs-core（已有）
```

**`nexterm-core` 的定义性约束：一个字都不能出现 `tauri`。**
这是整个方案的地基。当前 49 个 `#[tauri::command]` 全部要过一遍：

| 现在 | 改为 |
|------|------|
| `tauri::State<'_, PtyState>` | `&Arc<PtyState>` |
| `tauri::ipc::Channel<String>` | `&dyn OutputSink`（`fn on_data(&self, chunk: &str)`） |
| `tauri::AppHandle` | `&dyn CoreEvents`（emit fs-changed / deep-link / 进度） |
| `#[tauri::command]` | 纯 `fn` / `async fn` |

`nexterm-server` 同样不依赖 tauri。它只拿 `Arc<CoreHandle>`。
`src-tauri/src/lib.rs` 退化为 Supervisor：解析配置 → `start()` → 等就绪 →
创建窗口指向 `http://127.0.0.1:<port>`。

**"可抽出守护进程"由此自然成立**：

```
nextermd = main() { serve(CoreHandle::new(config)) }   // 未来，无需改 core/server
```

---

## 3. 协议：JSON-RPC 2.0

选它的三条硬理由：

1. **项目里已有 JSON-RPC** —— `vscode-jsonrpc` + `src/modules/lsp/lspTransport.ts`
   已经在跑一套。多路复用、双向流、命名 id，全部现成，认知成本为零。
2. **能直接长成今天的 Tauri 命令** —— `pty_open` 变一个 method，
   `onData`/`onExit` 变该 id 上的 notification。
3. **一条 WS 承载全部流** —— PTY 输出、fs watcher、LSP 报文、搬运进度、
   深链，按 target id 复用同一条连接。不为每种流开不同连接。

`src/lib/native.ts` 现有那 963 行类型定义**就是 schema**，不重写。

### 3.1 方法映射

现有 49 个命令名、参数名、返回结构**原样保留**，只换通道：

| 今天 | RPC method | 流 |
|------|-----------|-----|
| `pty_open` | `pty.open` | 返回 id；`pty.data` / `pty.exit` 为该 id 的 notification |
| `pty_write/resize/close/kill` | `pty.write/resize/close/kill` | — |
| `fs_read_dir` … | `fs.readDir` … | — |
| `git_*` | `git.*` | — |
| `fs_watch_workspace` | `fs.watchWorkspace` | `fs.changed` 事件（保持 200ms 批窗口） |
| `lsp_*` | `lsp.*` | LSP 报文走上同一条 WS |

### 3.2 双通道分工

| 通道 | 用途 | 理由 |
|------|------|------|
| `POST /api/rpc` | 一次性请求/响应 | 可缓存语义简单、无状态、易调试（curl 就能测） |
| `WS /api/stream` | PTY / watcher / LSP / 进度 / 通知 | 长连接、有序、低开销 |

`terminalSessionCore` 走 WS；`fsReadDir` / `gitStatus` 走 POST。

---

## 4. 前端分层

```
业务模块（21 个，零改动）
      │
native.ts（形态不变：createNativeForEnv(env) → 方法对象）
      │
   ┌──┴────────────────────────┐
   │                            │
ServerDriver            DesktopShellDriver
JSON-RPC over HTTP/WS     tauri invoke（仅 OS 集成）
```

`native.ts` 里现有的 `WorkspaceNative` 类型、`ptyOpen()` 签名、
`onFsTransferProgress` 全部保留。**调用点一行不改。**

### 4.1 能力矩阵

浏览器没有的能力由服务端在 `system.capabilities` 里声明，前端按能力降级：

| 能力 | 桌面 WebView | 浏览器 | 降级方案 |
|------|-------------|--------|---------|
| 目录选择 | `dialog` 原生 | ❌ | 服务端目录浏览选择器 |
| 文件拖入 | Tauri drag-drop（物理像素） | ❌ | HTML5 DnD + `/api/fs/upload` |
| 系统通知 | `notification` | ❌ | Web Notifications API |
| 剪贴板 | `clipboard-manager` | 部分 | `navigator.clipboard` |
| 深链 | `deep-link` | ❌ | URL query |
| 自动更新 | `updater` | ❌ | 服务端通告 |
| 窗口控制 | `tauri` window | ❌ | 响应式布局，不显示 |

这是"单代码路径"要付的税，必须提前认，不能等到阶段 7 才发现。

---

## 5. 状态模型（最大的语义变更）

### 5.1 今天

| 状态 | 位置 |
|------|------|
| PTY 进程与 handle | **客户端** `PtyState.sessions` |
| tab 树 / 分屏树 | **客户端** `tabsPinia` |
| 终端布局 | 客户端 Tauri `LazyStore` |
| 偏好 | 客户端 Tauri `LazyStore` |

### 5.2 之后

| 状态 | 位置 | 理由 |
|------|------|------|
| PTY 进程与 handle | **服务端** | 多端共享的物理资源 |
| 终端 / 工作区注册表 | **服务端** | 多端要看到同一批 |
| 终端布局 | **服务端** | 关掉应用重开要恢复（现状已只恢复"意图"） |
| 工作区列表 | **服务端** | 同上 |
| 主题 / 字号 / 语言 / 编辑器行为 | **客户端** `localStorage` | 设备相关，不该跟服务器跑 |
| 当前选中 tab / 分屏比例 / 滚动位置 | **客户端** `localStorage` | 纯视图，设备相关 |

`tabsPinia` 从"事实来源"退化为**服务端状态的本地投影**：本地乐观更新
+ 服务端事件校正。

`PreferenceStore` 必须**拆成 ClientPrefs / ServerPrefs 两份**。这条搞错的话，
换台电脑主题会跟着服务器跑。

### 5.3 多客户端 attach 模型

全功能等价 ⇒ 同一个终端可能被多台设备同时看。推荐：

- **多订阅者（multi-attach）**：所有设备都收同一份输出流
- **单写者（single input lock）**：只有持锁设备能输入，锁状态可见且可抢占
- 移动端需要**会话/终端注册表 UI**（attach 到别的设备开的终端）——
  这是今天不存在的全新界面，因为今天 `tabsPinia` 就是"有哪些终端"的唯一真相

> 参考：`ttyd` / 屏幕共享类工具的成熟做法。锁定比"最后 attach 获胜"体验好，
> 不会让用户莫名其妙失去输入权。

### 5.4 断线与重连

PTY **必须服务端持有且可重新挂载**。复用现有 `Transcript` 临时文件 +
`read_transcript` + offset 机制（上一版远程实现里用对了的部分）：

- 客户端 attach 时带 `sinceOffset`
- 服务端回 `snapshot`（transcript 尾部）+ 后续增量
- 移动端浏览器被系统杀后台 → 终端不受影响，重开自动接上

**PTY over WebSocket 的背压**：浏览器 WS 无背压信号，`cat` 大文件会撑爆
服务端内存。必须做：

- 复用已有 `FLUSH_COALESCE = 6ms` 合并
- 每 session 有界队列；超限降级策略要显式决定（丢中间帧 / 暂停 PTY 读）
- 关闭 `permessage-deflate`（终端可压缩性高，压缩只增 CPU）

---

## 6. 移动端（阶段 7）

现在的 shell 是固定三栏（`Sidebar + TopBar + Canvas + StatusDock`），
在 375px 宽不成立。这是**设计工作不是管线工作**：

- 响应式布局：Sidebar 收进抽屉，SessionStrip 收进横向滚动
- `usePointerDragReorder` 是 pointer-only，移动端需 touch 分支
  （`src/lib/touchDevice.ts` 已有基础）
- xterm.js 移动端软键盘/长按选区体验差 → 面板化命令输入 + 命令面板
- 拖文件进工作区走 HTML5 DnD + 上传接口

---

## 7. 风险与对策

| 风险 | 等级 | 对策 |
|------|------|------|
| **启动时序** —— 窗口在 server 就绪前加载 → 白屏 | **最高** | server 就绪握手后才 `window.show()`；失败弹**原生**错误对话框，绝不留白 webview。现有 `main.ts` 的 50ms/500ms `window.show()` 就是这个钩子 |
| **端口占用** | 高 | 可配置端口 + 占用时向上扫描 + 占用时明确提示而非静默失败 |
| **CSP** | 高 | `tauri.conf.json` 的 `connect-src` 需放行 `ws://127.0.0.1:*`（当前只有 `http://`，没有 `ws://`） |
| dev 下 HMR 失效 | 中 | Vite `server.proxy` 转发 `/api`（含 ws），WebView 仍加载 `:3180`；ServerDriver 全用相对 URL |
| 49 个命令解耦面广 | 中 | 纯机械改造，**先做完再动前端**；每步 `cargo clippy` 保持绿灯 |
| 移动端 iOS Safari 后台杀进程 | 中 | 服务端持有 PTY + offset 续传（§5.4） |
| 状态上移的语义 bug | 中 | 投影 + 校正；多设备并发时用操作日志而非快照同步 |

---

## 8. 阶段计划

每阶段有明确退出标准，**前一阶段没达标不进下一阶段**。

| # | 内容 | 退出标准 |
|---|------|---------|
| 0 | 文档与决策固化 | 本文；`noRemoteTerminalBoundary` 语义改写为"唯一实现" |
| 1 | **`nexterm-core`**：49 个命令去 tauri 化 | `cargo test -p nexterm-core` 通过；`grep -r "tauri" core/` 为空 |
| 2 | **ServerDriver** 落地（先只读） | 浏览器里能读文件树 / git 面板 / 编辑文件；21 个模块零改动通过 `vue-tsc` + `pnpm test` |
| 3 | **PTY over WS** | 浏览器开终端、可断线重连、`cat` 大文件不 OOM |
| 4 | **状态上移** | 关掉手机浏览器 → 电脑终端不受影响；重开自动接上 |
| 5 | **桌面收敛** | WebView 改指 `http://127.0.0.1:<port>`；TauriDriver 业务部分删除 |
| 6 | 能力矩阵降级 | 逐项在浏览器验证 §4.1 表格 |
| 7 | 移动端 UX | 375px 真机全功能可用 |

阶段 2 是第一个"能给人看"的里程碑，**拿它做后续决策依据**。
阶段 4 之前不碰移动端。

---

## 9. 测试与边界

| 测试 | 断言 |
|------|------|
| `coreBoundary.test.ts`（新） | `src-tauri/core/` 源码不含 `tauri` 字样 |
| `nativeBoundary.test.ts`（改） | 业务能力**只有** `/api/rpc` 一条出口；`invoke` 只允许出现在 `DesktopShellDriver` |
| `driverContract.test.ts`（新） | 同一套契约用例跑在 ServerDriver 上（不再有两份实现可对比） |
| `serverBoundary.test.ts`（新） | `server/` 不含 `tauri` |
| `noRemoteTerminalBoundary.test.ts`（改写） | 从"禁止远程入口"改为"**禁止第二套 UI / 第二套 RPC 实现**" |

`pnpm test` + `pnpm build` + `cargo clippy --all-targets --locked -- -D warnings`
保持为 PR 门禁。

---

## 10. 安全（本期不展开，但默认值要选对）

本期不做鉴权体系设计。但**默认值选错会导致不可逆的损伤**，所以先定死：

1. **默认只绑 `127.0.0.1`** —— 这是一个默认值选择，不是安全架构，成本为零，
   但把"局域网 RCE"降级为"只有本机能碰"。
2. 对外监听是**显式开关**，默认关闭。
3. Token 永不出现在 URL（URL 会进 history / referrer / 日志）。

真正对外暴露前必须补齐的（记在此处，避免遗忘）：
bootstrap token 一次性交换 + `HttpOnly` cookie、`Origin`/`Host` 白名单
校验（DNS rebinding 防御）、设备配对与能力分级、审计日志、TLS 或隧道。

> 内嵌 server 还有一个附带好处：token 只需在 loopback 上传一次，
> 比 LAN 暴露场景少一大块攻击面。

---

## 11. 未决问题

- 端口策略：固定端口 vs 随机端口？（随机端口对"手机扫二维码"友好，
  但用户找不到地址；固定端口体验好但会冲突）
- `dist/` 嵌入二进制（`include_dir!`）还是运行时读磁盘？
  前者单文件分发，后者和 Vite dev 更顺。
- 多客户端的输入锁：是"最后 attach 获胜"还是"显式锁 + 可见 + 可抢占"？
  本文档推荐后者，待确认。
- 移动端是否需要 PWA（可添加到主屏 / 离线壳）？还是纯浏览器 tab 即可？
