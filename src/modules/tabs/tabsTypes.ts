import type { PaneNode } from "@/modules/terminal/lib/layout";

export const MAX_PANES_PER_TAB = 4;

/**
 * Fields shared by every tab variant. `workspaceId` binds a tab to the
 * workspace that owns it — tabs never cross workspace boundaries, which is
 * what lets each workspace's tab set stay alive independently in the
 * background.
 */
export type TabBase = {
  id: number;
  title: string;
  workspaceId: string;
};

export type TerminalTab = TabBase & {
  kind: "terminal";
  terminalTitle?: string;
  cwd?: string;
  paneTree: PaneNode;
  activeLeafId: number;
};

export type EditorTab = TabBase & {
  kind: "editor";
  path: string;
  dirty: boolean;
  preview: boolean;
};

export type PreviewTab = TabBase & {
  kind: "preview";
  url: string;
};

export type MarkdownTab = TabBase & {
  kind: "markdown";
  path: string;
};

export type FilePreviewTab = TabBase & {
  kind: "file-preview";
  path: string;
};

export type GitDiffTab = TabBase & {
  kind: "git-diff";
  path: string;
  repoRoot: string;
  mode: "-" | "+";
  originalPath: string | null;
};

export type GitHistoryTab = TabBase & {
  kind: "git-history";
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

export type GitCommitFileDiffTab = TabBase & {
  kind: "git-commit-file";
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
  | FilePreviewTab
  | GitDiffTab
  | GitHistoryTab
  | GitCommitFileDiffTab;
