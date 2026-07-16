import type { PaneNode } from "@/modules/terminal/lib/layout";

export const MAX_PANES_PER_TAB = 4;

export type TerminalTab = {
  id: number;
  kind: "terminal";
  title: string;
  terminalTitle?: string;
  cwd?: string;
  paneTree: PaneNode;
  activeLeafId: number;
};

export type EditorTab = {
  id: number;
  kind: "editor";
  title: string;
  path: string;
  dirty: boolean;
  preview: boolean;
};

export type PreviewTab = {
  id: number;
  kind: "preview";
  title: string;
  url: string;
};

export type MarkdownTab = {
  id: number;
  kind: "markdown";
  title: string;
  path: string;
};

export type GitDiffTab = {
  id: number;
  kind: "git-diff";
  title: string;
  path: string;
  repoRoot: string;
  mode: "-" | "+";
  originalPath: string | null;
};

export type GitHistoryTab = {
  id: number;
  kind: "git-history";
  title: string;
  repoRoot: string;
  /**
   * Git ref name used to scope the log (a branch, tag, or any rev).
   * `null` means "HEAD of the working tree" — Rust resolves it from
   * `git rev-parse HEAD` when the field is omitted.
   */
  refName: string | null;
  /**
   * When `true`, the history spans every local/remote ref instead of a
   * single branch. Used for the "All branches" pane and other multi-ref
   * views. Persists into the tab identity so two `All branches` views
   * stay coalesced.
   */
  allRefs: boolean;
};

export type GitCommitFileDiffTab = {
  id: number;
  kind: "git-commit-file";
  title: string;
  repoRoot: string;
  sha: string;
  shortSha: string;
  subject: string;
  path: string;
  originalPath: string | null;
};

export type Tab =
  | TerminalTab
  | EditorTab
  | PreviewTab
  | MarkdownTab
  | GitDiffTab
  | GitHistoryTab
  | GitCommitFileDiffTab;
