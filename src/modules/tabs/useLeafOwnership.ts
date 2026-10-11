import { computed, ref } from "vue";

/**
 * 分屏叶子 → 所属标签的反查表。
 *
 * OSC（cwd / title）事件在终端狂输出时是高频路径。如果每次都遍历工作区里
 * 所有终端标签的 paneTree 来找「这个 leafId 属于哪个 tab」，每次事件都会
 * 产生 O(标签数) 个新 tab 对象 —— 整个 SessionStrip 随之重渲。
 * 这张表把查找降到 O(1)。
 *
 * 独立成 composable 的理由：它是**纯数据结构**，没有 Pinia、没有 workspace
 * 依赖，可以脱离 store 直接单测；而它在 store 里原本只是十几行。
 */
export function useLeafOwnership() {
  /** wsId → (leafId → tabId) */
  const byWorkspace = ref<Record<string, Record<number, number>>>({});

  function register(wsId: string, tabId: number, leafId: number): void {
    const bucket = { ...(byWorkspace.value[wsId] ?? {}) };
    bucket[leafId] = tabId;
    byWorkspace.value = { ...byWorkspace.value, [wsId]: bucket };
  }

  function unregister(wsId: string, leafId: number): void {
    const bucket = byWorkspace.value[wsId];
    if (!bucket || !(leafId in bucket)) return;
    const next = { ...bucket };
    delete next[leafId];
    byWorkspace.value = { ...byWorkspace.value, [wsId]: next };
  }

  /** 标签被关闭 / 重置时清掉它名下所有叶子。 */
  function clearForTab(wsId: string, tabId: number): void {
    const bucket = byWorkspace.value[wsId];
    if (!bucket) return;
    let changed = false;
    const next: Record<number, number> = {};
    for (const [leafId, ownerId] of Object.entries(bucket)) {
      if (ownerId === tabId) {
        changed = true;
        continue;
      }
      next[Number(leafId)] = ownerId;
    }
    if (changed) {
      byWorkspace.value = { ...byWorkspace.value, [wsId]: next };
    }
  }

  function ownerOf(wsId: string, leafId: number): number | undefined {
    return byWorkspace.value[wsId]?.[leafId];
  }

  /** 工作区整体关闭时丢弃（工作区 id 会被复用吗？不会，id 含 env+path+序号）。 */
  function clearWorkspace(wsId: string): void {
    if (!(wsId in byWorkspace.value)) return;
    const next = { ...byWorkspace.value };
    delete next[wsId];
    byWorkspace.value = next;
  }

  /** 调试 / 测试用：某个工作区当前登记的 leaf → tab 映射快照。 */
  function snapshot(wsId: string): Record<number, number> {
    return { ...(byWorkspace.value[wsId] ?? {}) };
  }

  return {
    byWorkspace: computed(() => byWorkspace.value),
    register,
    unregister,
    clearForTab,
    clearWorkspace,
    ownerOf,
    snapshot,
  };
}

export type LeafOwnership = ReturnType<typeof useLeafOwnership>;
