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
> 只在 debug 构建启用，探测命令是 `crabnebula_devtools_available`。两者互不影响。

## 2. 组成与安装

项目已经装好两个 Rust crate（见 `src-tauri/Cargo.toml`）：

| crate | 作用 |
|-------|------|
| `tauri-plugin-devtools` | 后端插桩：本机 HTTP 服务（默认 `127.0.0.1:3033`），对外暴露命令/事件/日志 |
| `tauri-plugin-devtools-app` | 嵌入式 UI：在 Nexterm 窗口内以抽屉形式打开 DevTools 面板 |

配套改动：

| 位置 | 改动 |
|------|------|
| `src-tauri/src/modules/devtools.rs` | 插件初始化 + 日志桥接（日志目录解析、stdout/文件输出） |
| `src-tauri/src/lib.rs` | debug 构建注册插件；`tauri-plugin-log` 在 debug 下让出全局 logger；新增 `crabnebula_devtools_available` 命令 |
| `src-tauri/capabilities/default.json` | 放行 `devtools-app:allow-toggle`（前端调用嵌入式面板的 toggle） |
| `src/lib/native.ts` | `crabnebulaDevtoolsAvailable()` / `toggleCrabnebulaDevtools()` 封装 |
| `src/lib/devtoolsContextMenu.ts` | 拦截插件注入的原生右键菜单，保住 Nexterm 自己的右键菜单 |
| `src/settings/sections/GeneralSection.vue` | 设置 → 通用 → 开发者：新增「打开后端调试面板」入口 |

## 3. 启用方式

插件**只在 debug 构建注册**，release 构建既不启动插桩服务，也不会暴露本地端口：

```rust
// src-tauri/src/lib.rs
#[cfg(debug_assertions)]
let devtools_plugins = devtools::init(&context.config().identifier);
```

因此：

- `pnpm tauri dev`（debug）→ 插桩服务启动，终端会打印连接链接；
- `pnpm tauri build`（release）→ 不启用。

> 注意：devtools crate 依赖 `tauri/tracing` feature，Cargo 的 feature 统一会让该 feature 在
> release 构建同样生效。它只是在 IPC 路径上多打几个 span（无 subscriber 时开销可忽略），
> 但会让 release 构建多编译一点 tracing 相关代码。

### 3.1 三种打开方式

| 方式 | 操作 | 依赖 |
|------|------|------|
| 独立 Web UI | 复制终端打印的 `https://devtools.crabnebula.dev/dash/<host>/<port>` 到浏览器 | 能访问 `devtools.crabnebula.dev`（需要 CrabNebula 账号登录） |
| 嵌入式抽屉 | 设置 → 通用 → 开发者 → 「打开后端调试面板」，或快捷键 `Ctrl+Shift+M`（macOS `Cmd+Alt+M`） | 本机安装 **CrabNebula DevTools 桌面端** |
| 终端链接 | 启动 debug 应用时终端打印的链接（嵌入式插件另打印 `crabnebula-devtools://dash/<host>/<port>`） | — |

CrabNebula DevTools 桌面端下载地址（嵌入式模式必需，插件会通过
`crabnebula-devtools://` 协议唤起它）：

- Linux：<https://cdn.crabnebula.app/download/crabnebula/devtools-desktop/latest/platform/appimage-x86_64>
- macOS：<https://cdn.crabnebula.app/download/crabnebula/devtools-desktop/latest/platform/dmg-aarch64>（Intel 用 `dmg-x86_64`）
- Windows：<https://cdn.crabnebula.app/download/crabnebula/devtools-desktop/latest/platform/nsis-x86_64>

> 嵌入式模式是「应用内打开 DevTools UI」，但**数据采集**始终来自 `tauri-plugin-devtools`
> 的本机服务；桌面端只是 UI 载体。

## 4. 使用流程

1. 启动 debug 应用：

   ```bash
   pnpm tauri dev
   ```

2. 终端会看到插桩服务信息（形如）：

   ```
      Tauri Devtools v2.2.3
      → https://devtools.crabnebula.dev/dash/127.0.0.1/3033
   ```

   端口默认 `3033`；被占用时插件会自动改用空闲端口，链接里的端口即为实际端口。

3. 打开面板（二选一）：
   - 浏览器访问上面的链接；
   - 或按 `Ctrl+Shift+M`（macOS `Cmd+Alt+M`）/ 在设置页点「打开后端调试面板」。

4. 在面板里按需查看：
   - **Commands**：每次 `invoke` 的命令名、参数、返回值、耗时；
   - **Events**：Tauri 事件的发送与订阅；
   - **Logs**：后端 `log::` 日志（按级别 / target 过滤，debug 级别在面板里可见）；
   - **Performance**：命令调用耗时分布。

