# 07. 浏览器调试桥

> 本文说明 Nexterm 集成的 `tauri-plugin-web-dev-bridge`：用途、启用方式、使用流程、
> 安全模型，以及若干条必须知道的边界。
>
> 上游仓库：<https://github.com/xinggaoya/tauri-plugin-web-dev-bridge>

## 1. 用途

Tauri 应用的后端只能通过 `window.__TAURI_INTERNALS__.invoke()` 触达，而桌面端这条通路
最终落在 WebView 的 `ipc://` 自定义协议上 —— **普通浏览器访问不到**。

于是「把前端页面丢进浏览器调试」时，页面能打开，但每一个后端调用都会炸：

```
TypeError: Cannot read properties of undefined (reading 'transformCallback')
TypeError: Cannot read properties of undefined (reading 'invoke')
```

调试一个 UI 问题要付出「改代码 → 重新打包桌面端 → 点一下 → 看日志」的十分钟等待。

浏览器调试桥在**应用进程内**架起一座本地调试桥：它只监听 `127.0.0.1` 的一个 HTTP 端口，
把浏览器的 `POST /invoke` 合成为一条**真实的** Tauri IPC 消息（带 `invoke_key`），投喂给
正在运行的应用。因为走的是应用自己的命令处理器，浏览器里的每一次点击都等价于在桌面窗口里
点击 —— 切工作区会真的切，读文件会真的读。

```text
浏览器  ──HTTP POST /invoke──▶  桥（127.0.0.1:port）
                                   │  合成 InvokeRequest（带 invoke_key）
                                   ▼
                                运行中的 Tauri App
                                   │  真实命令处理器
                                   ▼
浏览器  ◀──JSON 响应──────────  桥

浏览器  ◀──短轮询 /events─────  桥 ◀──Rust Listener◀──app.emit(...)
```

它**不是** mock：浏览器里看到的就是真实数据。

典型场景：

- 调文件树 / Git 面板 / 编辑器的布局与交互，不用反复重启桌面端；
- 用 AI 浏览器自动化工具（Playwright / CDP 生态）跑端到端流程；
- 在移动端窄屏视口下调试响应式布局（WebView 窗口尺寸不好精确控制）。

## 2. 组成与安装

| 层 | 位置 | 作用 |
|----|------|------|
| Rust 插件 | `src-tauri/Cargo.toml` → `tauri-plugin-web-dev-bridge`（optional） | 在应用进程内开 HTTP 服务，合成 IPC 消息 |
| Rust 接线 | `src-tauri/src/lib.rs` | 注册插件、在 `setup` 里 `start(app)`、约束 CORS 来源 |
| vite 插件 | `vite.config.ts` → `webDevBridgeVitePlugin()` | 把桥的 `{ port, pid, url }` 以**同源** JSON 暴露给前端 |
| 前端封装 | `src/lib/devBridge.ts` | 探测桥是否就绪、安装浏览器侧 shim、决定启动模式 |
| 启动编排 | `src/main.ts` | 桥不可用时挂「未就绪」提示页，而不是白屏 |

依赖来自 git 并锁定 commit（插件尚未发布到 crates.io / npm）：

```toml
tauri-plugin-web-dev-bridge = { git = "https://github.com/xinggaoya/tauri-plugin-web-dev-bridge", rev = "13d894827b14b9e7c510535b8a957383a4972dcd", optional = true }
```

## 3. 启用方式：默认关闭，按需开启

### 3.1 为什么要默认关闭（重要）

桥一旦启动，本机就多了一个 HTTP 端点，而 Nexterm 的 IPC 能**写文件、起进程、走 SSH**。
所以它必须显式 opt-in：

- Cargo feature `web-dev-bridge` **不在默认 feature 集合**里；
- Rust 侧还有一道 `cfg!(debug_assertions)` 兜底 —— 即便用
  `--release --features web-dev-bridge` 构建，release 产物也**不会**监听端口；
- 依赖始终是 `optional = true`。

这三条都有边界测试守着（`src-tauri/tests/web_dev_bridge_feature_boundary.rs`）。

### 3.2 怎么开

```bash
# 启动带调试桥的桌面应用
pnpm tauri dev -- --features web-dev-bridge
```

只编插桩不进产物时用 `cargo build --features web-dev-bridge`。

### 3.3 使用流程

1. 用上面的命令启动桌面应用（终端里会看到 `浏览器调试桥已启动：...`）。
2. 用**普通浏览器**打开 <http://localhost:3180>（vite dev server 的地址）。
3. 页面会自动接管 `window.__TAURI_INTERNALS__`，之后的每一次后端调用都走桥。

> ⚠️ **必须用 `http://localhost:3180` 打开**，不要用 `http://127.0.0.1:3180`。
> 桥的 CORS 白名单只认 `http://localhost:3180`（与 `tauri.conf.json` 的 `build.devUrl`
> 同源，有契约测试守着）。用 `127.0.0.1` 打开时，页面能渲染，但跨源调用会被浏览器拦掉。

## 4. 安全模型

| 面 | 约束 |
|----|------|
| 监听地址 | 只监听 `127.0.0.1`，外部机器不可达 |
| 构建形态 | 仅 debug 构建 + 显式 `--features web-dev-bridge`，release 永不监听 |
| 浏览器来源 | 仅 `http://localhost:3180`（`Access-Control-Allow-Origin`） |
| 端口 | 默认 6222；被占用时自动退化为系统随机端口（前端经描述文件发现，仍是零配置） |

收紧 CORS 的目的很具体：**防止你随便打开一个网站，那个网站就能驱动你本机的 nexterm。**
没有这条约束，任何网页都能往 `http://127.0.0.1:6222/invoke` 发请求。

