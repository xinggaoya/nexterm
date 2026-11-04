# 浏览器调试桥（tauri-plugin-web-dev-bridge）集成 Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use subagent-driven-development (recommended) or executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** 让普通浏览器打开 nexterm 前端页面时，背后是**正在运行的真实 nexterm 实例**（真实文件树、Git 状态、偏好、事件流），用于前端 UI/交互调试与 AI 浏览器自动化测试。

**Architecture:** 在应用进程内注册 `tauri-plugin-web-dev-bridge` 插件（cargo feature `web-dev-bridge`，默认关闭），它在 `127.0.0.1` 上开一个 HTTP 服务，把浏览器的 `POST /invoke` 合成为一条真实的 Tauri `InvokeRequest` 投喂给本进程。前端侧由 vite 中间件同源暴露桥的发现信息，页面据此零配置找到桥；桥未就绪时挂载一个专用提示页而不是白屏。

**Tech Stack:** Tauri 2 / Rust 2021 / Vue 3 + Vite 7 / vitest / pnpm

**Spec:** 本计划实现的是 2026-11-04 在会话中确认的设计（见本文件 "Global Constraints" 与 `docs/architecture/07-web-dev-bridge.md`，后者由 Task 6 产出）。

## Global Constraints

- **依赖来源**：插件尚未发布到 crates.io / npm，一律用 git 依赖并锁定 commit `13d894827b14b9e7c510535b8a957383a4972dcd`。Rust 侧用 `rev = "13d894827b14b9e7c510535b8a957383a4972dcd"`，npm 侧用 `https://github.com/xinggaoya/tauri-plugin-web-dev-bridge.git#13d894827b14b9e7c510535b8a957383a4972dcd`。**禁止用 branch / tag / 浮动版本。**
- **feature 名**：`web-dev-bridge`（Rust 侧）。**必须不在默认 feature 集合里**。
- **启用条件**：`pnpm tauri dev -- --features web-dev-bridge`。且 Rust 侧必须 `.enabled(cfg!(debug_assertions))` —— 即便 `--release --features web-dev-bridge`，release 产物也不监听端口。
- **CORS 白名单**：`http://localhost:3180`，必须与 `src-tauri/tauri.conf.json` 的 `build.devUrl` 完全一致（由契约测试守护）。
- **CORS 常量名**：`DEV_BRIDGE_ALLOWED_ORIGIN`，定义在 `src-tauri/src/lib.rs` 顶层。
- **发现路由**：`/__tauri_dev_bridge__/info`，由 `webDevBridgeVitePlugin()` 提供（vite 侧，`apply: 'serve'`，仅 dev 生效）。
- **前端探测路由常量名**：`DEV_BRIDGE_DISCOVERY_ROUTE`，定义在 `src/lib/devBridge.ts`。
- **不新增任何后端命令**：桥复用既有 IPC 通路，不扩大 Rust 的系统访问面。
- **语言**：代码注释、commit message、文档一律中文；技术名词保留 English。
- **Rust 代码风格**：注释用中文，`///` 文档注释说明「为什么」而非「是什么」。
- **前端代码风格**：Vue 3 `<script setup lang="ts">` + Composition API；路径别名用 `@/`；Tailwind 只做布局/间距，组件主题用 Naive UI 或 scoped CSS。
- **提交粒度**：每个 Task 结束提交一次，Conventional Commit 前缀（`feat:` / `test:` / `docs:` / `chore:`）。
- **收尾门禁**：`pnpm test`、`pnpm build`、`cd src-tauri && cargo check --all-targets --locked`、`cargo clippy --all-targets --locked -- -D warnings` 全绿。

## Review Focus

以下五类输入/失败模式**没有任何一个 Task 的测试天然覆盖**，是最可能咬人的地方；每条都在下面指定了归属 Task 与对应测试。

1. **桥没启动就打开浏览器页面** → 不能白屏，必须给出可操作的提示（Task 5，`DevBridgeUnavailable.vue.test.ts` + `main.ts` 的启动分支）。
2. **页面 origin 与 CORS 白名单不一致**（用户用 `http://127.0.0.1:3180` 打开，而白名单是 `http://localhost:3180`）→ 请求会被浏览器 CORS 拦掉，表现为「探测成功但调用全失败」。缓解：探测走**相对路径**（同源，不受 CORS 约束），并在 Task 6 文档里写明「请用 `http://localhost:3180` 打开」。
3. **release 构建误开桥** → 必须不监听任何端口（Task 2，`.enabled(cfg!(debug_assertions))`；Task 1 边界测试守住 feature 默认关闭）。
4. **默认端口 6222 被占用** → 桥退化为系统随机端口，前端仍必须能发现（Task 3 vite 中间件读 Rust 写的描述文件；Task 4 探测只信路由返回值，不假设端口号）。
5. **git 依赖漂移**（有人把 `rev` 改成 `branch = "main"`）→ 会静默拉进未审查的上游改动（Task 1 边界测试断言必须是 `rev`）。

---

### Task 1: Rust 侧依赖与 feature 边界

**Files:**
- Modify: `src-tauri/Cargo.toml`（`[features]` 段 + `[dependencies]` 段）
- Create: `src-tauri/tests/web_dev_bridge_feature_boundary.rs`
- Modify: `src-tauri/Cargo.lock`（由 cargo 生成）

