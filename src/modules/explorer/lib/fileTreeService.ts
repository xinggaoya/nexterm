import type { WorkspaceNative } from "@/lib/native";

export type DirEntry = {
  name: string;
  kind: "file" | "dir" | "symlink";
  size: number;
  mtime: number;
};

export type SearchHit = {
  path: string;
  rel: string;
  name: string;
  is_dir: boolean;
};

export type SearchResult = {
  hits: SearchHit[];
  truncated: boolean;
};

import { dirname, joinPath } from "@/lib/path";

export { dirname, joinPath };

export function readFileTreeDir(
  wsNative: WorkspaceNative,
  path: string,
  showHidden: boolean,
): Promise<DirEntry[]> {
  return wsNative.fsReadDir(path, showHidden);
}

export async function createFileTreeEntry(
  wsNative: WorkspaceNative,
  path: string,
  kind: "file" | "dir",
): Promise<void> {
  if (kind === "dir") {
    await wsNative.fsCreateDir(path);
  } else {
    await wsNative.fsCreateFile(path);
  }
}

export function renameFileTreePath(
  wsNative: WorkspaceNative,
  from: string,
  to: string,
): Promise<void> {
  return wsNative.fsRename(from, to);
}

export function deleteFileTreePath(
  wsNative: WorkspaceNative,
  path: string,
): Promise<void> {
  return wsNative.fsDelete(path);
}

// 复制 / 改名目标名的生成已收敛到 lib/fileTransfer.ts（与后端 fs-core 的
// next_free_target 同一套规则）。单条 fs_copy 也不再包一层：重复操作与
// 拖拽 / 粘贴共用 fs_copy_many，符号链接处理只有后端一处实现。

export function searchFileTree(
  wsNative: WorkspaceNative,
  root: string,
  query: string,
  showHidden: boolean,
): Promise<SearchResult> {
  return wsNative.fsSearch(root, query, showHidden);
}
