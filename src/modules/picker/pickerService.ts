import type { FsDirEntry } from "@/lib/native";
import { basename, dirname, joinPath } from "@/lib/path";
import type { WorkspaceEnv } from "@/modules/workspace/workspaceEnvSnapshot";
import { normalizeWorkspacePath } from "@/modules/workspace/workspacePath";
import type { PickerMode } from "./pickerTypes";

/**
 * 环境感知的路径与目录项处理。
 *
 * webview 内部统一以 "/" 表示路径分隔符；WSL env 下就是 Linux 路径，
 * 本机 env 下是规范化后的 Windows 路径（`C:/...`）。这里不处理 UNC ——
 * UNC 只在"系统对话框返回结果"的边界上出现，应用内选择器不会产生它。
 */

export type PickerCrumb = {
  label: string;
  path: string;
};

const WINDOWS_DRIVE_RE = /^([A-Za-z]):(\/.*)?$/;

/** 面包屑段：从根到当前路径，每段带可点击的累计路径。 */
export function splitPickerPath(
  path: string,
  env: WorkspaceEnv,
): PickerCrumb[] {
  const normalized = normalizeWorkspacePath(path);
  if (env.kind === "wsl") {
    if (!normalized.startsWith("/")) return [];
    const crumbs: PickerCrumb[] = [{ label: "/", path: "/" }];
    let acc = "";
    for (const segment of normalized.split("/").filter(Boolean)) {
      acc = joinPath(acc || "/", segment);
      crumbs.push({ label: segment, path: acc });
    }
    return crumbs;
  }
  const drive = WINDOWS_DRIVE_RE.exec(normalized);
  if (!drive) return normalized ? [{ label: normalized, path: normalized }] : [];
  const root = `${drive[1].toUpperCase()}:/`;
  const crumbs: PickerCrumb[] = [{ label: `${drive[1].toUpperCase()}:`, path: root }];
  let acc = root;
  for (const segment of (drive[2] ?? "").split("/").filter(Boolean)) {
    acc = joinPath(acc, segment);
    crumbs.push({ label: segment, path: acc });
  }
  return crumbs;
}

/** 父目录；已在根时返回 null（“上一级”按钮据此禁用）。 */
export function parentPickerPath(
  path: string,
  env: WorkspaceEnv,
): string | null {
  const normalized = normalizeWorkspacePath(path);
  if (env.kind === "wsl") {
    if (!normalized.startsWith("/") || normalized === "/") return null;
    return dirname(normalized);
  }
  const drive = WINDOWS_DRIVE_RE.exec(normalized);
  if (!drive) return null;
  const rest = (drive[2] ?? "").replace(/^\/+|\/+$/g, "");
  if (!rest) return null;
  const cut = rest.lastIndexOf("/");
  if (cut === -1) return `${drive[1].toUpperCase()}:/`;
  return `${drive[1].toUpperCase()}:/${rest.slice(0, cut)}`;
}

export function joinPickerPath(dir: string, name: string): string {
  return joinPath(normalizeWorkspacePath(dir) || "/", name);
}

/** 目录项排序：文件夹优先，其后符号链接、文件，组内按名称排序。 */
export function sortPickerEntries(entries: FsDirEntry[]): FsDirEntry[] {
  const rank = (entry: FsDirEntry) =>
    entry.kind === "dir" ? 0 : entry.kind === "symlink" ? 1 : 2;
  return [...entries].sort(
    (a, b) => rank(a) - rank(b) || a.name.localeCompare(b.name),
  );
}

export function filterPickerEntries(
  entries: FsDirEntry[],
  query: string,
): FsDirEntry[] {
  const needle = query.trim().toLowerCase();
  if (!needle) return entries;
  return entries.filter((entry) => entry.name.toLowerCase().includes(needle));
}

/**
 * symlink 可能指向目录：双击时按目录尝试进入，读取失败会保留当前目录并
 * 显示错误，因此把它当作“可导航”处理是安全的。
 */
export function pickerEntryNavigable(entry: FsDirEntry): boolean {
  return entry.kind === "dir" || entry.kind === "symlink";
}

export function formatPickerSize(bytes: number): string {
  if (bytes < 1024) return `${bytes} B`;
  const units = ["KB", "MB", "GB", "TB"];
  let value = bytes;
  let unit = -1;
  do {
    value /= 1024;
    unit += 1;
  } while (value >= 1024 && unit < units.length - 1);
  return `${value >= 100 ? Math.round(value) : value.toFixed(1)} ${units[unit]}`;
}

export type PickerConfirm =
  | { ok: true; path: string }
  | { ok: false };

/**
 * 计算确认按钮的目标路径。
 * - directory 模式：选中了文件夹则用它，否则用当前目录（“选择此处”）。
 * - file 模式：手输文件名优先，其次选中的文件；选中文件夹时不可确认。
 */
export function resolvePickerConfirm(
  mode: PickerMode,
  currentPath: string,
  selected: FsDirEntry | null,
  typedName: string,
): PickerConfirm {
  if (!currentPath) return { ok: false };
  if (mode === "directory") {
    if (selected && selected.kind === "dir") {
      return { ok: true, path: joinPickerPath(currentPath, selected.name) };
    }
    return { ok: true, path: normalizeWorkspacePath(currentPath) };
  }
  const name = typedName.trim();
  if (name) return { ok: true, path: joinPickerPath(currentPath, name) };
  if (selected && selected.kind !== "dir") {
    return { ok: true, path: joinPickerPath(currentPath, selected.name) };
  }
  return { ok: false };
}

/** 快捷位置 / 列表行的展示名：取路径末段，根路径回退到自身。 */
export function pickerPlaceLabel(path: string): string {
  return basename(path) || path;
}
