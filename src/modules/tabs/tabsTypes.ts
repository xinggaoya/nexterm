import type { PaneNode } from "@/modules/terminal/lib/panes";

export const MAX_PANES_PER_TAB = 4;

export type TerminalTab = {
  id: number;
  kind: "terminal";
  title: string;
  cwd?: string;
  paneTree: PaneNode;
  activeLeafId: number;
  private?: boolean;
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

export type AiDiffStatus = "pending" | "approved" | "rejected";

export type AiDiffTab = {
  id: number;
  kind: "ai-diff";
  title: string;
  path: string;
  originalContent: string;
  proposedContent: string;
  approvalId: string;
  status: AiDiffStatus;
  isNewFile: boolean;
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
  | AiDiffTab
  | GitDiffTab
  | GitHistoryTab
  | GitCommitFileDiffTab;