**Interfaces:**
- Consumes: 无（首个 Task）
- Produces: Cargo feature `web-dev-bridge`；可选依赖 `tauri-plugin-web-dev-bridge`（crate 名 `tauri_plugin_web_dev_bridge`），后续 Task 2 通过 `#[cfg(feature = "web-dev-bridge")]` 使用。

- [ ] **Step 1: 写失败的边界测试**

创建 `src-tauri/tests/web_dev_bridge_feature_boundary.rs`，参照 `src-tauri/tests/devtools_feature_boundary.rs` 的写法（同样的 `manifest()` / `dependency_line()` 辅助函数），包含三条断言：

```rust
#[test]
fn web_dev_bridge_dependency_is_optional() {
    // 断言 `tauri-plugin-web-dev-bridge` 那一行包含 `optional = true`
}

#[test]
fn web_dev_bridge_feature_is_not_enabled_by_default() {
    // 解析 [features] 段里 `default = [...]` 那一行，断言它不含 `web-dev-bridge`；
    // 没有显式 default 行也算通过（cargo 默认集合为空，同样安全）
}

#[test]
fn web_dev_bridge_git_dependency_is_pinned_to_a_revision() {
    // 断言依赖行含 `rev = "`，且不含 `branch =` / `tag =`
}
```

- [ ] **Step 2: 运行测试确认失败**

Run: `cd src-tauri && cargo test --test web_dev_bridge_feature_boundary`
Expected: FAIL —— 三条断言都会 panic（`Cargo.toml` 里还没有这个依赖，消息形如 `web_dev_bridge_dependency_is_optional ... panicked`，`unwrap_or_else` 分支触发）。

- [ ] **Step 3: 在 `src-tauri/Cargo.toml` 加 feature 与可选依赖**

`[features]` 段追加：

```toml
# 浏览器调试桥：把**运行中**的应用的真实 IPC 暴露给本机普通浏览器，
# 用于前端 UI 调试与浏览器自动化测试。
#
# 默认关闭：桥一旦启动就等于在本机开了一个能写文件、起进程、走 SSH 的
# HTTP 端点，必须显式 opt-in。
#
# 另外 Rust 侧还有一道 `cfg!(debug_assertions)` 兜底 —— 即便用
# `--release --features web-dev-bridge` 构建，release 产物也不会监听端口。
#
# 详见 docs/architecture/07-web-dev-bridge.md。
web-dev-bridge = ["dep:tauri-plugin-web-dev-bridge"]
```

`[dependencies]` 段追加：

```toml
# 浏览器调试桥（feature `web-dev-bridge`，默认不编译进任何产物）。
# 插件尚未发布到 crates.io，锁定 commit：13d894827b14b9e7c510535b8a957383a4972dcd
tauri-plugin-web-dev-bridge = { git = "https://github.com/xinggaoya/tauri-plugin-web-dev-bridge", rev = "13d894827b14b9e7c510535b8a957383a4972dcd", optional = true }
```

- [ ] **Step 4: 运行测试确认通过**

Run: `cd src-tauri && cargo test --test web_dev_bridge_feature_boundary`
Expected: PASS（3 passed）。

- [ ] **Step 5: 更新 Cargo.lock 并确认工程仍可编译**

Run: `cd src-tauri && cargo check --all-targets`（第一次不带 `--locked`，让 cargo 写入 Cargo.lock 与 git 依赖）
Expected: 编译成功；`src-tauri/Cargo.lock` 里出现 `tauri-plugin-web-dev-bridge` 条目与 `source = "git+https://github.com/xinggaoya/tauri-plugin-web-dev-bridge?rev=13d8948..."`。

Run: `cd src-tauri && cargo check --all-targets --locked`
Expected: 成功（证明 lock 文件已同步，CI 的 `--locked` 门禁能过）。

- [ ] **Step 6: 提交**

```bash
git add src-tauri/Cargo.toml src-tauri/Cargo.lock src-tauri/tests/web_dev_bridge_feature_boundary.rs
git commit -m "feat: 引入浏览器调试桥依赖（cargo feature 门控，默认关闭）"
```

---

### Task 2: Rust 侧注册插件并在 setup 启动

**Files:**
- Modify: `src-tauri/src/lib.rs`（顶层常量区、`run()` 里的 builder 链、setup 闭包、文件末尾既有 `mod tests`）
- Test: `src-tauri/src/lib.rs` 内既有的 `#[cfg(test)] mod tests`（追加一条）

**Interfaces:**
- Consumes: Task 1 的 cargo feature `web-dev-bridge` 与可选依赖。
- Produces: 常量 `DEV_BRIDGE_ALLOWED_ORIGIN: &str`（模块内私有，`#[cfg_attr(not(feature = "web-dev-bridge"), allow(dead_code))]`）；debug 构建下 `127.0.0.1` 上的桥 HTTP 服务。

- [ ] **Step 1: 写失败的契约测试**

在 `src-tauri/src/lib.rs` 末尾既有的 `mod tests` 里追加（紧跟 `bundle_identifier_matches_tauri_config` 之后）：

