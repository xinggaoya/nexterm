import type { EditorTab, Tab } from "./tabsTypes";

function basename(path: string): string {
  const parts = path.split(/[\\/]/).filter(Boolean);
  return parts.length ? parts[parts.length - 1] : path;
}

function dirtyEditorLabel(tab: EditorTab): string {
  return tab.title || basename(tab.path);
}

export function isDirtyEditorTab(tab: Tab | undefined | null): tab is EditorTab {
  return tab?.kind === "editor" && tab.dirty;
}

export function dirtyEditorTabs(tabs: readonly Tab[]): EditorTab[] {
  return tabs.filter(isDirtyEditorTab);
}

export function describeDirtyEditorTabs(tabs: readonly Tab[]): string {
  const dirtyTabs = dirtyEditorTabs(tabs);
  if (dirtyTabs.length === 0) return "No unsaved files";
  if (dirtyTabs.length === 1) return dirtyEditorLabel(dirtyTabs[0]);
  return `${dirtyTabs.length} unsaved files: ${dirtyTabs
    .map(dirtyEditorLabel)
    .join(", ")}`;
}
