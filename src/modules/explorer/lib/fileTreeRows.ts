import { joinPath, type DirEntry } from "./fileTreeService";
import type { GitPathDecoration } from "@/modules/source-control";

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
      gitDecoration?: GitPathDecoration;
    }
  | {
      kind: "rename";
      key: string;
      path: string;
      name: string;
      isDir: boolean;
      depth: number;
      gitDecoration?: GitPathDecoration;
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
  gitDecorations,
}: {
  rootPath: string;
  nodes: FileTreeState;
  expanded: Set<string>;
  pendingCreate: PendingCreate | null;
  renaming: string | null;
  gitDecorations?: Map<string, GitPathDecoration>;
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
          gitDecoration: gitDecorations?.get(path),
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
          gitDecoration: gitDecorations?.get(path),
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

export type FileTreeSnapshot = {
  rows: FileTreeRow[];
  entryIndexByPath: Map<string, number>;
};

/**
 * Incrementally update the tree rows for a set of changed directory paths.
 * For each changed path that is expanded and present in entryIndexByPath,
 * find the row range occupied by its subtree, rebuild just that fragment,
 * and splice it in place.
 *
 * The root path is special-cased: it never appears in `entryIndexByPath`
 * (because it isn't a child of any other row), so its children are patched
 * by doing a full `buildFileTreeRows` and replacing the rows wholesale.
 * Without this branch a silent refresh of the root directory — which is
 * exactly what `FileExplorer.scheduleTreeRefresh` does whenever a file
 * event bubbles up to the workspace root — is a silent no-op.
 *
 * Returns the updated snapshot. If none of the changedPaths are visible,
 * returns the same rows array unchanged.
 */
export function updateFileTreeRows(
  prev: FileTreeSnapshot,
  changedPaths: string[],
  params: {
    rootPath: string;
    nodes: FileTreeState;
    expanded: Set<string>;
    pendingCreate: PendingCreate | null;
    renaming: string | null;
    gitDecorations?: Map<string, GitPathDecoration>;
  },
): FileTreeSnapshot {
  if (changedPaths.length === 0) return prev;

  let rows = prev.rows;
  // Skip the deep clone when no changes are visible: cheap O(M) copy
  // on a Map that is never used. The patch path itself only needs the
  // Map when it actually splices.
  const maybeEntryIndexByPath = prev.entryIndexByPath;
  let entryIndexByPath: Map<string, number> | null = null;
  let mutated = false;

  // Process paths from deepest to shallowest so index shifts from
  // earlier splices don't affect later ones at the same level.
  const sorted = [...changedPaths].sort((a, b) => b.length - a.length);

  for (const dirPath of sorted) {
    // Root refresh: rebuild the entire visible tree. `entryIndexByPath`
    // is also reset so any later subtree patches in this call look up
    // their dirIdx in the freshly rebuilt index.
    if (dirPath === params.rootPath) {
      const fresh = buildFileTreeRows({
        rootPath: params.rootPath,
        nodes: params.nodes,
        expanded: params.expanded,
        pendingCreate: params.pendingCreate,
        renaming: params.renaming,
        gitDecorations: params.gitDecorations,
      });
      mutated = true;
      rows = fresh.rows;
      entryIndexByPath = fresh.entryIndexByPath;
      continue;
    }

    // Materialize the working copy of the index lazily, on the first
    // splice that needs to mutate it. `maybeEntryIndexByPath` is the
    // original Map from `prev`; once we've cloned it the variable
    // points to the working copy for the rest of the call.
    const dirIdx = (entryIndexByPath ?? maybeEntryIndexByPath).get(dirPath);
    // Directory not visible in the tree, skip
    if (dirIdx === undefined) continue;

    const dirRow = rows[dirIdx];
    if (dirRow.kind !== "entry" || !dirRow.isExpanded) continue;

    const dirDepth = dirRow.depth;
    // The subtree starts right after the directory entry row.
    // Walk forward until we hit a row at the same or shallower depth.
    let endIdx = dirIdx + 1;
    while (endIdx < rows.length) {
      const r = rows[endIdx];
      // depth check: rows at same depth or shallower belong to the parent
      if (r.depth <= dirDepth) break;
      endIdx++;
    }

    // Build replacement fragment for this directory's children
    const fragment: FileTreeRow[] = [];
    const fragmentIndex = new Map<string, number>();

    const walkFragment = (parent: string, depth: number) => {
      const node = params.nodes[parent];
      if (!node || node.status !== "loaded") return;
      for (const entry of node.entries) {
        const path = joinPath(parent, entry.name);
        const isDir = entry.kind === "dir";
        const isExpanded = isDir && params.expanded.has(path);
        if (params.renaming === path) {
          fragment.push({
            kind: "rename",
            key: `rename:${path}`,
            path,
            name: entry.name,
            isDir,
            depth,
            gitDecoration: params.gitDecorations?.get(path),
          });
        } else {
          fragmentIndex.set(path, fragment.length);
          fragment.push({
            kind: "entry",
            key: path,
            path,
            name: entry.name,
            isDir,
            isExpanded,
            depth,
            gitDecoration: params.gitDecorations?.get(path),
          });
        }

        if (!isDir || !isExpanded) continue;
        const child = params.nodes[path];
        if (params.pendingCreate?.parentPath === path) {
          fragment.push({
            kind: "pending",
            key: `pending:${path}`,
            depth: depth + 1,
            pendingKind: params.pendingCreate.kind,
          });
        }
        if (child?.status === "loading") {
          fragment.push({
            kind: "status",
            key: `loading:${path}`,
            depth: depth + 1,
            tone: "muted",
            message: "Loading...",
          });
        } else if (child?.status === "error") {
          fragment.push({
            kind: "status",
            key: `error:${path}`,
            depth: depth + 1,
            tone: "error",
            message: child.message,
          });
        } else if (child?.status === "loaded") {
          walkFragment(path, depth + 1);
        }
      }
    };

    walkFragment(dirPath, dirDepth + 1);

    // Lazy clone the index only on the first splice that needs it.
    if (entryIndexByPath === null) {
      entryIndexByPath = new Map(maybeEntryIndexByPath);
    }

    // Remove old entries from index that are being replaced
    for (let i = dirIdx + 1; i < endIdx; i++) {
      const r = rows[i];
      if (r.kind === "entry") {
        entryIndexByPath.delete(r.path);
      }
    }

    // Splice the new fragment in
    if (!mutated) {
      rows = [...rows]; // copy-on-write
      mutated = true;
    }
    rows.splice(dirIdx + 1, endIdx - dirIdx - 1, ...fragment);

    // Fix entryIndexByPath for rows that were after the old subtree.
    // These must be adjusted BEFORE adding the new fragment entries,
    // otherwise the fragment entries themselves get shifted. We only
    // touch entries that need shifting (idx >= endIdx) instead of
    // re-iterating the entire Map, which is the common hot path
    // (large trees, many Map entries that aren't affected by a single
    // subtree patch).
    const delta = fragment.length - (endIdx - dirIdx - 1);
    if (delta !== 0) {
      // Collect first, mutate after. Adjusting in place while iterating
      // a Map is safe in JS, but pulling the keys up front keeps the
      // inner loop branch-free.
      const toShift: string[] = [];
      for (const [path, idx] of entryIndexByPath) {
        if (idx >= endIdx) toShift.push(path);
      }
      for (const path of toShift) {
        const idx = entryIndexByPath.get(path) as number;
        entryIndexByPath.set(path, idx + delta);
      }
    }

    // Add new entries to the index — offset is dirIdx + 1
    for (const [path, fragIdx] of fragmentIndex) {
      entryIndexByPath.set(path, dirIdx + 1 + fragIdx);
    }
  }

  if (!mutated) return prev;
  return { rows, entryIndexByPath: entryIndexByPath ?? maybeEntryIndexByPath };
}