```rust
#[test]
fn dev_bridge_allowed_origin_matches_tauri_dev_url() {
    let manifest_dir = std::path::Path::new(env!("CARGO_MANIFEST_DIR"));
    let raw = std::fs::read_to_string(manifest_dir.join("tauri.conf.json"))
        .expect("tauri.conf.json readable");
    let config: serde_json::Value = serde_json::from_str(&raw).expect("valid json");
    let dev_url = config
        .pointer("/build/devUrl")
        .and_then(serde_json::Value::as_str)
        .expect("build.devUrl");
    assert_eq!(
        dev_url, DEV_BRIDGE_ALLOWED_ORIGIN,
        "DEV_BRIDGE_ALLOWED_ORIGIN 必须与 tauri.conf.json 的 build.devUrl 同源，\
         否则浏览器里的页面会被 CORS 拦掉"
    );
}
```

- [ ] **Step 2: 运行测试确认失败**

Run: `cd src-tauri && cargo test --lib dev_bridge_allowed_origin_matches_tauri_dev_url`
Expected: FAIL —— 编译错误 `cannot find value DEV_BRIDGE_ALLOWED_ORIGIN in this scope`。

- [ ] **Step 3: 定义常量**

在 `src-tauri/src/lib.rs` 顶层（`DEEP_LINK_OPEN_EVENT` 常量附近）追加：

```rust
/// 调试桥允许的浏览器来源（写进 CORS 的 `Access-Control-Allow-Origin`）。
///
/// 必须与 `tauri.conf.json` 的 `build.devUrl` 同源：浏览器里的页面由 vite
/// dev server 提供，只有同源请求才会带上这个 Origin。收紧到具体 origin 是
/// 为了防止「随便打开一个网站就能驱动本机 nexterm」—— nexterm 的 IPC 能
/// 写文件、起进程、走 SSH。
///
/// 注意：CORS 只约束浏览器。非浏览器客户端（curl 等）不受它约束，本机任意
/// 进程仍可调用完整 IPC 面。这是 localhost 调试桥的固有属性，只能靠
/// 「桥是 opt-in 且生命周期短」来收敛。详见 docs/architecture/07-web-dev-bridge.md。
#[cfg_attr(not(feature = "web-dev-bridge"), allow(dead_code))]
const DEV_BRIDGE_ALLOWED_ORIGIN: &str = "http://localhost:3180";
```

- [ ] **Step 4: 注册插件**

在 `src-tauri/src/lib.rs` 的 `run()` 里，紧接在 `window-state` 插件那段 `let builder = if should_restore_window_state() {...}` 之后、`let log_plugin = ...` 之前，追加：

```rust
    // 浏览器调试桥（feature `web-dev-bridge`，默认关闭）。
    //
    // 它在本机开一个只监听 127.0.0.1 的 HTTP 服务，把浏览器发来的
    // `POST /invoke` 合成为一条真实的 Tauri IPC 消息投喂给**本进程**，
    // 于是普通浏览器也能驱动运行中的 nexterm（拿到真实数据）。
    //
    // `enabled(cfg!(debug_assertions))` 是第二道保险：即便有人用
    // `--release --features web-dev-bridge` 构建，release 产物也不会监听端口。
    #[cfg(feature = "web-dev-bridge")]
    let builder = builder.plugin(
        tauri_plugin_web_dev_bridge::Builder::new()
            .allow_origin(DEV_BRIDGE_ALLOWED_ORIGIN)
            .enabled(cfg!(debug_assertions))
            .build(),
    );
```

- [ ] **Step 5: 在 setup 里启动**

在同一个 `.setup(|app| { ... })` 闭包里、`Ok(())` 之前追加：

```rust
            // 启动浏览器调试桥。必须放在 setup 里而不是插件的 initialize 钩子：
            // 插件需要 `App<Wry>` 才能取到 invoke_key，且此时 webview 已创建完毕。
            //
            // 起桥失败不该拖垮应用（它只是开发期调试工具），记日志继续。
            #[cfg(feature = "web-dev-bridge")]
            {
                if let Err(error) = tauri_plugin_web_dev_bridge::start(app) {
                    log::error!("启动浏览器调试桥失败: {error}");
                } else {
                    log::info!(
                        "浏览器调试桥已启动：普通浏览器可直连本机 nexterm（仅 127.0.0.1，\
                         允许来源 {DEV_BRIDGE_ALLOWED_ORIGIN}）"
                    );
                }
            }
```

- [ ] **Step 6: 运行测试确认通过**

Run: `cd src-tauri && cargo test --lib dev_bridge_allowed_origin_matches_tauri_dev_url`
Expected: PASS。

Run: `cd src-tauri && cargo test --features web-dev-bridge --lib`
Expected: PASS（feature 打开时也要编译通过 —— 常量此时不再是 dead_code）。

- [ ] **Step 7: 跑 clippy**

Run: `cd src-tauri && cargo clippy --all-targets --locked -- -D warnings` 以及 `cd src-tauri && cargo clippy --all-targets --locked --features web-dev-bridge -- -D warnings`
Expected: 两条都无 warning。

- [ ] **Step 8: 提交**

```bash
git add src-tauri/src/lib.rs
git commit -m "feat: 注册浏览器调试桥插件，收紧 CORS 来源到 dev server origin"
```

---

### Task 3: npm 依赖与 vite 发现端点

