/**
 * 吞掉 CrabNebula DevTools 插件注入脚本产生的未捕获 rejection。
 *
 * 背景：`tauri-plugin-devtools-app` 会给每个 webview 注入一段脚本，它在
 * **每一次** `contextmenu` 事件上调用 `plugin:devtools-app|show_context_menu`，
 * 用来弹出插件自带的原生右键菜单（Reload / Inspect / Open Devtools）。
 *
 * Nexterm 的终端、文件树、标签栏都有自定义右键菜单，两者叠加会让用户不知道
 * 该点哪个；插件菜单里的 "Reload" 还会重载整个界面。所以我们**故意不授权**
 * 这条命令（capability 里没有 `devtools-app:allow-show-context-menu`），
 * Tauri 会直接把它从 webview 的可用命令表里剔除 —— 原生菜单根本弹不出来。
 *
 * 但插件脚本没有 catch 这个失败，未授权的命令会变成一条 unhandled rejection，
 * 于是**每次右键**都在 console 里留下一条
 * `Command show_context_menu not found`。这里定向吞掉这一条：只匹配
 * `show_context_menu`，其它 rejection 照常上抛，不会掩盖真实问题。
 *
 * 注：早先这里曾试图改写 `window.__TAURI_INTERNALS__.invoke` 来拦截命令，
 * 但 Tauri v2 用 `Object.defineProperty` 定义该属性（不可写、不可配置），
 * 赋值会抛 TypeError 并让整个应用白屏。拦截命令这条路在 Tauri v2 走不通，
 * 改用「不授权 + 吞掉 rejection」。
 */

/** 被吞掉的 rejection 特征串。 */
const SUPPRESSED_PATTERN = /show_context_menu/;

/** 判断一条 rejection 是否来自被禁用的 devtools 原生右键菜单。 */
export function isDevtoolsContextMenuRejection(reason: unknown): boolean {
  if (reason === null || reason === undefined) return false;
  const text =
    typeof reason === "string"
      ? reason
      : reason instanceof Error
        ? reason.message
        : String(reason);
  return SUPPRESSED_PATTERN.test(text);
}

/**
 * 安装过滤器。返回一个卸载函数。
 *
 * 只在浏览器环境有意义（jsdom 下的单测可以直接调用）。
 */
export function installDevtoolsContextMenuRejectionGuard(
  target: Window = window,
): () => void {
  const handler = (event: Event): void => {
    const rejection = event as PromiseRejectionEvent;
    if (!isDevtoolsContextMenuRejection(rejection.reason)) return;
    // preventDefault 会阻止浏览器把这条 rejection 打到 console。
    rejection.preventDefault();
  };
  target.addEventListener("unhandledrejection", handler);
  return () => target.removeEventListener("unhandledrejection", handler);
}
