/**
 * Public surface for the terminal module. v2 collapses the previous
 * renderer pool + session core into a single-session model and a small
 * pure layout helper. Other modules import through this file only.
 */

export { default as TerminalWorkspace } from "./TerminalWorkspace.vue";
export { default as TerminalPane } from "./TerminalPane.vue";
export { default as TerminalResizer } from "./TerminalResizer.vue";
export { default as TerminalSearch } from "./TerminalSearch.vue";
export { default as TerminalContextMenu } from "./TerminalContextMenu.vue";

export { TERMINAL_COMMAND_SPECS } from "./lib/commands";

export {
  findLeafCwd,
  findLeafTitle,
  hasLeaf,
  isLeaf,
  leafIds,
  nextLeafInDir,
  removeLeaf,
  resizeSplit,
  setLeafCwd,
  setLeafTitle,
  siblingLeafOf,
  splitLeaf,
  type LeafId,
  type PaneLeaf,
  type PaneNode,
  type PaneSplit,
  type SplitDir,
} from "./lib/layout";

export {
  createSession,
  disposeAllSessions,
  disposeSession,
  disposeWorkspaceSessions,
  getSessionForLeaf,
  trackSession,
  type PtySessionHandle,
  type SessionCallbacks,
  type SessionState,
} from "./lib/sessions";

export {
  applyTerminalTheme,
  buildTerminalTheme,
  watchTerminalTheme,
} from "./lib/theme";

export {
  handleOscData,
  type OscEvent,
  type OscResult,
} from "./lib/osc";

/**
 * Backwards-compatible aliases for code that referenced the v1 module
 * surface during the v2 migration. These are deprecated and will be
 * removed in a follow-up.
 */
import { getSessionForLeaf, disposeSession } from "./lib/sessions";
import { buildTerminalTheme } from "./lib/theme";

/**
 * Reapply the current document-level theme to every active terminal.
 * v2 subscribes per-pane via MutationObserver so this is a fallback
 * kept for the legacy `syncDocumentTheme` call in MainApp.
 */
export function applyTerminalSessionTheme(): void {
  // Per-pane watchTerminalTheme handles live updates. This global
  // call exists for the legacy MainApp integration and currently
  // doubles as a heartbeat — keep it cheap.
  void buildTerminalTheme();
}

/** @deprecated Use `getSessionForLeaf(workspaceId, leafId)?.write(...)`. */
export const createTerminalSessionHandle = (
  workspaceId: string,
  leafId: string | number,
) => {
  const id = String(leafId);
  const existing = getSessionForLeaf(workspaceId, id);
  if (existing) return existing;
  return {
    leafId: id,
    dispose: () => disposeSession(workspaceId, id),
    write: () => {},
    resize: () => {},
    restart: () => {},
  } as const;
};

/** @deprecated Use `getSessionForLeaf(workspaceId, leafId)?.ptyId` if you need the id. */
export const getPtyIdForLeaf = (
  workspaceId: string,
  leafId: string | number,
): number | null => {
  const handle = getSessionForLeaf(workspaceId, String(leafId));
  if (!handle) return null;
  return handle.ptyId;
};
