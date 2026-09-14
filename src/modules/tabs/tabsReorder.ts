export type TabDropPlacement = "before" | "after";

// id 放宽为 string | number:标签页用 number,工作区列表(侧栏拖拽)用 string。
export type ReorderableTab = {
  id: string | number;
};

export function reorderTabs<T extends ReorderableTab>(
  tabs: T[],
  sourceId: T["id"],
  targetId: T["id"],
  placement: TabDropPlacement,
): T[] {
  if (tabs.length <= 1 || sourceId === targetId) return tabs;

  const sourceIndex = tabs.findIndex((tab) => tab.id === sourceId);
  const targetIndex = tabs.findIndex((tab) => tab.id === targetId);
  if (sourceIndex < 0 || targetIndex < 0) return tabs;
  if (placement === "before" && sourceIndex === targetIndex - 1) return tabs;
  if (placement === "after" && sourceIndex === targetIndex + 1) return tabs;

  const source = tabs[sourceIndex];
  const withoutSource = tabs.filter((tab) => tab.id !== sourceId);
  const targetIndexAfterRemoval = withoutSource.findIndex(
    (tab) => tab.id === targetId,
  );
  const insertIndex =
    placement === "before" ? targetIndexAfterRemoval : targetIndexAfterRemoval + 1;
  const next = [...withoutSource];
  next.splice(insertIndex, 0, source);
  return next;
}
