import type { SourceControlFileEntry } from "./sourceControlModel";
import type { SourceControlStatusKind } from "./sourceControlModel";

export type SourceControlTone = "default" | "success" | "warning" | "error" | "info";
export type SourceControlTranslate = (
  key: string,
  params?: Record<string, unknown>,
) => string;

export function normalizeError(
  error: unknown,
  t: SourceControlTranslate,
): string {
  if (typeof error === "string") return error;
  if (error && typeof error === "object" && "message" in error) {
    const message = (error as { message?: unknown }).message;
    if (typeof message === "string") return message;
  }
  return t("sourceControl.unknownError");
}

export function normalizePath(path: string): string {
  return path.replace(/\\/g, "/").replace(/\/+$/, "");
}

export function isSameRoot(a: string | null, b: string | null): boolean {
  return !!a && !!b && normalizePath(a) === normalizePath(b);
}

export function statusTone(code: string): SourceControlTone {
  switch (code) {
    case "A":
      return "success";
    case "M":
      return "warning";
    case "D":
      return "error";
    case "R":
      return "info";
    default:
      return "default";
  }
}

export function statusClass(statusKind: SourceControlStatusKind): string {
  switch (statusKind) {
    case "added":
    case "untracked":
      return "text-emerald-600 dark:text-emerald-300";
    case "deleted":
    case "conflict":
      return "text-red-600 dark:text-red-300";
    case "renamed":
      return "text-sky-600 dark:text-sky-300";
    default:
      return "text-amber-600 dark:text-amber-300";
  }
}

export function statusDotClass(statusKind: SourceControlStatusKind): string {
  switch (statusKind) {
    case "added":
    case "untracked":
      return "bg-emerald-500";
    case "deleted":
    case "conflict":
      return "bg-red-500";
    case "renamed":
      return "bg-sky-500";
    default:
      return "bg-amber-500";
  }
}

export function statusKindLabel(
  statusKind: SourceControlStatusKind,
  t: SourceControlTranslate,
): string {
  switch (statusKind) {
    case "added":
      return t("sourceControl.statusAdded");
    case "deleted":
      return t("sourceControl.statusDeleted");
    case "renamed":
      return t("sourceControl.statusRenamed");
    case "conflict":
      return t("sourceControl.statusConflict");
    case "untracked":
      return t("sourceControl.statusUntracked");
    default:
      return t("sourceControl.statusModified");
  }
}

export function stageLabel(
  entry: SourceControlFileEntry,
  t: SourceControlTranslate,
): string {
  if (entry.checkState === "checked") return t("sourceControl.staged");
  if (entry.checkState === "indeterminate") return t("sourceControl.mixed");
  return t("sourceControl.unstaged");
}

export function pushedLabel(remote: string | null, branch: string | null): string {
  if (remote && branch) return `${remote}/${branch}`;
  if (branch) return branch;
  return remote ?? "upstream";
}