**Files:**
- Modify: `package.json`（`devDependencies`）
- Modify: `pnpm-lock.yaml`（由 pnpm 生成）
- Modify: `vite.config.ts`（`plugins` 数组）

**Interfaces:**
- Consumes: 无（与 Task 1/2 无耦合）。
- Produces: dev server 上的同源发现端点 `GET /__tauri_dev_bridge__/info` → `{ port: number|null, pid: number|null, url: string|null, hint?: string }`；npm 包 `tauri-plugin-web-dev-bridge`，子路径导出 `tauri-plugin-web-dev-bridge/vite`（导出 `webDevBridgeVitePlugin(options?)`）。

- [ ] **Step 1: 加 npm 依赖**

在 `package.json` 的 `devDependencies` 里追加（保持字母序，插在 `"tailwindcss"` 之后、`"typescript"` 之前）：

```json
"tauri-plugin-web-dev-bridge": "https://github.com/xinggaoya/tauri-plugin-web-dev-bridge.git#13d894827b14b9e7c510535b8a957383a4972dcd",
```

- [ ] **Step 2: 安装**

Run: `pnpm install`
Expected: 成功；`pnpm-lock.yaml` 里出现该 git 依赖；控制台**不出现** `Ignored build scripts` 警告（该包没有构建脚本，`dist/` 已随仓库提交）。

- [ ] **Step 3: 验证包可用**

Run: `node -e "import('tauri-plugin-web-dev-bridge/vite').then(m=>console.log(typeof m.webDevBridgeVitePlugin))"`
Expected: 输出 `function`（确认 `dist/vite.js` 的 `./constants.js` 显式扩展名能被 Node 解析）。

- [ ] **Step 4: 接上 vite 插件**

在 `vite.config.ts` 顶部加 import：

```ts
import { webDevBridgeVitePlugin } from "tauri-plugin-web-dev-bridge/vite";
```

在 `plugins` 数组里，放在 `vue()` 之后、`AutoImport({...})` 之前：

```ts
    // 浏览器调试桥的发现端点：把 Rust 侧写下的 { port, pid, url } 以同源 JSON
    // 暴露给前端，使浏览器里的页面能零配置找到本机调试桥（Rust 监听端口可能是
    // 系统随机分配的，不能靠约定端口）。插件自带 apply: 'serve'，仅 dev 生效。
    webDevBridgeVitePlugin(),
```

- [ ] **Step 5: 验证端点**

Run（后台起 dev server）：`pnpm dev`
Run: `curl -s http://localhost:3180/__tauri_dev_bridge__/info`
Expected: 返回 JSON，含 `"port": null` 与 `hint` 字段（此时桌面应用没跑，描述文件还不存在）。
再启动桌面应用（`pnpm tauri dev -- --features web-dev-bridge`）后重跑 curl，Expected: `"port"` 变成实际端口数字。

- [ ] **Step 6: 提交**

```bash
git add package.json pnpm-lock.yaml vite.config.ts
git commit -m "feat: 接入浏览器调试桥的 npm 包与 vite 发现端点"
```

---

### Task 4: 前端探测模块 `src/lib/devBridge.ts`

**Files:**
- Create: `src/lib/devBridge.ts`
- Test: `src/lib/devBridge.test.ts`

**Interfaces:**
- Consumes: npm 包 `tauri-plugin-web-dev-bridge` 的 `installWebDevBridge(options?)`；`@/lib/tauriRuntime` 的 `hasTauriInternals(target?)`；vite 发现路由 `/__tauri_dev_bridge__/info`。
- Produces:
  - `export const DEV_BRIDGE_DISCOVERY_ROUTE = "/__tauri_dev_bridge__/info"`
  - `export const DEV_BRIDGE_PROBE_TIMEOUT_MS = 4000`
  - `export type DevBridgeBootMode = "desktop" | "browser-bridge" | "browser-unavailable"`
  - `export interface DevBridgeProbeOptions { timeoutMs?: number; fetchImpl?: typeof fetch }`
  - `export function probeDevBridge(options?: DevBridgeProbeOptions): Promise<boolean>`
  - `export function installDevBridge(): void`
  - `export function resolveDevBridgeBoot(options?: DevBridgeProbeOptions): Promise<DevBridgeBootMode>`

- [ ] **Step 1: 写失败的测试**

创建 `src/lib/devBridge.test.ts`。用 `vi.hoisted` + `vi.mock` 把插件和 `hasTauriInternals` 都替换掉：

```ts
const installMock = vi.hoisted(() => vi.fn());
vi.mock("tauri-plugin-web-dev-bridge", () => ({ installWebDevBridge: installMock }));

const runtimeMock = vi.hoisted(() => ({ hasTauriInternals: vi.fn(() => false) }));
vi.mock("./tauriRuntime", () => runtimeMock);

import {
  DEV_BRIDGE_DISCOVERY_ROUTE,
  installDevBridge,
  probeDevBridge,
  resolveDevBridgeBoot,
} from "./devBridge";
```

用例（每条一个 `it`）：

