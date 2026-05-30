import type { SourceControlFileEntry } from "./sourceControlModel";
import { gitToneForStatusCode, type GitChangeTone } from "@/lib/gitStatus";

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
  switch (gitToneForStatusCode(code)) {
    case "added":
      return "success";
    case "modified":
      return "warning";
    case "deleted":
      return "error";
    case "renamed":
      return "info";
    default:
      return "default";
  }
}

export function sourceControlGroupLabel(
  group: GitChangeTone,
  t: SourceControlTranslate,
): string {
  return t(`sourceControl.groups.${group}`);
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
