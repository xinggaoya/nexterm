import type { GitChangedFile } from "@/lib/native";
import {
  statusKindFromCode,
  type SourceControlStatusKind,
} from "./sourceControlModel";

export type GitPathDecoration = {
  statusKind: SourceControlStatusKind;
  staged: boolean;
  unstaged: boolean;
  hasDescendantChanges: boolean;
  count: number;
};

export type GitDecorationMap = Map<string, GitPathDecoration>;

// Pre-computed rank lookup so we can compare status priority with a
// single object property access instead of an `Array.indexOf` scan on
// every ancestor merge. The hottest path in `buildGitDecorationMap`
// runs once per (file × ancestor), which can add up to tens of
// thousands of comparisons for a large monorepo.
const STATUS_RANK: Readonly<Record<SourceControlStatusKind, number>> = {
  conflict: 0,
  deleted: 1,
  modified: 2,
  added: 3,
  untracked: 4,
  renamed: 5,
};

export function buildGitDecorationMap(
  repoRoot: string | null,
  files: GitChangedFile[],
): GitDecorationMap {
  const out: GitDecorationMap = new Map();
  if (!repoRoot) return out;
  const normalizedRoot = normalizePath(repoRoot);
  const rootWithSlash = normalizedRoot === "/" ? "/" : normalizedRoot;

  for (const file of files) {
    const absolutePath = joinPath(rootWithSlash, file.path);
    const statusKind = statusKindForFile(file);
    mergeDecoration(out, absolutePath, statusKind, file.staged, file.unstaged, false);

    // Walk ancestors. The previous implementation recomputed
    // `normalizePath` on the root inside the loop, called
    // `isWithinRoot` (which also normalized both sides), and allocated
    // a fresh `next` object for every ancestor of every file. We cache
    // the root once, use a single allocation for the scratch
    // decoration, and short-circuit on the first ancestor that escapes
    // the root.
    let parent = parentPath(absolutePath);
    while (parent && isWithinRoot(parent, normalizedRoot)) {
      mergeDecoration(out, parent, statusKind, file.staged, file.unstaged, true);
      if (parent === normalizedRoot) break;
      const next = parentPath(parent);
      if (next === parent) break;
      parent = next;
    }
  }

  return out;
}

function statusKindForFile(file: GitChangedFile): SourceControlStatusKind {
  const worktree = file.worktreeStatus.trim();
  if (worktree === "?") return "untracked";
  const primary = worktree && worktree !== " " ? worktree : file.indexStatus;
  return statusKindFromCode(primary, file.untracked);
}

function mergeDecoration(
  out: GitDecorationMap,
  path: string,
  statusKind: SourceControlStatusKind,
  staged: boolean,
  unstaged: boolean,
  hasDescendantChanges: boolean,
) {
  const existing = out.get(path);
  if (!existing) {
    out.set(path, {
      statusKind,
      staged,
      unstaged,
      hasDescendantChanges,
      count: 1,
    });
    return;
  }
  existing.statusKind = STATUS_RANK[existing.statusKind] <= STATUS_RANK[statusKind]
    ? existing.statusKind
    : statusKind;
  existing.staged = existing.staged || staged;
  existing.unstaged = existing.unstaged || unstaged;
  existing.hasDescendantChanges = existing.hasDescendantChanges || hasDescendantChanges;
  existing.count = existing.count + 1;
}

function joinPath(parent: string, path: string): string {
  const rel = normalizePath(path).replace(/^\/+/, "");
  if (!rel) return parent;
  return parent === "/" ? `/${rel}` : `${parent}/${rel}`;
}

function parentPath(path: string): string {
  const i = path.lastIndexOf("/");
  if (i <= 0) return "";
  return path.slice(0, i);
}

function normalizePath(path: string): string {
  const normalized = path.replace(/\\/g, "/");
  if (normalized === "/") return normalized;
  return normalized.replace(/\/+$/, "");
}

function isWithinRoot(path: string, root: string): boolean {
  if (path === root) return true;
  // `path` is already normalized (we only ever feed normalized
  // segments into this function), so a single `startsWith` is enough.
  return root === "/" ? path.startsWith("/") : path.startsWith(`${root}/`);
}