1. `probeDevBridge` 在发现路由返回 `{ port: 6222 }` 时 resolve `true`，且请求 URL 等于 `DEV_BRIDGE_DISCOVERY_ROUTE`。
2. `probeDevBridge` 在返回 `{ port: null }`（桌面应用未启动）时 resolve `false`。
3. `probeDevBridge` 在 `port` 为 `0` 时 resolve `false`（端口 0 不是有效端口）。
4. `probeDevBridge` 在 fetch 抛错时 resolve `false`（不向上抛）。
5. `resolveDevBridgeBoot` 在 `hasTauriInternals()` 为 `true` 时返回 `"desktop"`，且**不发起任何 fetch**。
6. `resolveDevBridgeBoot` 在桥就绪时返回 `"browser-bridge"`。
7. `resolveDevBridgeBoot` 在桥未就绪时返回 `"browser-unavailable"`。
8. `installDevBridge` 会调用插件的 `installWebDevBridge` 恰好一次。

fetch mock 形如：

```ts
const fetchMock = vi.fn(async () => ({
  ok: true,
  json: async () => ({ port: 6222 }),
})) as unknown as typeof fetch;
```

- [ ] **Step 2: 运行测试确认失败**

Run: `pnpm test -- src/lib/devBridge.test.ts`
Expected: FAIL —— `Failed to resolve import "./devBridge"`。

- [ ] **Step 3: 实现模块**

创建 `src/lib/devBridge.ts`：

```ts
/**
 * 浏览器调试桥（`tauri-plugin-web-dev-bridge`）的前端封装。
 *
 * 背景：Tauri 应用的后端只能通过 `window.__TAURI_INTERNALS__.invoke()` 触达，
 * 而桌面端这条通路落在 WebView 的 `ipc://` 协议上，普通浏览器访问不到。
 * 调试桥在应用进程内开一个只监听 `127.0.0.1` 的 HTTP 服务，把浏览器的
 * `POST /invoke` 合成为一条真实的 IPC 消息投喂给**正在运行的**应用 ——
 * 于是浏览器里拿到的也是真实数据。
 *
 * 本模块只做三件事：探测桥是否就绪、安装浏览器侧 shim、决定启动模式。
 * 不在此处发任何业务 IPC。
 */

import { installWebDevBridge } from "tauri-plugin-web-dev-bridge";
import { hasTauriInternals } from "./tauriRuntime";

/** 调试桥的同源发现路由（由 `webDevBridgeVitePlugin()` 提供）。 */
export const DEV_BRIDGE_DISCOVERY_ROUTE = "/__tauri_dev_bridge__/info";

/** 探测桥是否就绪时的超时（毫秒）。 */
export const DEV_BRIDGE_PROBE_TIMEOUT_MS = 4000;

/**
 * 启动模式。
 *
 * - `desktop`：跑在 Tauri WebView 里，正常启动。
 * - `browser-bridge`：跑在普通浏览器里，且本机调试桥已就绪。
 * - `browser-unavailable`：跑在普通浏览器里，但调试桥没起来。
 */
export type DevBridgeBootMode =
  | "desktop"
  | "browser-bridge"
  | "browser-unavailable";

export interface DevBridgeProbeOptions {
  /** 探测超时（毫秒），默认 `DEV_BRIDGE_PROBE_TIMEOUT_MS`。 */
  timeoutMs?: number;
  /** 注入的 fetch 实现（测试用）。 */
  fetchImpl?: typeof fetch;
}

/**
 * 探测本机调试桥是否已就绪。
 *
 * 打的是 vite 的**同源**发现路由：相对路径不受 CORS 约束，也不挑
 * `localhost` 还是 `127.0.0.1`。
 *
 * 判定规则与插件自身的描述文件校验保持一致：`port` 必须是正整数。
 */
export async function probeDevBridge(
  options: DevBridgeProbeOptions = {},
): Promise<boolean> {
  const fetchImpl = options.fetchImpl ?? globalThis.fetch;
  if (typeof fetchImpl !== "function") return false;

  const controller = new AbortController();
  const timeout = setTimeout(
    () => controller.abort(),
    options.timeoutMs ?? DEV_BRIDGE_PROBE_TIMEOUT_MS,
  );
  try {
    const response = await fetchImpl(DEV_BRIDGE_DISCOVERY_ROUTE, {
      signal: controller.signal,
    });
    if (!response.ok) return false;
    const payload = (await response.json()) as { port?: number | null };
    return (
      typeof payload.port === "number" &&
      Number.isFinite(payload.port) &&
      payload.port > 0
    );
  } catch {
    // 桥没起来 / dev server 没开 / 请求超时 —— 一律当作「不可用」。
    return false;
  } finally {
    clearTimeout(timeout);
  }
}

/**
 * 安装浏览器侧 shim。
 *
 * 在 Tauri 运行时里是**空操作**（插件自己判断 `__TAURI_INTERNALS__` 是否存在），
 * 桌面端行为完全不受影响。
 */
export function installDevBridge(): void {
  installWebDevBridge();
}

/**
 * 决定启动模式。
 *
 * **必须在安装 shim 之前调用**：shim 一旦装上，`window.__TAURI_INTERNALS__`
 * 就存在了，`hasTauriInternals()` 会从 `false` 变成 `true`，失去「当前是不是
 * 真实 Tauri 运行时」这个判据。
 */