### 4.1 残余风险（务必知道）

**CORS 只约束浏览器。** `curl`、Python 脚本、其它本机程序不受它约束 —— 本机任意进程都
可以调用完整的 IPC 面（写文件、起进程、走 SSH）。这是 localhost 调试桥的固有属性，
任何同类方案都绕不开。

能做的只是把暴露窗口收窄，这也是默认关闭 + 仅 debug 的意义：

- 桥只在**你显式开了 feature**、且**应用正在运行**的那段时间里存在；
- 关掉桌面应用，端口就没了；
- 桥本身不落盘任何凭据，`invoke_key` 只在进程内存里。

## 5. 已知边界

### 5.1 PTY / LSP 的流式输出过不了桥

Rust 侧 `Channel<T>` 反序列化的是 `"__CHANNEL__:<id>"` 字符串，发送时走
`webview.eval(runCallback(id))` —— 目标是**桌面 webview**，不是浏览器。

所以浏览器里 `pty_open` 会成功，但**收不到任何输出**；而且 callback id 与桌面端不同源，
存在串扰风险。

实测表现：浏览器里打开终端标签页，后端会**真的开一个 shell**（PTY 是真的），
但输出永远过不来，于是前端的启动看门狗在 8s 后报
`shell produced no output within 8000ms, treating as dead start`。

> **终端与 LSP 的流式行为仍在桌面端验证。** 浏览器调试桥覆盖的是 UI、布局、
> 文件树、Git、偏好等非流式能力。

（Nexterm 已有 `pty_read_transcript` 命令，将来若要做轮询降级，路径是现成的。）

### 5.2 webview 作用域的 API 不可用

桥的 shim 只提供 `__TAURI_INTERNALS__.metadata.currentWindow`，**不提供**
`currentWebview`。于是 `@tauri-apps/api/webview` 的 `getCurrentWebview()` 读
`metadata.currentWebview.label` 会拿到 `undefined` 而抛错。

Nexterm 的 OS 文件拖放监听正是这么实现的，所以浏览器里拖放不可用 —— 但代码里
有 try/catch 降级，控制台只会留一条 warning，不会把页面搞崩。

### 5.3 webview 级事件收不到

桥在 Rust 侧注册的是 **app 级**监听（`app.listen`）。以 `webview.emit()` 作用域发出的
事件（例如 `tauri://close-requested`）不会送达浏览器。

app 级事件（如 `nexterm://workspace-fs-changed`、`nexterm://deep-link-open`）是正常的。

### 5.4 `plugin:window:*` 作用于真实窗口

在浏览器里调用窗口命令，作用的是**真实的桌面窗口** —— 点关闭，桌面窗口真的会关。
这正是「像在桌面窗口里点一样」的预期行为。

### 5.5 浏览器里走的是真实后端

`hasTauriInternals()` 在装了 shim 的浏览器里为 `true`，于是偏好 hydrate、事件订阅、
拖放监听等分支全部激活 —— 这是想要的效果（能拿到真实偏好与真实事件）。

副作用：自动更新检查会真的打到更新接口，可能在浏览器里弹出更新提示。

### 5.6 事件用短轮询而非长连接

桥的事件通道是**短轮询**（`GET /events`）而不是 SSE / WebSocket —— 长连接会让浏览器
自动化工具的 *networkidle* 判定永远无法达成（`agent-browser open` 之类的命令会一直挂起）。

## 6. 常见问题

| 现象 | 原因与处理 |
|------|-----------|
| 页面显示「调试桥未就绪」 | 桌面应用没带 feature 启动，或还没启动。用 `pnpm tauri dev -- --features web-dev-bridge` 启动后点「重新检测」。 |
| 桌面应用已经被强杀，页面却提示「已就绪」后又变白屏 | **已修复**：探测是两步的（发现路由 + 桥自己的 `/health`）。描述文件是应用启动时写下的，应用被强杀时不会清理，于是「端口在、进程没了」的残留会让单看发现路由的探测误判。 |
| 页面能渲染，但每个后端调用都失败（控制台报 CORS） | 页面不是从 `http://localhost:3180` 打开的。改用该地址。 |
| 提示「未找到调试桥」 | 桌面应用没启动，或 Rust 侧起桥失败（看应用日志里的 `启动浏览器调试桥失败`）。 |
| 桥的端口不是 6222 | 默认端口被占用，桥自动退化为系统随机端口。这是正常行为 —— 前端经描述文件发现，无需配置。 |
| 终端没有输出 | 见 §5.1，这是已知边界，不是配置问题。 |
| 应用日志里看不到插件自己的日志 | 插件用 `tracing` 打日志，Nexterm 只装了 `log` 的 logger。Nexterm 自己那条 `浏览器调试桥已启动` 是 `log::info!`，能看到。 |

## 7. 相关文件

| 文件 | 作用 |
|------|------|
| `src-tauri/src/lib.rs` | 插件注册、`setup` 启动、`DEV_BRIDGE_ALLOWED_ORIGIN` |
| `src-tauri/Cargo.toml` | `web-dev-bridge` feature 与可选依赖 |
| `src-tauri/tests/web_dev_bridge_feature_boundary.rs` | feature / optional / rev 锁定的边界测试 |
| `src/lib/devBridge.ts` | 探测、安装 shim、决定启动模式 |
| `src/lib/devBridge.test.ts` | 上述三件事的单测 |
| `src/app/components/DevBridgeUnavailable.vue` | 「未就绪」提示页 |
| `src/app/devBridgeFallback.ts` | 提示页的挂载入口 |
| `src/main.ts` | 启动编排 |
| `vite.config.ts` | `webDevBridgeVitePlugin()` 发现端点 |
