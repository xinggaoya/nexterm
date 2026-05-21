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
    }
  | {
      kind: "rename";
      key: string;
      path: string;
      name: string;
      isDir: boolean;
      depth: number;
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
}: {
  rootPath: string;
  nodes: FileTreeState;
  expanded: Set<string>;
  pendingCreate: PendingCreate | null;
  renaming: string | null;
}): { rows: FileTreeRow[]; entryIndexByPath: Map<string, number> } {
  const rows: FileTreeRow[] = [];
  const entryIndexByPath = new Map<string, number>();

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