export async function resolveDevBridgeBoot(
  options: DevBridgeProbeOptions = {},
): Promise<DevBridgeBootMode> {
  if (hasTauriInternals()) return "desktop";
  return (await probeDevBridge(options))
    ? "browser-bridge"
    : "browser-unavailable";
}
```

- [ ] **Step 4: 运行测试确认通过**

Run: `pnpm test -- src/lib/devBridge.test.ts`
Expected: PASS（8 passed）。

- [ ] **Step 5: 类型检查**

Run: `pnpm exec vue-tsc --noEmit`
Expected: 无错误。

- [ ] **Step 6: 提交**

```bash
git add src/lib/devBridge.ts src/lib/devBridge.test.ts
git commit -m "feat: 新增浏览器调试桥前端探测模块"
```

---

### Task 5: 启动编排与「调试桥未就绪」提示页

**Files:**
- Modify: `src/main.ts`
- Create: `src/app/components/DevBridgeUnavailable.vue`
- Create: `src/app/devBridgeFallback.ts`
- Test: `src/app/components/DevBridgeUnavailable.vue.test.ts`

**Interfaces:**
- Consumes: Task 4 的 `resolveDevBridgeBoot()` / `installDevBridge()` / `probeDevBridge()`。
- Produces: `export function mountDevBridgeUnavailable(target?: string | Element): void`（`src/app/devBridgeFallback.ts`）；`DevBridgeUnavailable` 组件，props `{ reload?: () => void }`（默认 `() => window.location.reload()`）。

- [ ] **Step 1: 写失败的组件测试**

创建 `src/app/components/DevBridgeUnavailable.vue.test.ts`：

```ts
import { mount } from "@vue/test-utils";
import { describe, expect, it, vi } from "vitest";
import DevBridgeUnavailable from "./DevBridgeUnavailable.vue";

const probeMock = vi.hoisted(() => vi.fn(async () => false));
vi.mock("@/lib/devBridge", () => ({ probeDevBridge: probeMock }));

describe("DevBridgeUnavailable", () => {
  it("展示调试桥未就绪的说明与启动命令", () => {
    const wrapper = mount(DevBridgeUnavailable);
    expect(wrapper.text()).toContain("调试桥未就绪");
    expect(wrapper.text()).toContain("pnpm tauri dev -- --features web-dev-bridge");
  });

  it("点击重新检测：桥仍未就绪时保持提示状态", async () => {
    probeMock.mockResolvedValue(false);
    const wrapper = mount(DevBridgeUnavailable);
    await wrapper.get("button").trigger("click");
    expect(probeMock).toHaveBeenCalled();
    expect(wrapper.text()).toContain("调试桥未就绪");
  });

  it("点击重新检测：桥就绪时调用 reload", async () => {
    probeMock.mockResolvedValue(true);
    const reload = vi.fn();
    const wrapper = mount(DevBridgeUnavailable, { props: { reload } });
    await wrapper.get("button").trigger("click");
    expect(reload).toHaveBeenCalledTimes(1);
  });
});
```

- [ ] **Step 2: 运行测试确认失败**

Run: `pnpm test -- src/app/components/DevBridgeUnavailable.vue.test.ts`
Expected: FAIL —— `Failed to resolve import "./DevBridgeUnavailable.vue"`。

- [ ] **Step 3: 实现提示组件**

创建 `src/app/components/DevBridgeUnavailable.vue`。

`<script setup lang="ts">` 部分：

```ts
import { ref } from "vue";
import { probeDevBridge } from "@/lib/devBridge";

const props = withDefaults(defineProps<{ reload?: () => void }>(), {
  reload: () => window.location.reload(),
});

const checking = ref(false);
const ready = ref(false);

async function retry(): Promise<void> {
  checking.value = true;
  ready.value = await probeDevBridge();
  checking.value = false;
  if (ready.value) props.reload();
}
```

模板部分：一张居中的卡片，包含

- 一个小徽标（写 `DEBUG BRIDGE`）
- 标题「调试桥未就绪」
- 一段说明：「当前页面运行在普通浏览器里，但本机的 Nexterm 调试桥没有运行。启动带 `web-dev-bridge` feature 的桌面应用后，点击下面的按钮重新检测。」
- 一段命令（放在 `<code>` 里，**逐字**为 `pnpm tauri dev -- --features web-dev-bridge`）
- 一个按钮，文案为「重新检测」（`checking` 为真时显示「检测中…」，`:disabled="checking"`）
- 当 `ready` 为真时，额外显示一行「调试桥已就绪，正在重新加载…」

样式用 `<style scoped>`，自包含实现（**不依赖应用主题变量** —— 这个页面在没有 MainApp 的独立 Vue app 里渲染，主题 token 不会被应用）：

- 用 `color-scheme: light dark` + `prefers-color-scheme` 媒体查询给两套中性色（背景 / 卡片 / 边框 / 主文字 / 次文字）。
- 卡片：`max-width: 34rem`、圆角 12px、1px 边框、`box-shadow` 轻微、居中、`padding: 2rem`。
- 徽标：小字号、字距放宽、`border-radius: 999px`、弱化背景。
- 命令块：等宽字体、`background` 用次级底色、`padding: 0.75rem 1rem`、`border-radius: 8px`、`overflow-x: auto`、`white-space: pre`。
- 按钮：主色底、主色文字、`border-radius: 8px`、`padding: 0.5rem 1rem`、`cursor: pointer`，禁用态降低不透明度。
- 整体：`min-height: 100vh`、垂直水平居中、`padding: 2rem`。

**注意**：组件里不要用 `window.location.reload` 直接调用，必须走 `props.reload()`，否则测试无法断言。

- [ ] **Step 4: 实现挂载函数**

创建 `src/app/devBridgeFallback.ts`：

```ts
import { createApp } from "vue";
import DevBridgeUnavailable from "./components/DevBridgeUnavailable.vue";

