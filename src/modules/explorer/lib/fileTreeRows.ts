import {
  gitToneForChangedFile,
  strongerGitTone,
  type GitChangeTone,
} from "@/lib/gitStatus";
import type { GitChangedFile } from "@/lib/native";
import { joinPath, type DirEntry } from "./fileTreeService";

export type ChildrenState =
  | { status: "idle" }
  | { status: "loading" }
  | { status: "loaded"; entries: DirEntry[] }
  | { status: "error"; message: string };

export type FileTreeState = Record<string, ChildrenState>;

export type PendingCreate = {
  parentPath: string;
  kind: "file" | "dir";
};

export type FileTreeRow =
  | {
      kind: "entry";
      key: string;
      path: string;
      name: string;
      isDir: boolean;
      isExpanded: boolean;
      depth: number;
      gitTone: GitChangeTone | null;
    }
  | {
      kind: "rename";
      key: string;
      path: string;
      name: string;
      isDir: boolean;
      depth: number;
      gitTone: GitChangeTone | null;
    }
  | {
      kind: "pending";
      key: string;
      depth: number;
      pendingKind: "file" | "dir";
    }
  | {
      kind: "status";
      key: string;
      depth: number;
      tone: "muted" | "error";
      message: string;
    };

export function buildFileTreeRows({
  rootPath,
  nodes,
  expanded,
  pendingCreate,
  renaming,
  gitChangedFiles = [],
}: {
  rootPath: string;
  nodes: FileTreeState;
  expanded: Set<string>;
  pendingCreate: PendingCreate | null;
  renaming: string | null;
  gitChangedFiles?: GitChangedFile[];
}): { rows: FileTreeRow[]; entryIndexByPath: Map<string, number> } {
  const rows: FileTreeRow[] = [];
  const entryIndexByPath = new Map<string, number>();
  const gitToneByPath = buildGitToneIndex(rootPath, gitChangedFiles);

  const walk = (parent: string, depth: number) => {
    const node = nodes[parent];
    if (!node || node.status !== "loaded") return;
    for (const entry of node.entries) {
      const path = joinPath(parent, entry.name);
      const isDir = entry.kind === "dir";
      const isExpanded = isDir && expanded.has(path);
      if (renaming === path) {
        rows.push({
          kind: "rename",
          key: `rename:${path}`,
          path,
          name: entry.name,
          isDir,
          depth,
          gitTone: gitToneByPath.get(path) ?? null,
        });
      } else {
        entryIndexByPath.set(path, rows.length);
        rows.push({
          kind: "entry",
          key: path,
          path,
          name: entry.name,
          isDir,
          isExpanded,
          depth,
          gitTone: gitToneByPath.get(path) ?? null,
        });
      }

      if (!isDir || !isExpanded) continue;
      const child = nodes[path];
      if (pendingCreate?.parentPath === path) {
        rows.push({
          kind: "pending",
          key: `pending:${path}`,
          depth: depth + 1,
          pendingKind: pendingCreate.kind,
        });
      }
      if (child?.status === "loading") {
        rows.push({
          kind: "status",
          key: `loading:${path}`,
          depth: depth + 1,
          tone: "muted",
          message: "Loading...",
        });
      } else if (child?.status === "error") {
        rows.push({
          kind: "status",
          key: `error:${path}`,
          depth: depth + 1,
          tone: "error",
          message: child.message,
        });
      } else if (child?.status === "loaded") {
        walk(path, depth + 1);
      }
    }
  };

  walk(rootPath, 0);
  return { rows, entryIndexByPath };
}

function normalizePath(path: string): string {
  return path.replace(/\\/g, "/").replace(/\/+$/, "");
}

function changedFileAbsolutePath(rootPath: string, path: string): string {
  const normalized = normalizePath(path);
  if (normalized.startsWith("/")) return normalized;
  return `${normalizePath(rootPath)}/${normalized}`;
}

export function buildGitToneIndex(
  rootPath: string,
  gitChangedFiles: GitChangedFile[],
): Map<string, GitChangeTone> {
  const index = new Map<string, GitChangeTone>();
  const normalizedRoot = normalizePath(rootPath);

  for (const file of gitChangedFiles) {
    const tone = gitToneForChangedFile(file);
    const path = changedFileAbsolutePath(normalizedRoot, file.path);
    index.set(path, strongerGitTone(index.get(path) ?? null, tone)!);

    let cursor = path;
    while (cursor !== normalizedRoot) {
      const slash = cursor.lastIndexOf("/");
      if (slash <= 0) break;
      cursor = cursor.slice(0, slash);
      if (cursor.length < normalizedRoot.length) break;
      index.set(cursor, strongerGitTone(index.get(cursor) ?? null, tone)!);
    }
  }

  return index;
}
