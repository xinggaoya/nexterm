import type { Tab } from "./tabsTypes";

export function basename(path: string): string {
  const parts = path.split(/[\\/]/).filter(Boolean);
  return parts.length ? parts[parts.length - 1] : "/";
}

export function tabLabel(tab: Tab): string {
  if (tab.kind === "terminal" && tab.terminalTitle) return tab.terminalTitle;
  if (tab.kind === "terminal" && tab.cwd) return basename(tab.cwd);
  return tab.title;
}