/**
 * 挂载「调试桥未就绪」提示页。
 *
 * 独立于 MainApp：这个页面在**桥没起来**时渲染，而 MainApp 的启动流程
 * 依赖真实后端（偏好 hydrate、工作区 bootstrap），那时全都不可用。
 */
export function mountDevBridgeUnavailable(
  target: string | Element = "#root",
): void {
  createApp(DevBridgeUnavailable).mount(target);
}
```

- [ ] **Step 5: 运行组件测试确认通过**

Run: `pnpm test -- src/app/components/DevBridgeUnavailable.vue.test.ts`
Expected: PASS（3 passed）。

- [ ] **Step 6: 改造 `src/main.ts` 的启动流程**

把 `src/main.ts` 现有的顶层启动代码收进一个 `async function boot()`，并在函数最前面插入桥的判定：

```ts
import { installDevBridge, resolveDevBridgeBoot } from "@/lib/devBridge";
import { mountDevBridgeUnavailable } from "@/app/devBridgeFallback";

async function boot(): Promise<void> {
  // 浏览器调试桥：普通浏览器里接管 `__TAURI_INTERNALS__`，把 IPC 转发给
  // 本机正在运行的 nexterm；Tauri 运行时里是空操作。
  //
  // 顺序很重要：先判定启动模式（此刻还没装 shim，`hasTauriInternals()` 反映
  // 真实运行时），再装 shim —— 装上之后 `hasTauriInternals()` 恒为 true。
  //
  // 桥没起来时不能继续往下走：下面的 `prefs.hydrate()` 等会真的发起 invoke，
  // 而 invoke 会一直重试到超时再 reject，顶层 await 抛错 → 整页白屏。
  const bootMode = await resolveDevBridgeBoot();
  if (bootMode === "browser-unavailable") {
    mountDevBridgeUnavailable();
    return;
  }
  installDevBridge();

  // ↓↓↓ 以下是原有的启动流程，原样搬进 boot() ↓↓↓
  const prefs = usePreferencesPiniaStore(pinia);
  if (hasTauriInternals()) {
    await prefs.hydrate();
    useTabsPiniaStore().setTerminalLayoutSnapshot(prefs.terminalLayouts);
  }
  await applyLanguagePreference(prefs.language);
  await Promise.all([
    useWorkspacesPiniaStore(pinia).bootstrap(),
    useWorkspaceRootPiniaStore(pinia).bootstrap(),
  ]);

  app.mount("#root");
  // ↑↑↑ 原样搬进 boot() ↑↑↑

  // 深链订阅（原模块底部那段 `onDeepLinkOpen` 逻辑）也搬进 boot()，
  // 保持在 app.mount 之后，行为与改造前一致。
}

void boot();
```

改造要求：

- `pinia` / `app` 的创建保持在模块顶层（`boot()` 之外），只有「hydrate → bootstrap → mount → 深链订阅」这段搬进 `boot()`。
- 深链订阅那段（`if (hasTauriInternals()) { ... onDeepLinkOpen(...) }`）整体搬进 `boot()`，位置在 `app.mount("#root")` 之后。
- 删掉模块底层的 `app.mount("#root")` 与顶层 await（改为 `void boot();`）。

- [ ] **Step 7: 运行全部前端测试与类型检查**

Run: `pnpm test`
Expected: 全部通过（新增用例在内）。

Run: `pnpm exec vue-tsc --noEmit`
Expected: 无错误。

- [ ] **Step 8: 提交**

```bash
git add src/main.ts src/app/devBridgeFallback.ts src/app/components/DevBridgeUnavailable.vue src/app/components/DevBridgeUnavailable.vue.test.ts
git commit -m "feat: 浏览器调试桥启动编排与未就绪提示页"
```

---

### Task 6: 文档与最终验证

**Files:**
- Create: `docs/architecture/07-web-dev-bridge.md`
- Modify: `docs/architecture/README.md`（「文件清单」表格追加一行；「推荐阅读路径」表格追加一行）
- Modify: `docs/architecture/03-development-workflow.md`（「## 3. 调试」章节追加一节 `### 3.4 浏览器调试桥`，并把原 `### 3.4 常见问题` 顺延为 `### 3.5`）

**Interfaces:**
- Consumes: 全部前序 Task 的最终形态。
- Produces: 无代码接口。

- [ ] **Step 1: 写 `docs/architecture/07-web-dev-bridge.md`**

全中文，结构与 `06-crabnebula-devtools.md` 保持一致，包含以下小节：