5. 排查结束后直接关掉面板即可；插桩服务随应用进程退出。

## 5. 与 `tauri-plugin-log` 的关系（重要）

两个插件都想占用 **全局 `log` logger**，而全局 logger 只能有一个：

- `tauri-plugin-devtools` 初始化时安装全局 tracing subscriber，并通过 `tracing-log` 的
  `LogTracer` 抢占全局 `log` logger —— 之后所有 `log::info!` 等调用都会被转成 tracing
  event，从而出现在 DevTools 面板里；
- `tauri-plugin-log` 的 setup 也会 `log::set_boxed_logger` 抢占同一个槽位。

若两者都按默认方式启动，后注册的会失败，**debug 构建将无法启动**。本项目的处理方式：

1. `devtools::init()` 在 `tauri::Builder` 之前调用，先拿到全局 `log` logger；
2. debug 构建下 `tauri-plugin-log` 使用 `skip_logger()`，只保留插件的 `plugin:log|log`
   命令（前端日志仍经 `log::logger()` 进入 tracing → DevTools）；
3. devtools 通过 `attach_logger` 把 tracing event 桥接回 **stdout + app 日志目录文件**，
   输出格式与 release 保持一致（`[时间][target][级别] 消息`）。

因此：

- debug 构建：后端日志同时出现在 **终端**、**日志文件**、**DevTools 面板**；
- release 构建：devtools 不注册，日志回到 `tauri-plugin-log` 的默认行为（终端 + 日志文件）。

回归测试见 `src-tauri/src/modules/devtools.rs` 的
`devtools_plugin_requires_log_plugin_to_skip_its_logger`：它断言「带 `skip_logger()` 能启动、
不带则启动失败」，防止有人后来把 `skip_logger()` 删掉。

日志文件位置（与 `tauri-plugin-log` 一致）：

| 平台 | 路径 |
|------|------|
| macOS | `~/Library/Logs/app.xinggaoya.nexterm/nexterm.log` |
| Linux / Windows | `<data local dir>/app.xinggaoya.nexterm/logs/nexterm.log` |

## 6. 右键菜单

`tauri-plugin-devtools-app` 会给每个 webview 注入脚本，监听 `contextmenu` 并弹出它自己的
原生菜单（Reload / Inspect / Open Devtools）。Nexterm 的终端、文件树、标签栏都有自定义右键
菜单，两者会叠加，且原生菜单里的 "Reload" 会重载整个界面。

因此 `src/lib/devtoolsContextMenu.ts` 拦截了 `plugin:devtools-app|show_context_menu` 这条命令
（仅此一条），保留 Nexterm 自己的右键菜单；DevTools 面板通过快捷键或设置页入口打开。

## 7. 常见问题

| 现象 | 原因 / 处理 |
|------|-------------|
| 终端没有 DevTools 链接 | 当前不是 debug 构建（`pnpm tauri dev` 才是）；或应用未启动成功 |
| 链接打不开 / 面板空白 | 本机网络无法访问 `devtools.crabnebula.dev`；改用嵌入式模式（安装桌面端后 `Ctrl+Shift+M`） |
| 嵌入式面板打不开、报 spawn 失败 | 本机未安装 CrabNebula DevTools 桌面端，插件无法唤起 `crabnebula-devtools://` 协议 |
| 面板里看不到后端日志 | 确认是 debug 构建；`log::debug!` 级别在面板可见，但不会写进终端/日志文件（那里与 release 一致，只到 Info） |
| 端口 3033 被占用 | 无需处理，插件会自动换端口，以终端打印的链接为准 |
| 改了 `tauri-plugin-log` 后 debug 构建启动失败 | 全局 `log` logger 只能有一个；debug 下必须保留 `skip_logger()`（见第 5 节） |
| `cargo build` 报 `interprocess` 编译错误 | `tauri-plugin-devtools-app` 的依赖 `interprocess` 仍调用 tokio 1.52 已移除的 API，项目已把 tokio 限制为 `>=1.38, <1.52` |

## 8. 边界说明

- 插桩服务只监听 `127.0.0.1`，不对外网暴露；release 构建不启动该服务。
- DevTools 面板是第三方 Web 应用，会把运行期数据（命令参数、日志）发送到 CrabNebula 的
  服务端做展示，涉及敏感数据时注意脱敏；嵌入式模式同理。
- 插件只做观测，不改变业务逻辑；移除插件只需删掉 `src-tauri/src/modules/devtools.rs`、
  `lib.rs` 中的注册代码与 capability 里的 `devtools-app:allow-toggle`。
