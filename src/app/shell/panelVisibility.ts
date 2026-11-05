import type { WorkspacePanelTab } from "@/modules/settings/store";

/**
 * 面板视图「切换」的落点（纯函数，便于单测）。
 *
 * 停靠面板有两个视图：文件树（explorer）与更改（changes）。命令
 * `panel.explorer.toggle` / `panel.sourceControl.toggle` 的语义分两种：
 *
 * - **面板可见**：在两个视图之间来回切（旧行为，不变）。
 * - **面板收起**：切到指定视图 —— 收起状态下按「切换资源管理器」，
 *   用户期待在文件树里看到它，而不是莫名其妙跳到另一个视图。
 *   （由调用方负责把面板展开，`setPanelTab` 里已经做了。）
 */
export function resolvePanelTabToggle(
  current: WorkspacePanelTab,
  requested: WorkspacePanelTab,
  panelVisible: boolean,
): WorkspacePanelTab {
  if (!panelVisible) return requested;
  if (current !== requested) return requested;
  return requested === "explorer" ? "changes" : "explorer";
}
