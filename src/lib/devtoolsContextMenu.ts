/**
 * CrabNebula DevTools（`tauri-plugin-devtools-app`）会给每个 webview 注入一段
 * 初始化脚本：它在 `document` 上监听 `contextmenu`，调用
 * `plugin:devtools-app|show_context_menu` 弹出插件自带的原生右键菜单
 * （Reload / Inspect / Open Devtools）。
 *
 * Nexterm 的终端、文件树、标签栏都自带右键菜单，原生菜单会与之叠加出现，
 * 而且其中的 "Reload" 会重载整个界面。这里只拦截这一条命令，保留 Nexterm 自己的
 * 右键菜单；DevTools 面板本身通过快捷键或设置页入口打开，不受影响。
 *
 * 详见 `docs/architecture/06-crabnebula-devtools.md`。
 */

/** 被拦截的插件命令：原生右键菜单。 */
const SUPPRESSED_COMMANDS = new Set(["plugin:devtools-app|show_context_menu"]);

type InvokeFn = (cmd: string, ...args: unknown[]) => Promise<unknown>;

interface TauriInternals {
  invoke?: InvokeFn;
  /** 幂等标记，避免重复包装。 */
  __nextermDevtoolsContextMenuGuard?: boolean;
}

/** 该命令是否应被拦截。 */
export function isSuppressedDevtoolsCommand(cmd: string): boolean {
  return SUPPRESSED_COMMANDS.has(cmd);
}

/**
 * 安装拦截器。返回是否成功安装（不在 Tauri 环境中时返回 false）。
 */
export function suppressDevtoolsNativeContextMenu(
  target: Window = window,
): boolean {
  const internals = (target as unknown as { __TAURI_INTERNALS__?: TauriInternals })
    .__TAURI_INTERNALS__;
  const original = internals?.invoke;
  if (!internals || typeof original !== "function") return false;
  if (internals.__nextermDevtoolsContextMenuGuard) return false;
  internals.__nextermDevtoolsContextMenuGuard = true;
  internals.invoke = function patchedInvoke(cmd: string, ...args: unknown[]) {
    if (isSuppressedDevtoolsCommand(cmd)) return Promise.resolve(undefined);
    return original.call(internals, cmd, ...args);
  };
  return true;
}
