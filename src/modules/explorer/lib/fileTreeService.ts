import { native } from "@/lib/native";

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

export function readFileTreeDir(
  path: string,
  showHidden: boolean,
): Promise<DirEntry[]> {
  return native.fsReadDir(path, showHidden);
}

export async function createFileTreeEntry(
  path: string,
  kind: "file" | "dir",
): Promise<void> {
  if (kind === "dir") {
    await native.fsCreateDir(path);
  } else {
    await native.fsCreateFile(path);
  }
}

export function renameFileTreePath(from: string, to: string): Promise<void> {
  return native.fsRename(from, to);
}

export function deleteFileTreePath(path: string): Promise<void> {
  return native.fsDelete(path);
}

export function searchFileTree(
  root: string,
  query: string,
  showHidden: boolean,
): Promise<SearchResult> {
  return native.fsSearch(root, query, showHidden);
}
