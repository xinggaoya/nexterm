import { t } from "@/modules/i18n/translate";

import { hasTauriInternals } from "./tauriRuntime";

/**
 * 深链打开工作区前的用户确认。
 *
 * 深链是**外部输入**：`nexterm://open?workspacePath=C:\Users\x\.ssh` 这种
 * 链接一旦被诱导点击，`workspace_authorize` 就会把那个目录写进授权注册表
 * —— 而授权就是后续所有 `fs_*` 读写命令的通行证。所以「点链接」不能等价于
 * 「授权目录」，中间必须有一个人类手势。
 *
 * 这条路径在 `app.mount()` 之前运行，拿不到 Vue 的 `useDialog`，因此用
 * `window.confirm`：语义上更保守（不可用时降级为「拒绝」），也不会因为
 * Naive UI 的 dialog provider 尚未挂载而静默放行。`i18n` 在这条路径之前
 * 已经 `app.use()` 过，所以 `t()` 可用。
 */
export function confirmDeepLinkWorkspace(path: string): boolean {
  if (!hasTauriInternals()) return false;
  const message = `${t("app.deepLink.confirmTitle")}\n\n${path}\n\n${t(
    "app.deepLink.confirmBody",
  )}`;
  try {
    return window.confirm(message);
  } catch {
    // 没有可用 UI（例如被企业策略禁用）时宁可不授权。
    return false;
  }
}
