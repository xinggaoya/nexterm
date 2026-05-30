import type { GitChangedFile } from "@/lib/native";

export type GitChangeTone = "added" | "modified" | "deleted" | "renamed" | "other";

const GIT_CHANGE_TONE_PRIORITY: Record<GitChangeTone, number> = {
  deleted: 5,
  added: 4,
  modified: 3,
  renamed: 2,
  other: 1,
};

export function normalizeGitStatusCode(status: string): string {
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

export function gitToneForStatusCode(code: string): GitChangeTone {
  switch (normalizeGitStatusCode(code)) {
    case "A":
    case "U":
      return "added";
    case "M":
      return "modified";
    case "D":
      return "deleted";
    case "R":
      return "renamed";
    default:
      return "other";
  }
}

export function gitTonePriority(tone: GitChangeTone): number {
  return GIT_CHANGE_TONE_PRIORITY[tone];
}

export function strongerGitTone(
  current: GitChangeTone | null,
  next: GitChangeTone | null,
): GitChangeTone | null {
  if (!next) return current;
  if (!current) return next;
  return gitTonePriority(next) > gitTonePriority(current) ? next : current;
}

export function gitToneForChangedFile(file: GitChangedFile): GitChangeTone {
  let tone: GitChangeTone | null = null;
  for (const status of [file.indexStatus, file.worktreeStatus]) {
    if (status === " ") continue;
    tone = strongerGitTone(tone, gitToneForStatusCode(status));
  }
  return tone ?? (file.untracked ? "added" : "modified");
}

