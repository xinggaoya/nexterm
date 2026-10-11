import { useDialog } from "naive-ui";

import { t } from "@/modules/i18n/translate";

import { describeDirtyEditorTabs, dirtyEditorTabs, isDirtyEditorTab } from "./closeGuards";
import type { Tab } from "./tabsTypes";

/**
 * 关闭标签的**唯一**确认入口。
 *
 * 之前鼠标点 ✕ 直接绑 `tabs.closeTab`，绕过了 `requestCloseTab` 里的
 * `isDirtyEditorTab` 判断 —— 一次右键「关闭其他」就会连带丢弃多个未保存
 * 的编辑器。store 本身无法弹窗（它不知道 i18n / dialog），所以确认逻辑放在
 * 这里，由所有关闭路径（鼠标 ✕、右键菜单、命令面板、快捷键）共同调用。
 */
export type TabCloseGuard = {
  /** 关闭单个标签；脏文件会先弹确认。 */
  requestCloseTab: (id: number, tabs: readonly Tab[], close: (id: number) => void) => void;
  /**
   * 批量关闭。列出将被丢弃的脏文件，一次确认。
   * `describe` 决定弹窗标题（例如「关闭其他」vs「关闭窗口」）。
   */
  requestCloseMany: (options: {
    targets: readonly Tab[];
    dirty?: readonly Tab[];
    title: string;
    contentKey: string;
    close: () => void;
  }) => void;
};

export function useTabCloseGuard(): TabCloseGuard {
  const dialog = useDialog();

  function requestCloseTab(
    id: number,
    tabs: readonly Tab[],
    close: (id: number) => void,
  ): void {
    const tab = tabs.find((item) => item.id === id);
    if (!tab) return;
    if (!isDirtyEditorTab(tab)) {
      close(id);
      return;
    }
    dialog.warning({
      title: t("app.unsaved.closeFileTitle"),
      content: t("app.unsaved.closeFileContent", {
        files: describeDirtyEditorTabs([tab]),
      }),
      positiveText: t("app.unsaved.closeWithoutSaving"),
      negativeText: t("common.cancel"),
      positiveButtonProps: { type: "error" },
      onPositiveClick: () => close(id),
    });
  }

  function requestCloseMany(options: {
    targets: readonly Tab[];
    dirty?: readonly Tab[];
    title: string;
    contentKey: string;
    close: () => void;
  }): void {
    const dirty = options.dirty ?? dirtyEditorTabs(options.targets);
    if (dirty.length === 0) {
      options.close();
      return;
    }
    dialog.warning({
      title: options.title,
      content: t(options.contentKey as never, {
        files: describeDirtyEditorTabs(dirty),
      }),
      positiveText: t("app.unsaved.closeWithoutSaving"),
      negativeText: t("common.cancel"),
      positiveButtonProps: { type: "error" },
      onPositiveClick: () => options.close(),
    });
  }

  return { requestCloseTab, requestCloseMany };
}