1. **用途与原理** —— 讲清楚「桥不是 mock，浏览器里拿到的是真实数据」；给出 ASCII 流程图（浏览器 → `POST /invoke` → 桥 → 合成的 `InvokeRequest` → 真实命令处理器）。
2. **启用方式** —— `pnpm tauri dev -- --features web-dev-bridge`；说明 feature 默认关闭、release 永不监听端口。
3. **使用流程** —— 启动桌面应用 → 浏览器打开 `http://localhost:3180`（**必须用 `localhost` 而不是 `127.0.0.1`**，见安全模型一节）→ 页面会连上真实后端。
4. **安全模型** —— 表格：监听地址（仅 `127.0.0.1`）、构建形态（仅 debug + 显式 feature）、浏览器来源（仅 `http://localhost:3180`）；**必须显式写出残余风险**：CORS 只约束浏览器，curl 等非浏览器客户端不受约束，本机任意进程仍可调用完整 IPC 面（能写文件、起进程、走 SSH）—— 这是 localhost 调试桥的固有属性，只能靠「opt-in + 生命周期短」收敛。
5. **已知边界** —— 至少写清这四条：
   - PTY / LSP 的流式输出过不了桥（Rust 的 `Channel<T>` 反序列化 `"__CHANNEL__:<id>"`，发送时走 `webview.eval(runCallback(id))`，目标是**桌面 webview** 而不是浏览器）→ 浏览器里 `pty_open` 会成功但收不到输出，终端流式仍在桌面端验证。
   - webview 级事件收不到（桥在 Rust 侧注册的是 app 级监听，`webview.emit()` 作用域的事件不会送达浏览器）。
   - `plugin:window:*` 作用于**真实窗口** —— 浏览器里点关闭，桌面窗口真的会关。
   - 浏览器里偏好 / 自动更新等走的是真实后端：偏好 hydrate 会读到真实设置，自动更新检查会真的打到更新接口。
6. **故障排查** —— 至少覆盖：页面显示「调试桥未就绪」→ 桌面应用没带 feature 启动 / 端口被占用（会自动退化为随机端口，前端仍能发现）；探测成功但调用全失败 → 页面 origin 与 CORS 白名单不一致（改用 `http://localhost:3180`）；提示「找不到调试桥」→ 桌面应用没启动。
7. **相关文件** —— 指向 `src/lib/devBridge.ts`、`src/main.ts`、`src-tauri/src/lib.rs`、`vite.config.ts`、`src-tauri/Cargo.toml`。

- [ ] **Step 2: 更新 `docs/architecture/README.md`**

- 「文件清单」表格追加一行：`| [07-web-dev-bridge.md](./07-web-dev-bridge.md) | 浏览器调试桥：把运行中应用的真实 IPC 暴露给本机浏览器，用于前端调试与自动化测试 |`
- 「推荐阅读路径」表格追加一行：`| 想在浏览器里调试前端 | [03-development-workflow.md](./03-development-workflow.md) 调试章节 -> [07-web-dev-bridge.md](./07-web-dev-bridge.md) |`

- [ ] **Step 3: 更新 `docs/architecture/03-development-workflow.md`**

在「### 3.3 后端调试面板（CrabNebula DevTools）」之后、原「### 3.4 常见问题」之前插入「### 3.4 浏览器调试桥」，内容：

- 一句话说清用途（普通浏览器直连运行中的 nexterm，拿真实数据）。
- 启动命令：`pnpm tauri dev -- --features web-dev-bridge`
- 然后用浏览器打开 `http://localhost:3180`。
- 指向 `07-web-dev-bridge.md` 看安全模型与已知边界。
- 把原「### 3.4 常见问题」改成「### 3.5 常见问题」。

- [ ] **Step 4: 跑完整门禁**

Run: `pnpm test`
Expected: 全部通过。

Run: `pnpm build`
Expected: `vue-tsc --noEmit` 无错误 + `vite build` 成功。

Run: `cd src-tauri && cargo check --all-targets --locked`
Expected: 成功。

Run: `cd src-tauri && cargo clippy --all-targets --locked -- -D warnings`
Expected: 无 warning。

Run: `cd src-tauri && cargo test --all-targets --locked`
Expected: 全部通过（含 `web_dev_bridge_feature_boundary` 的 3 条）。

Run: `cd src-tauri && cargo clippy --all-targets --locked --features web-dev-bridge -- -D warnings`
Expected: 无 warning。

- [ ] **Step 5: 手工验收**

1. `pnpm tauri dev -- --features web-dev-bridge` 启动桌面应用。
2. 浏览器打开 `http://localhost:3180` → 页面正常渲染，文件树 / Git 面板显示的是**真实**数据。
3. 桌面应用**不启动**时打开 `http://localhost:3180` → 显示「调试桥未就绪」提示页，**不是白屏**。
4. 从另一个 origin（例如 `http://example.com` 下的页面）发 `fetch("http://127.0.0.1:6222/invoke", { method: "POST" })` → 浏览器控制台报 CORS 错误（被 `Access-Control-Allow-Origin` 拦下）。
5. 桌面应用终端里能读到 `[web-dev-bridge]` 相关日志行（nexterm 自己打的 `log::info!` 那条；插件自身用 `tracing` 打日志，nexterm 没装 tracing subscriber，看不到是预期的）。

- [ ] **Step 6: 提交**

```bash
git add docs/architecture/07-web-dev-bridge.md docs/architecture/README.md docs/architecture/03-development-workflow.md
git commit -m "docs: 补充浏览器调试桥的架构文档与调试流程"
```
