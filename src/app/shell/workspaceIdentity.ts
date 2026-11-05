/**
 * 工作区身份标识（monogram + 环境徽标）。
 *
 * 原先内联在 `Sidebar.vue` 里；侧栏下线后由顶栏的 `WorkspaceSwitcher`
 * 独占使用。抽成独立模块是因为「一个工作区长什么样」是**身份**问题，
 * 而不是「切换器长什么样」的布局问题 —— 两者不该绑在一起。
 */
import { ServerOutline, TerminalOutline } from "@vicons/ionicons5";
import type { WorkspaceInstance } from "@/modules/workspace";

/**
 * monogram 底色/前景取自 chart 色板。
 *
 * 用工作区 id 稳定散列而不是取名首字母的颜色：id 唯一，字母会撞车
 * （两个项目都叫 `api` 会拿到同一枚色块），而 id 不会。
 */
const MONOGRAM_HUES = [
  "var(--chart-1)",
  "var(--chart-2)",
  "var(--chart-3)",
  "var(--chart-4)",
  "var(--chart-5)",
] as const;

export function hueOf(id: string): string {
  let hash = 0;
  for (let i = 0; i < id.length; i++) {
    hash = (hash * 31 + id.charCodeAt(i)) | 0;
  }
  return MONOGRAM_HUES[Math.abs(hash) % MONOGRAM_HUES.length]!;
}

export function monogramStyle(id: string): Record<string, string> {
  const hue = hueOf(id);
  return {
    color: hue,
    backgroundColor: `color-mix(in oklch, ${hue} 18%, transparent)`,
  };
}

export function monogramOf(workspace: WorkspaceInstance): string {
  return (workspace.name.trim()[0] ?? "?").toUpperCase();
}

export type EnvBadge = "wsl" | "ssh" | null;

export function envBadgeOf(workspace: WorkspaceInstance): EnvBadge {
  if (workspace.env.kind === "wsl") return "wsl";
  if (workspace.env.kind === "ssh") return "ssh";
  return null;
}

/** 环境图标：WSL 用服务器，SSH 用终端，本机无图标。 */
export function envIconOf(workspace: WorkspaceInstance) {
  return envBadgeOf(workspace) === "ssh" ? TerminalOutline : ServerOutline;
}
