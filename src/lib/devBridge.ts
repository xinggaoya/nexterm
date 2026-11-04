/**
 * 浏览器调试桥（`tauri-plugin-web-dev-bridge`）的前端封装。
 *
 * 背景：Tauri 应用的后端只能通过 `window.__TAURI_INTERNALS__.invoke()` 触达，
 * 而桌面端这条通路落在 WebView 的 `ipc://` 自定义协议上，普通浏览器访问不到。
 * 于是「把前端页面丢进浏览器调试」时，每一个后端调用都会炸。
 *
 * 调试桥在**应用进程内**开一个只监听 `127.0.0.1` 的 HTTP 服务，把浏览器的
 * `POST /invoke` 合成为一条真实的 Tauri IPC 消息投喂给正在运行的应用 ——
 * 浏览器里拿到的也是真实数据，不是任何形式的前端 mock。
 *
 * 本模块只做三件事：探测桥是否就绪、安装浏览器侧 shim、决定启动模式。
 * 不在此处发任何业务 IPC。
 *
 * 详见 `docs/architecture/07-web-dev-bridge.md`。
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
  /** 探测超时（毫秒），默认 {@link DEV_BRIDGE_PROBE_TIMEOUT_MS}。 */
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
 * 判定规则与插件自身的描述文件校验保持一致：`port` 必须是正整数
 * （Rust 侧在默认端口被占用时会退化为系统随机端口，所以不能假设端口号）。
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
