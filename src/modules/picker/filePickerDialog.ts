/**
 * FilePickerDialog 的命令式挂载助手。
 *
 * 打开工作区的入口分散在欢迎页 / 标题栏 / 命令面板，全部汇聚到
 * workspaceRootPinia.pickWorkspaceDirectory；该 store 无 UI 上下文，
 * 与 sshConnectDialog 一样用 Promise 化的 detached mount 注入对话框。
 */

import { createApp, defineComponent, h } from "vue";
import { NConfigProvider } from "naive-ui";
import { readCurrentNaiveThemeConfig } from "@/modules/theme/naiveTheme";
import FilePickerDialog from "./FilePickerDialog.vue";
import type { FilePickerOptions } from "./pickerTypes";

export function openFilePicker(options: FilePickerOptions): Promise<string | null> {
  return new Promise((resolve) => {
    const host = document.createElement("div");
    document.body.appendChild(host);
    let settled = false;
    const finish = (result: string | null) => {
      if (settled) return;
      settled = true;
      resolve(result);
      app.unmount();
      host.remove();
    };
    const { theme, themeOverrides } = readCurrentNaiveThemeConfig();
    const app = createApp(
      defineComponent({
        setup: () => () =>
          h(
            NConfigProvider,
            { theme, themeOverrides },
            {
              default: () =>
                h(FilePickerDialog, {
                  options,
                  onConfirm: (path: string) => finish(path),
                  onCancel: () => finish(null),
                }),
            },
          ),
      }),
    );
    app.mount(host);
  });
}
