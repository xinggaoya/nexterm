import type { GitChangedFile, GitDiscardEntry } from "@/lib/native";

export type DiffMode = "+" | "-";
export type CheckState = "checked" | "indeterminate" | "unchecked";
export type SourceControlGroupId = "staged" | "changes";
export type SourceControlStatusKind =
  | "modified"
  | "added"
  | "deleted"
  | "renamed"
  | "conflict"
  | "untracked";

export type SourceControlFileEntry = {
  key: string;
  group: SourceControlGroupId;
  path: string;
  originalPath: string | null;
  statusCode: string;
  statusLabel: string;
  statusKind: SourceControlStatusKind;
  diffMode: DiffMode;
  checkState: CheckState;
  staged: boolean;
  unstaged: boolean;
  untracked: boolean;
};

export type SourceControlEntrySection = {
  statusKind: SourceControlStatusKind;
  entries: SourceControlFileEntry[];
};

export type SourceControlEntryGroup = {
  id: SourceControlGroupId;
  entries: SourceControlFileEntry[];
  sections: SourceControlEntrySection[];
};

const STATUS_KIND_ORDER: SourceControlStatusKind[] = [
  "conflict",
  "modified",
  "added",
  "untracked",
  "deleted",
  "renamed",
];

function normalizeStatusCode(status: string): string {
  const code = status.trim().toUpperCase();
  switch (code) {
    case "?":
      return "U";
    case "A":
    case "M":
    case "D":
    case "U":
      return code;
    case "R":
    case "C":
      return "R";
    default:
      return code || "M";
  }
}

function statusCodeForMode(mode: DiffMode, file: GitChangedFile): string {
  if (mode === "-" && file.untracked) return "U";
  const primary = mode === "+" ? file.indexStatus : file.worktreeStatus;
  const fallback = mode === "+" ? file.worktreeStatus : file.indexStatus;
  return normalizeStatusCode(primary !== " " ? primary : fallback);
}

export function statusKindFromCode(
  code: string,
  untracked = false,
): SourceControlStatusKind {
  if (untracked) return "untracked";
  switch (normalizeStatusCode(code)) {
    case "A":
      return "added";
    case "D":
      return "deleted";
    case "R":
    case "C":
      return "renamed";
    case "U":
      return "conflict";
    default:
      return "modified";
  }
}

function checkStateForFile(file: GitChangedFile): CheckState {
  if (file.staged && file.unstaged) return "indeterminate";
  if (file.staged) return "checked";
  return "unchecked";
}

function entryForMode(file: GitChangedFile, group: SourceControlGroupId) {
  const diffMode: DiffMode = group === "staged" ? "+" : "-";
  const statusCode = statusCodeForMode(diffMode, file);
  return {
    key: `${group}:${file.path}`,
    group,
    path: file.path,
    originalPath: file.originalPath,
    statusCode,
    statusLabel: file.statusLabel,
    statusKind: statusKindFromCode(statusCode, group === "changes" && file.untracked),
    diffMode,
    checkState:
      group === "staged"
        ? ("checked" as const)
        : checkStateForFile(file) === "indeterminate"
          ? ("unchecked" as const)
          : checkStateForFile(file),
    staged: group === "staged" || file.staged,
    unstaged: group === "changes" || file.unstaged,
    untracked: file.untracked,
  };
}

export function buildSourceControlEntries(
  files: GitChangedFile[],
): SourceControlFileEntry[] {
  const entries: SourceControlFileEntry[] = [];

  for (const file of files) {
    if (file.staged) entries.push(entryForMode(file, "staged"));
    if (file.unstaged || file.untracked) entries.push(entryForMode(file, "changes"));
  }

  return entries;
}

export function getPrimaryDiffMode(entry: SourceControlFileEntry): DiffMode {
  return entry.diffMode;
}

export function pathsToStage(entries: SourceControlFileEntry[]): string[] {
  return uniquePaths(
    entries
      .filter((entry) => entry.group === "changes" && entry.unstaged)
      .map((entry) => entry.path),
  );
}

export function pathsToUnstage(entries: SourceControlFileEntry[]): string[] {
  return uniquePaths(
    entries
      .filter((entry) => entry.group === "staged" && entry.staged)
      .map((entry) => entry.path),
  );
}

export function discardEntriesForEntries(
  entries: SourceControlFileEntry[],
): GitDiscardEntry[] {
  return uniqueDiscardEntries(
    entries
      .filter((entry) => entry.group === "changes" && entry.unstaged)
      .map((entry) => ({ path: entry.path, untracked: entry.untracked })),
  );
}

export function groupSourceControlEntries(
  entries: SourceControlFileEntry[],
): SourceControlEntryGroup[] {
  return (["staged", "changes"] as const)
    .map((group) => {
      const groupEntries = entries
        .filter((entry) => entry.group === group)
        .sort(compareEntries);
      const sections = STATUS_KIND_ORDER.map((statusKind) => ({
        statusKind,
        entries: groupEntries.filter((entry) => entry.statusKind === statusKind),
      })).filter((section) => section.entries.length > 0);
      return { id: group, entries: groupEntries, sections };
    })
    .filter((group) => group.entries.length > 0);
}

function compareEntries(a: SourceControlFileEntry, b: SourceControlFileEntry): number {
  const statusDelta =
    STATUS_KIND_ORDER.indexOf(a.statusKind) - STATUS_KIND_ORDER.indexOf(b.statusKind);
  if (statusDelta !== 0) return statusDelta;
  return a.path.localeCompare(b.path, undefined, { sensitivity: "base" });
}

function uniquePaths(paths: string[]): string[] {
  return Array.from(new Set(paths));
}

function uniqueDiscardEntries(entries: GitDiscardEntry[]): GitDiscardEntry[] {
  const seen = new Set<string>();
  const out: GitDiscardEntry[] = [];
  for (const entry of entries) {
    if (seen.has(entry.path)) continue;
    seen.add(entry.path);
    out.push(entry);
  }
  return out;
}
