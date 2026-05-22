export type TabDropPlacement = "before" | "after";

export type ReorderableTab = {
  id: number;
};

export function reorderTabs<T extends ReorderableTab>(
  tabs: T[],
  sourceId: number,
  targetId: number,
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
