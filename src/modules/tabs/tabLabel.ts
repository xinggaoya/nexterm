import { basename as pathBasename } from "@/lib/path";
import type { Tab } from "./tabsTypes";

export function basename(path: string): string {
  // 终端 cwd 的根场景显示 "/"（lib/path 的 basename 对空输入返回原值）。
  return pathBasename(path) || "/";
}

export function tabLabel(tab: Tab): string {
  if (tab.kind === "terminal" && tab.terminalTitle) return tab.terminalTitle;
  if (tab.kind === "terminal" && tab.cwd) return basename(tab.cwd);
  return tab.title;
}
