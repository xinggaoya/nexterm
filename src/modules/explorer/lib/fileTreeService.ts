import { basename } from "@/lib/path";
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

export function copyFileTreePath(
  wsNative: WorkspaceNative,
  from: string,
  to: string,
): Promise<void> {
  return wsNative.fsCopy(from, to);
}

/**
 * Generate a "copy" target name next to `source` that doesn't already
 * exist. `foo.txt` → `foo copy.txt` → `foo copy 2.txt` → ... Up to 100
 * attempts to avoid infinite loops on pathological inputs.
 */
export function generateCopyTarget(source: string): string {
  const parent = dirname(source);
  const baseName = basename(source);
  const dot = baseName.lastIndexOf(".");
  const stem = dot > 0 ? baseName.slice(0, dot) : baseName;
  const ext = dot > 0 ? baseName.slice(dot) : "";
  for (let n = 0; n < 100; n++) {
    const candidate =
      n === 0
        ? joinPath(parent, `${stem} copy${ext}`)
        : joinPath(parent, `${stem} copy ${n + 1}${ext}`);
    return candidate; // Server-side fsCopy will reject collisions; we
                      // only need a sensible first guess. The caller is
                      // expected to retry on "already exists" if it
                      // cares about collision-free naming.
  }
  return joinPath(parent, `${stem} copy${ext}`);
}

export function searchFileTree(
  wsNative: WorkspaceNative,
  root: string,
  query: string,
  showHidden: boolean,
): Promise<SearchResult> {
  return wsNative.fsSearch(root, query, showHidden);
}
