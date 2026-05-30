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

const STATUS_PRIORITY: SourceControlStatusKind[] = [
  "conflict",
  "deleted",
  "modified",
  "added",
  "untracked",
  "renamed",
];

export type GitDecorationMap = Map<string, GitPathDecoration>;

export function buildGitDecorationMap(
  repoRoot: string | null,
  files: GitChangedFile[],
): GitDecorationMap {
  const out: GitDecorationMap = new Map();
  if (!repoRoot) return out;

  for (const file of files) {
    const absolutePath = joinPath(repoRoot, file.path);
    const statusKind = statusKindForFile(file);
    mergeDecoration(out, absolutePath, {
      statusKind,
      staged: file.staged,
      unstaged: file.unstaged,
      hasDescendantChanges: false,
      count: 1,
    });

    let parent = dirname(absolutePath);
    while (isWithinRoot(parent, repoRoot) && parent !== absolutePath) {
      mergeDecoration(out, parent, {
        statusKind,
        staged: file.staged,
        unstaged: file.unstaged,
        hasDescendantChanges: true,
        count: 1,
      });
      if (normalizePath(parent) === normalizePath(repoRoot)) break;
      const next = dirname(parent);
      if (next === parent) break;
      parent = next;
    }
  }

  return out;
}

function statusKindForFile(file: GitChangedFile): SourceControlStatusKind {
  if (file.worktreeStatus.trim().toUpperCase() === "?") return "untracked";
  const primary =
    file.worktreeStatus.trim() && file.worktreeStatus !== " "
      ? file.worktreeStatus
      : file.indexStatus;
  return statusKindFromCode(primary, file.untracked);
}

function mergeDecoration(
  out: GitDecorationMap,
  path: string,
  next: GitPathDecoration,
) {
  const existing = out.get(path);
  if (!existing) {
    out.set(path, next);
    return;
  }
  out.set(path, {
    statusKind: higherPriorityStatus(existing.statusKind, next.statusKind),
    staged: existing.staged || next.staged,
    unstaged: existing.unstaged || next.unstaged,
    hasDescendantChanges:
      existing.hasDescendantChanges || next.hasDescendantChanges,
    count: existing.count + next.count,
  });
}

function higherPriorityStatus(
  a: SourceControlStatusKind,
  b: SourceControlStatusKind,
): SourceControlStatusKind {
  return STATUS_PRIORITY.indexOf(a) <= STATUS_PRIORITY.indexOf(b) ? a : b;
}

function joinPath(parent: string, path: string): string {
  const root = normalizePath(parent);
  const rel = normalizePath(path).replace(/^\/+/, "");
  if (!rel) return root;
  return root === "/" ? `/${rel}` : `${root}/${rel}`;
}

function dirname(path: string): string {
  const normalized = normalizePath(path);
  const i = normalized.lastIndexOf("/");
  if (i <= 0) return "/";
  return normalized.slice(0, i);
}

function normalizePath(path: string): string {
  const normalized = path.replace(/\\/g, "/");
  if (normalized === "/") return normalized;
  return normalized.replace(/\/+$/, "");
}

function isWithinRoot(path: string, root: string): boolean {
  const normalizedPath = normalizePath(path);
  const normalizedRoot = normalizePath(root);
  return (
    normalizedPath === normalizedRoot ||
    normalizedPath.startsWith(`${normalizedRoot}/`)
  );
}
