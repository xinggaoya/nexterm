# 06. CrabNebula DevTools

> 本文说明 Nexterm 集成的 [CrabNebula DevTools](https://crabnebula.dev/devtools/)：用途、启用方式、
> 使用流程，以及与现有日志体系（`tauri-plugin-log`）的配合关系。
>
> 上游文档：<https://v2.tauri.app/zh-cn/develop/debug/crabnebula-devtools/> 、<https://docs.crabnebula.dev/devtools/get-started/>

## 1. 用途

CrabNebula DevTools 是 Tauri 官方推荐的**后端**调试工具：给 Rust 侧插桩，把运行期的
Tauri IPC 调用、事件、日志与耗时采集下来，在 Web UI 里实时可视化。

对 Nexterm 来说，它补齐的是 Webview 检查器（`toggle_devtools`）看不到的部分：

| 能力 | Webview 检查器 | CrabNebula DevTools |
|------|----------------|---------------------|
| 前端 DOM / CSS / 控制台 | ✅ | ❌ |
| 后端 `log::` 日志（按 target / 级别过滤） | ❌ | ✅ |
| Tauri 命令调用的入参、返回值、耗时 | ❌ | ✅ |
| Tauri 事件（`app.emit` / `listen`）收发 | ❌ | ✅ |
| panic 位置（配合 `panic_report`） | ❌ | ✅ |

典型场景：终端/PTY 卡住、WSL 命令无响应、Git 操作超时、某个 Tauri 命令偶发失败 —— 用它看清
"前端调了哪个命令、带了什么参数、后端在哪一步慢/错"。

> 与 Webview 检查器的关系：后者由 Cargo feature `devtools`（`tauri/devtools`）控制，
> 探测命令是 `devtools_available`；本文的 CrabNebula 插桩是**另一套东西**，
> 由 Cargo feature `crabnebula-devtools` 控制，探测命令是 `crabnebula_devtools_available`。
> 两者互不影响。

## 2. 组成与安装

项目里装了两个 Rust crate（见 `src-tauri/Cargo.toml`）：

| crate | 作用 |
|-------|------|
| `tauri-plugin-devtools` | 后端插桩：本机 HTTP 服务（默认 `127.0.0.1:3033`），对外暴露命令/事件/日志 |
| `tauri-plugin-devtools-app` | 嵌入式 UI：在 Nexterm 里以**独立窗口**打开 DevTools 面板 |

两个 crate 都是**可选依赖**，由 Cargo feature `crabnebula-devtools` 统一开启，
**默认关闭**（原因见 §3）。

配套改动：

| 位置 | 改动 |
|------|------|
| `src-tauri/src/modules/devtools.rs` | 插件初始化 + 日志桥接（日志目录解析、stdout/文件输出） |
| `src-tauri/src/lib.rs` | 编译了 feature 时注册插件；`tauri-plugin-log` 在该情况下让出全局 logger；新增 `crabnebula_devtools_available` 命令 |
| `src-tauri/build.rs` | 按 feature 生成 `capabilities/crabnebula-devtools.json`（生成物不入库） |
| `src/lib/native.ts` | `crabnebulaDevtoolsAvailable()` / `toggleCrabnebulaDevtools()` 封装 |
| `src/lib/devtoolsContextMenuGuard.ts` | 吞掉插件原生右键菜单命令被拒时产生的未捕获 rejection |
| `src/settings/sections/GeneralSection.vue` | 设置 → 通用 → 开发者 →「打开后端调试面板」入口（仅在能力可用时显示） |

## 3. 启用方式：默认关闭，按需开启

插件**默认不编译**，也不启动插桩服务、不暴露本地端口。

### 3.1 为什么要默认关闭（重要）

`tauri-plugin-devtools` 依赖 `tauri/tracing` feature。这个 feature 会改变
`tauri-runtime-wry` 的 `eval_script` 实现：

- **关闭** `tauri/tracing`：fire-and-forget —— 把脚本消息丢给 UI 线程就返回；
- **开启** `tauri/tracing`：`tauri-runtime-wry-2.x/src/lib.rs` 走
  「发消息给 UI 线程 + 阻塞等回执」的 channel 往返。

于是任何**在 IPC handler 里 `app.emit`** 的命令都会与 WebView2 的
`WebResourceRequested` 回调互等：

- UI 线程：在 `WebResourceRequested` 里等这条 IPC 命令返回；
- 命令：在 `ExecuteScript` 的完成回调里等 UI 线程来执行脚本。

两边互等 ⇒ **永久死锁**：窗口变成"未响应"，所有 IPC 停摆（终端永远停在"启动中…"、
文件树空白、Git 面板空）。能被这条路径触发的事件在真实使用里很常见：
`tauri-plugin-store` 的 `set`（偏好持久化）、`tauri-plugin-event` 的 `emit`。

实测（同一份 `nexterm-settings.json`，仅切换本 feature）：

| 构建 | `tauri/tracing` | 结果 |
|------|-----------------|------|
| 关闭 `crabnebula-devtools`（默认） | 关闭 | 启动正常，终端 / 文件树 / Git 面板全部工作 |
| 开启 `crabnebula-devtools` | 开启 | **永久挂死**，"未响应" |

> 这个死锁发生在 Tauri / wry 层，不是 Nexterm 的业务逻辑能绕开的。要在保留
> 后端插桩的同时避免它，需要上游把 `eval_script` 改回非阻塞，或让插桩插件
> 换一种不依赖 `tauri/tracing` 的采集方式。在那之前，本项目选择
> **默认不开、显式开**：宁可要时多打一个 flag，也不要让正式构建带着一颗定时炸弹。
>
> ⚠️ 这不是「release 才有的问题」：**开启 feature 的 debug 构建同样会随机挂死**
> （实测同一份设置下，有时正常启动、有时启动后几十秒内卡死 —— 它是竞态，
> 取决于「IPC 命令在途」与「命令 handler 里 `app.emit`」是否撞在一起）。
> 所以这个 feature 只适合「临时插一下、看完就关」，不适合当日常开发环境。

### 3.2 怎么开

```bash
# 仅编译期插桩（后端 HTTP 服务 + 嵌入式 UI 插件）
cd src-tauri && cargo build --features crabnebula-devtools

# 跑起来（开发）
pnpm tauri dev -- --features crabnebula-devtools
```

开启后：

- debug 构建会打印插桩服务地址（形如 `https://devtools.crabnebula.dev/dash/127.0.0.1/3033`）；
- 设置 → 通用 → 开发者 →「打开后端调试面板」入口出现；
- `Ctrl+Shift+M`（macOS `Cmd+Alt+M`）可以直接拉起面板。

### 3.3 三种打开方式

| 方式 | 操作 | 依赖 |
|------|------|------|
| 独立 Web UI | 复制终端打印的 `https://devtools.crabnebula.dev/dash/<host>/<port>` 到浏览器 | 能访问 `devtools.crabnebula.dev`（需要 CrabNebula 账号登录） |
| 嵌入式窗口 | 设置 → 通用 → 开发者 → 「打开后端调试面板」，或快捷键 `Ctrl+Shift+M`（macOS `Cmd+Alt+M`） | 能访问 CrabNebula 的线上服务 |
| 终端链接 | 启动时终端打印的链接 | — |

> **嵌入式形态说明**：实测嵌入式模式**不是抽屉，而是新建一个独立窗口**
> （WebView 标题 `CrabNebula DevTools`，URL 为 `http://isolation-<uuid>.localhost/`）。
> 该窗口加载的是 CrabNebula 的**线上 Web 应用**，因此需要外网 + 账号登录；
> 内网/离线环境下打不开。

CrabNebula DevTools 桌面端下载地址（若要改用桌面端作为 UI 载体）：
- Linux：<https://cdn.crabnebula.app/download/crabnebula/devtools-desktop/latest/platform/appimage-x86_64>
- macOS：<https://cdn.crabnebula.app/download/crabnebula/devtools-desktop/latest/platform/dmg-aarch64>（Intel 用 `dmg-x86_64`）
- Windows：<https://cdn.crabnebula.app/download/crabnebula/devtools-desktop/latest/platform/nsis-x86_64>

> 嵌入式模式是「应用内打开 DevTools UI」，但**数据采集**始终来自 `tauri-plugin-devtools`
> 的本机服务；桌面端只是 UI 载体。

## 4. 使用流程

1. 带上 feature 启动：

   ```bash
   cd src-tauri && cargo run --features crabnebula-devtools
   # 或 pnpm tauri dev -- --features crabnebula-devtools
   ```

2. 终端会看到插桩服务信息（形如）：

   ```text
      Tauri Devtools v2.2.3
      →   Local:   https://devtools.crabnebula.dev/dash/127.0.0.1/3033
   ```

   端口默认 `3033`；被占用时插件会自动改用空闲端口，链接里的端口即为实际端口。

3. 打开面板（二选一）：
   - 浏览器访问上面的链接；
   - 按 `Ctrl+Shift+M`（macOS `Cmd+Alt+M`）/ 在设置页点「打开后端调试面板」。

4. 在面板里按需查看：
   - **Commands**：每次 `invoke` 的命令名、参数、返回值、耗时；
   - **Events**：Tauri 事件的发送与订阅；
   - **Logs**：后端 `log::` 日志（按级别 / target 过滤，debug 级别在面板里可见）；
   - **Performance**：命令调用耗时分布。

5. 排查结束后直接关掉面板即可；插桩服务随应用进程退出。

## 5. 与 `tauri-plugin-log` 的关系（重要）

两个插件都想占用 **全局 `log` logger**，而全局 logger 只能有一个：

- `tauri-plugin-devtools` 初始化时安装全局 tracing subscriber，并通过
  `tracing-log` 的 `LogTracer` 抢占全局 `log` logger —— 之后所有 `log::info!` 等调用都会被转成 tracing
  event，从而出现在 DevTools 面板里；
- `tauri-plugin-log` 的 setup 也会 `log::set_boxed_logger` 抢占同一个槽位。

若两者都按默认方式启动，后注册的会失败，**应用将无法启动**。本项目的处理方式：

1. `devtools::init()` 在 `tauri::Builder` 之前调用，先拿到全局 `log` logger；
2. **编译了 `crabnebula-devtools` 时** `tauri-plugin-log` 使用 `skip_logger()`，只保留插件的
   `plugin:log|log` 命令（前端日志仍经 `log::logger()` 进入 tracing → DevTools）；
3. devtools 通过 `attach_logger` 把 tracing event 桥接回 **stdout + app 日志目录文件**，
   输出格式与 release 保持一致（`[时间][target][级别] 消息`）；
4. **没有编译该 feature 时** devtools 根本不存在，`tauri-plugin-log` 保持默认行为
   （stdout + 日志文件），debug 构建的日志**不会丢**。

因此：

- 开启 feature：后端日志同时出现在 **终端**、**日志文件**、**DevTools 面板**；
- 未开启 feature：devtools 不注册，日志回到 `tauri-plugin-log` 的默认行为。

回归测试见 `src-tauri/src/modules/devtools.rs` 的
`devtools_plugin_requires_log_plugin_to_skip_its_logger`：它断言「带 `skip_logger()` 能启动、
不带则启动失败」，防止有人后来把 `skip_logger()` 删掉。

日志文件位置（与 `tauri-plugin-log` 一致）：

| 平台 | 路径 |
|------|------|
| macOS | `~/Library/Logs/app.xinggaoya.nexterm/nexterm.log` |
| Linux / Windows | `<data local dir>/app.xinggaoya.nexterm/logs/nexterm.log` |

## 6. 右键菜单

`tauri-plugin-devtools-app` 会给每个 webview 注入脚本，监听 `contextmenu` 并调用
`plugin:devtools-app|show_context_menu` 弹出它自己的原生菜单（Reload / Inspect / Open Devtools）。
Nexterm 的终端、文件树、标签栏都有自定义右键菜单，两者叠加会让用户困惑；原生菜单里的
"Reload" 还会重载整个界面。

**处理方式**：**不授权** `plugin:devtools-app|show_context_menu`。`tauri.conf.json` 里
`removeUnusedCommands: true` 会把未授权的命令从 webview 的可用命令表里剔除，原生菜单根本
弹不出来。

> 早先这里曾改写 `window.__TAURI_INTERNALS__.invoke` 来拦截这条命令，但 **Tauri v2 下这条路
> 走不通**：`tauri/scripts/core.js` 用
> `Object.defineProperty(window.__TAURI_INTERNALS__, 'invoke', { value: ... })` 定义该属性，
> 默认 `writable: false` + `configurable: false`，严格模式下赋值会抛 `TypeError`，
> 而这段代码在 `main.ts` 的模块顶层执行 —— 异常会中断模块求值，**整个应用白屏**。

命令被拒后，插件脚本没有 catch，会产生一条未捕获 rejection（`Command show_context_menu not found`），
**每一次右键**都会在 console 里留下一条。`src/lib/devtoolsContextMenuGuard.ts` 定向吞掉这一条：
只匹配 `show_context_menu`，其它 rejection 照常上抛，不会掩盖真实问题。

DevTools 面板通过快捷键或设置页入口打开，不受影响。

## 7. 常见问题

| 现象 | 原因 / 处理 |
|------|------------|
| 终端没有 DevTools 链接 | 当前构建没带 `crabnebula-devtools` feature（或不是 debug 构建）；加上 feature 再跑 |
| 链接打不开 / 面板空白 | 本机网络无法访问 `devtools.crabnebula.dev`；内网环境请改用本地插桩服务直连 |
| 嵌入式面板打不开 | 嵌入式模式加载的是 CrabNebula 的**线上 Web 应用**，需要外网 + 账号登录 |
| 面板里看不到后端日志 | 确认 feature 已开启；`log::debug!` 级别在面板可见，但不会写进终端/日志文件（那里与 release 一致，只到 Info） |
| 端口 3033 被占用 | 无需处理，插件会自动换端口，以终端打印的链接为准 |
| 应用启动后卡住、"未响应" | 见 §3.1：这是 `tauri/tracing` 引入的死锁，**开启该 feature 的构建（含 debug）都会随机触发**。**不要在日常开发/正式构建里开这个 feature** |
| 改了 `tauri-plugin-log` 后启动失败 | 全局 `log` logger 只能有一个；开启 feature 时必须保留 `skip_logger()`（见第 5 节） |
| `cargo build` 报 `interprocess` 编译错误 | `tauri-plugin-devtools-app` 的依赖 `interprocess` 仍调用 tokio 1.52 已移除的 API，项目已把 tokio 限制为 `>=1.38, <1.52` |

## 8. 边界说明

- 插桩服务只监听 `127.0.0.1`，不对外网暴露。
- **默认构建不启动该服务、不注册插件、不暴露任何额外端口。**
- DevTools 面板是第三方 Web 应用，会把运行期数据（命令参数、日志）发送到 CrabNebula 的
  服务端做展示，涉及敏感数据时注意脱敏；嵌入式模式同理。
- 插件只做观测，不改变业务逻辑；移除插件只需删掉 `src-tauri/src/modules/devtools.rs`、
  `lib.rs` 中的注册代码与 `src-tauri/Cargo.toml` 里的两个可选依赖。

## 9. 相关：Windows 上 `cargo test` 的 manifest 依赖

链接了 Common Controls v6 的二进制（`TaskDialogIndirect` 仅 v6 导出）必须带 SxS manifest，
否则进程**启动即失败**（`STATUS_ENTRYPOINT_NOT_FOUND`）。Rust 的 test harness 默认没有
manifest，于是 Windows 上 `cargo test` 会整体跑不起来。

本项目的处理：`src-tauri/build.rs` 给**所有**产物（应用二进制 + lib 单测 harness + 集成测试）
统一嵌 `src-tauri/manifest.xml`，并用 `Attributes::new_without_app_manifest()` 让
`tauri-build` 不要再塞它那份（两份会撞成 `CVT1100: duplicate resource`）。
