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

export function copyFileTreePath(from: string, to: string): Promise<void> {
  return native.fsCopy(from, to);
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

function basename(path: string): string {
  const parts = path.split(/[\\/]/).filter(Boolean);
  return parts.length > 0 ? parts[parts.length - 1] : path;
}

export function searchFileTree(
  root: string,
  query: string,
  showHidden: boolean,
): Promise<SearchResult> {
  return native.fsSearch(root, query, showHidden);
}
