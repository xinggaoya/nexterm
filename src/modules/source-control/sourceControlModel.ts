import type { GitChangedFile, GitDiscardEntry } from "@/lib/native";
import {
  gitToneForChangedFile,
  gitToneForStatusCode,
  normalizeGitStatusCode,
  type GitChangeTone,
} from "@/lib/gitStatus";

export type DiffMode = "+" | "-";
export type CheckState = "checked" | "indeterminate" | "unchecked";
export type SourceControlGroup = GitChangeTone;

export type SourceControlFileEntry = {
  key: string;
  path: string;
  originalPath: string | null;
  statusCode: string;
  statusLabel: string;
  group: SourceControlGroup;
  checkState: CheckState;
  staged: boolean;
  unstaged: boolean;
  untracked: boolean;
};

function statusCodeForMode(mode: DiffMode, file: GitChangedFile): string {
  if (mode === "-" && file.untracked) return "U";
  const primary = mode === "+" ? file.indexStatus : file.worktreeStatus;
  const fallback = mode === "+" ? file.worktreeStatus : file.indexStatus;
  return normalizeGitStatusCode(primary !== " " ? primary : fallback);
}

function checkStateForFile(file: GitChangedFile): CheckState {
  if (file.staged && file.unstaged) return "indeterminate";
  if (file.staged) return "checked";
  return "unchecked";
}

export function buildSourceControlEntries(
  files: GitChangedFile[],
): SourceControlFileEntry[] {
  const seen = new Set<string>();
  const entries: SourceControlFileEntry[] = [];

  for (const file of files) {
    if (seen.has(file.path)) continue;
    seen.add(file.path);
    const mode = file.unstaged ? "-" : "+";
    const statusCode = statusCodeForMode(mode, file);
    const statusTone = gitToneForStatusCode(statusCode);
    entries.push({
      key: file.path,
      path: file.path,
      originalPath: file.originalPath,
      statusCode,
      statusLabel: file.statusLabel,
      group: statusTone === "other" ? gitToneForChangedFile(file) : statusTone,
      checkState: checkStateForFile(file),
      staged: file.staged,
      unstaged: file.unstaged,
      untracked: file.untracked,
    });
  }

  return entries;
}

export const SOURCE_CONTROL_GROUP_ORDER: SourceControlGroup[] = [
  "modified",
  "added",
  "deleted",
  "renamed",
  "other",
];

export type SourceControlEntryGroup = {
  key: SourceControlGroup;
  entries: SourceControlFileEntry[];
};

export function groupSourceControlEntries(
  entries: SourceControlFileEntry[],
): SourceControlEntryGroup[] {
  return SOURCE_CONTROL_GROUP_ORDER.map((key) => ({
    key,
    entries: entries.filter((entry) => entry.group === key),
  })).filter((group) => group.entries.length > 0);
}

export function getPrimaryDiffMode(entry: SourceControlFileEntry): DiffMode {
  return entry.staged ? "+" : "-";
}

export function pathsToStage(entries: SourceControlFileEntry[]): string[] {
  return entries.filter((entry) => entry.unstaged).map((entry) => entry.path);
}

export function pathsToUnstage(entries: SourceControlFileEntry[]): string[] {
  return entries.filter((entry) => entry.staged).map((entry) => entry.path);
}

export function discardEntriesForEntries(
  entries: SourceControlFileEntry[],
): GitDiscardEntry[] {
  return entries
    .filter((entry) => entry.unstaged)
    .map((entry) => ({ path: entry.path, untracked: entry.untracked }));
}
