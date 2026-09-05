/**
 * SshConnectDialog 的命令式挂载助手。
 *
 * 为什么独立于 pinia store:打开工作区的入口分散在欢迎页 / 标题栏 /
 * 新窗口流程,全部最终汇聚到 workspaceRootPinia.pickWorkspaceDirectory;
 * 该 store 无 UI 上下文,用 Promise 化的 detached mount 注入对话框。
 */

import { createApp } from "vue";
import SshConnectDialog, { type SshConnectResult } from "./SshConnectDialog.vue";

export type { SshConnectResult };

export function openSshConnectDialog(): Promise<SshConnectResult | null> {
  return new Promise((resolve) => {
    const host = document.createElement("div");
    document.body.appendChild(host);
    let settled = false;
    const finish = (result: SshConnectResult | null) => {
      if (settled) return;
      settled = true;
      resolve(result);
      app.unmount();
      host.remove();
    };
    const app = createApp(SshConnectDialog, {
      onConfirm: (result: SshConnectResult) => finish(result),
      onCancel: () => finish(null),
    });
    app.mount(host);
  });
}
