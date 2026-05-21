import type { GitChangedFile } from "@/lib/native";

export type DiffMode = "+" | "-";
export type CheckState = "checked" | "indeterminate" | "unchecked";

export type SourceControlFileEntry = {
  key: string;
  path: string;
  originalPath: string | null;
  statusCode: string;
  statusLabel: string;
  checkState: CheckState;
  staged: boolean;
  unstaged: boolean;
  untracked: boolean;
};

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
    entries.push({
      key: file.path,
      path: file.path,
      originalPath: file.originalPath,
      statusCode: statusCodeForMode(mode, file),
      statusLabel: file.statusLabel,
      checkState: checkStateForFile(file),
      staged: file.staged,
      unstaged: file.unstaged,
      untracked: file.untracked,
    });
  }

  return entries;
}

export function getPrimaryDiffMode(entry: SourceControlFileEntry): DiffMode {
  return entry.staged ? "+" : "-";
}
