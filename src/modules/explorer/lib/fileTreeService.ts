import { invoke } from "@tauri-apps/api/core";
import { currentWorkspaceEnv } from "@/modules/workspace/workspaceEnvSnapshot";

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

export function joinPath(parent: string, name: string): string {
  if (parent.endsWith("/")) return `${parent}${name}`;
  return `${parent}/${name}`;
}

export function dirname(path: string): string {
  const i = path.lastIndexOf("/");
  if (i <= 0) return "/";
  return path.slice(0, i);
}

export async function readFileTreeDir(
  path: string,
  showHidden: boolean,
): Promise<DirEntry[]> {
  return invoke<DirEntry[]>("fs_read_dir", {
    path,
    showHidden,
    workspace: currentWorkspaceEnv(),
  });
}

export async function createFileTreeEntry(
  path: string,
  kind: "file" | "dir",
): Promise<void> {
  const cmd = kind === "dir" ? "fs_create_dir" : "fs_create_file";
  await invoke(cmd, { path, workspace: currentWorkspaceEnv() });
}

export async function renameFileTreePath(
  from: string,
  to: string,
): Promise<void> {
  await invoke("fs_rename", {
    from,
    to,
    workspace: currentWorkspaceEnv(),
  });
}

export async function deleteFileTreePath(path: string): Promise<void> {
  await invoke("fs_delete", { path, workspace: currentWorkspaceEnv() });
}

export async function searchFileTree(
  root: string,
  query: string,
  showHidden: boolean,
): Promise<SearchResult> {
  return invoke<SearchResult>("fs_search", {
    root,
    query,
    limit: 200,
    showHidden,
    workspace: currentWorkspaceEnv(),
  });
}
