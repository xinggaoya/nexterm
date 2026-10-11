import {
  deserializeTerminals,
  serializeTerminal,
  isWorthPersisting,
} from "@/modules/terminal/lib/sessionRestore";
import type { PersistedTerminalLayout } from "@/modules/terminal/lib/sessionRestore";
import type { TerminalTab } from "./tabsTypes";

/**
 * 终端布局的防抖写盘。
 *
 * 抽出来是因为这段逻辑**完全不需要响应式**：它只在防抖定时器与一次性的
 * 快照读写里活动。留在 store 里时它既无法单测（要拉起整个 Pinia），又会
 * 让 store 的结构被持久化细节撑大。
 *
 * tabs store 刻意**不**依赖 preferencesPinia —— 标签恢复发生在 WorkspaceHost
 * 挂载早期，那一刻偏好可能还没 hydrate，耦合它会带来初始化顺序问题。快照由
 * 应用入口在 hydrate 之后注入（`setTerminalLayoutSnapshot`），读不到时由调用
 * 方走磁盘的异步路径。
 */
const LAYOUT_PERSIST_DEBOUNCE_MS = 500;

export type TerminalLayoutPersistState = {
  /** 应用入口在偏好 hydrate 之后注入快照。 */
  setSnapshot: (snapshot: Record<string, PersistedTerminalLayout>) => void;
  /** 取内存快照（同步恢复路径）。 */
  snapshotFor: (wsId: string) => PersistedTerminalLayout | undefined;
  /** 防抖排队。写盘动作由调用方提供 —— store 才知道当前有哪些终端标签。 */
  schedulePersist: (wsId: string) => void;
  /** 立即 flush（工作区关闭 / 应用退出时用）。 */
  flush: (wsId: string) => void;
  /** 丢弃排队中的定时器（工作区被销毁时用）。 */
  cancel: (wsId: string) => void;
};

export function useTerminalLayoutPersistence(params: {
  /** 读当前工作区的终端标签。 */
  readTerminalTabs: (wsId: string) => TerminalTab[];
  /** 读当前活动标签 id，用于算 activeTerminalIndex。 */
  readActiveTabId: (wsId: string) => number;
  /** 写盘。后端把布局存进偏好 store。 */
  write: (wsId: string, layout: PersistedTerminalLayout | null) => Promise<void>;
}): TerminalLayoutPersistState {
  const timers = new Map<string, ReturnType<typeof setTimeout>>();
  let snapshot: Record<string, PersistedTerminalLayout> = {};

  async function persistNow(wsId: string): Promise<void> {
    const list = params.readTerminalTabs(wsId);
    if (!isWorthPersisting(list)) {
      // 退化回「只有一个裸 shell」时不留痕：否则每次启动都会恢复出一个
      // 看起来多余的空终端。
      await params.write(wsId, null);
      return;
    }
    const terminals = list
      .map((tab) => serializeTerminal(tab))
      .filter((entry): entry is NonNullable<typeof entry> => entry !== null);
    if (terminals.length === 0) return;
    const activeIndex = list.findIndex((tab) => tab.id === params.readActiveTabId(wsId));
    await params.write(wsId, {
      terminals,
      activeTerminalIndex: activeIndex < 0 ? 0 : activeIndex,
    });
  }

  function schedulePersist(wsId: string): void {
    const existing = timers.get(wsId);
    if (existing) clearTimeout(existing);
    timers.set(
      wsId,
      setTimeout(() => {
        timers.delete(wsId);
        void persistNow(wsId).catch((error) => {
          console.warn("[tabs] persist terminal layout failed", error);
        });
      }, LAYOUT_PERSIST_DEBOUNCE_MS),
    );
  }

  return {
    setSnapshot: (next) => {
      snapshot = next ?? {};
    },
    snapshotFor: (wsId) => snapshot[wsId],
    schedulePersist,
    flush: (wsId) => {
      const existing = timers.get(wsId);
      if (existing) {
        clearTimeout(existing);
        timers.delete(wsId);
      }
      void persistNow(wsId).catch((error) => {
        console.warn("[tabs] flush terminal layout failed", error);
      });
    },
    cancel: (wsId) => {
      const existing = timers.get(wsId);
      if (!existing) return;
      clearTimeout(existing);
      timers.delete(wsId);
    },
  };
}

export { deserializeTerminals };
