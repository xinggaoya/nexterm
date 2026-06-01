import { invoke } from "@tauri-apps/api/core";
import { listen, type UnlistenFn } from "@tauri-apps/api/event";
import { exit as pluginExit, relaunch as pluginRelaunch } from "@tauri-apps/plugin-process";
import { currentWorkspaceEnv } from "@/modules/workspace/workspaceEnvSnapshot";

export type GitRepoInfo = {
  repoRoot: string;
  branch: string;
  upstream: string | null;
  isDetached: boolean;
};

export type GitChangedFile = {
  path: string;
  originalPath: string | null;
  indexStatus: string;
  worktreeStatus: string;
  staged: boolean;
  unstaged: boolean;
  untracked: boolean;
  statusLabel: string;
};

export type GitStatusSnapshot = {
  repoRoot: string;
  branch: string;
  upstream: string | null;
  ahead: number;
  behind: number;
  isDetached: boolean;
  truncated: boolean;
  changedFiles: GitChangedFile[];
};

export type GitDiffResult = {
  diffText: string;
  truncated: boolean;
};

export type GitDiffContentResult = {
  originalContent: string;
  modifiedContent: string;
  isBinary: boolean;
  fallbackPatch: string;
  truncated: boolean;
};

export type GitCommitResult = {
  commitSha: string;
  summary: string;
};

export type GitPushResult = {
  remote: string | null;
  branch: string | null;
  pushed: boolean;
};

export type GitFetchResult = {
  updatedRefs: number;
  prunedRefs: number;
  summary: string;
};

export type GitPullResult = {
  filesChanged: number;
  insertions: number;
  deletions: number;
  alreadyUpToDate: boolean;
  summary: string;
};

export type GitBranchInfo = {
  name: string;
  upstream: string | null;
  isCurrent: boolean;
  isRemote: boolean;
};

export type GitBranchResult = {
  branch: string;
};

export type GitStashEntry = {
  selector: string;
  shortSha: string;
  relativeTime: string;
  message: string;
};

export type GitStashPushOptions = {
  message: string | null;
  includeUntracked: boolean;
};

export type GitStashResult = {
  stashed: boolean;
  message: string;
};

export type GitLogEntry = {
  sha: string;
  shortSha: string;
  author: string;
  authorEmail: string;
  timestampSecs: number;
  parents: string[];
  subject: string;
  filesChanged: number;
  insertions: number;
  deletions: number;
};

export type GitCommitFileChange = {
  path: string;
  originalPath: string | null;
  status: string;
  statusLabel: string;
  added: number;
  removed: number;
  isBinary: boolean;
};

export type GitPanelSnapshot = {
  repo: GitRepoInfo | null;
  status: GitStatusSnapshot | null;
};

export type ShellBgLogResponse = {
  bytes: string;
  nextOffset: number;
  dropped: number;
  exited: boolean;
  exitCode: number | null;
};

export type ShellBgProcInfo = {
  handle: number;
  command: string;
  cwd: string | null;
  startedAtMs: number;
  exited: boolean;
  exitCode: number | null;
};

export type WorkspaceFsChangedEvent = {
  rootPath: string;
  paths: string[];
  gitRelated: boolean;
};

export type GitDiscardEntry = {
  path: string;
  untracked: boolean;
};

export const WORKSPACE_FS_CHANGED_EVENT = "nexterm://workspace-fs-changed";

/**
 * Event name emitted by the Tauri backend (`src-tauri/src/lib.rs`) when a
 * `nexterm://open?workspacePath=...&workspaceEnv=...&wslDistro=...` URL is
 * delivered via the OS deep-link protocol handler. Listeners receive a
 * `DeepLinkOpenRequest` payload that maps to `LaunchWorkspace` for the rest
 * of the workspace lifecycle.
 */
export const DEEP_LINK_OPEN_EVENT = "nexterm://deep-link-open";

export type DeepLinkOpenRequest = {
  path: string;
  env: string;
  wslDistro?: string;
};

export type DeepLinkOpenHandler = (request: DeepLinkOpenRequest) => void;

export function onDeepLinkOpen(handler: DeepLinkOpenHandler): Promise<UnlistenFn> {
  return listen<DeepLinkOpenRequest>(DEEP_LINK_OPEN_EVENT, (event) => {
    handler(event.payload);
  });
}

/**
 * Relaunch the current process. Thin wrapper around
 * `@tauri-apps/plugin-process` so callers don't depend on the plugin package
 * directly; kept async to match the underlying API.
 */
export function relaunchApp(): Promise<void> {
  return pluginRelaunch();
}

/**
 * Exit the current process with an explicit exit code. Defaults to `0` per
 * the upstream `process` plugin contract.
 */
export function exitApp(code = 0): Promise<void> {
  return pluginExit(code);
}

export const native = {
  workspaceAuthorize: (path: string) =>
    invoke<string>("workspace_authorize", {
      path,
      workspace: currentWorkspaceEnv(),
    }),
  gitResolveRepo: (cwd: string) =>
    invoke<GitRepoInfo | null>("git_resolve_repo", {
      cwd,
      workspace: currentWorkspaceEnv(),
    }),
  gitPanelSnapshot: (cwd: string) =>
    invoke<GitPanelSnapshot>("git_panel_snapshot", {
      cwd,
      workspace: currentWorkspaceEnv(),
    }),
  gitStatus: (repoRoot: string) =>
    invoke<GitStatusSnapshot>("git_status", {
      repoRoot,
      workspace: currentWorkspaceEnv(),
    }),
  gitDiff: (repoRoot: string, path: string | null, staged: boolean) =>
    invoke<GitDiffResult>("git_diff", {
      repoRoot,
      path,
      staged,
      workspace: currentWorkspaceEnv(),
    }),
  gitDiffContent: (
    repoRoot: string,
    path: string,
    staged: boolean,
    originalPath?: string | null,
  ) =>
    invoke<GitDiffContentResult>("git_diff_content", {
      repoRoot,
      path,
      staged,
      originalPath: originalPath ?? null,
      workspace: currentWorkspaceEnv(),
    }),
  gitStage: (repoRoot: string, paths: string[]) =>
    invoke<void>("git_stage", {
      repoRoot,
      paths,
      workspace: currentWorkspaceEnv(),
    }),
  gitUnstage: (repoRoot: string, paths: string[]) =>
    invoke<void>("git_unstage", {
      repoRoot,
      paths,
      workspace: currentWorkspaceEnv(),
    }),
  gitDiscard: (repoRoot: string, entries: GitDiscardEntry[]) =>
    invoke<void>("git_discard", {
      repoRoot,
      entries,
      workspace: currentWorkspaceEnv(),
    }),
  gitCommit: (repoRoot: string, message: string) =>
    invoke<GitCommitResult>("git_commit", {
      repoRoot,
      message,
      workspace: currentWorkspaceEnv(),
    }),
  gitFetch: (repoRoot: string) =>
    invoke<GitFetchResult>("git_fetch", {
      repoRoot,
      workspace: currentWorkspaceEnv(),
    }),
  gitPullFfOnly: (repoRoot: string) =>
    invoke<GitPullResult>("git_pull_ff_only", {
      repoRoot,
      workspace: currentWorkspaceEnv(),
    }),
  gitPush: (repoRoot: string) =>
    invoke<GitPushResult>("git_push", {
      repoRoot,
      workspace: currentWorkspaceEnv(),
    }),
  gitBranchList: (repoRoot: string) =>
    invoke<GitBranchInfo[]>("git_branch_list", {
      repoRoot,
      workspace: currentWorkspaceEnv(),
    }),
  gitCheckoutBranch: (repoRoot: string, branch: string, remote: boolean) =>
    invoke<GitBranchResult>("git_checkout_branch", {
      repoRoot,
      branch,
      remote,
      workspace: currentWorkspaceEnv(),
    }),
  gitCreateBranch: (repoRoot: string, branch: string) =>
    invoke<GitBranchResult>("git_create_branch", {
      repoRoot,
      branch,
      workspace: currentWorkspaceEnv(),
    }),
  gitStashList: (repoRoot: string) =>
    invoke<GitStashEntry[]>("git_stash_list", {
      repoRoot,
      workspace: currentWorkspaceEnv(),
    }),
  gitStashPush: (repoRoot: string, options: GitStashPushOptions) =>
    invoke<GitStashResult>("git_stash_push", {
      repoRoot,
      options,
      workspace: currentWorkspaceEnv(),
    }),
  gitStashPop: (repoRoot: string, selector: string) =>
    invoke<GitStashResult>("git_stash_pop", {
      repoRoot,
      selector,
      workspace: currentWorkspaceEnv(),
    }),
  gitStashDrop: (repoRoot: string, selector: string) =>
    invoke<GitStashResult>("git_stash_drop", {
      repoRoot,
      selector,
      workspace: currentWorkspaceEnv(),
    }),
  gitLog: (repoRoot: string, options?: { limit?: number; beforeSha?: string }) =>
    invoke<GitLogEntry[]>("git_log", {
      repoRoot,
      limit: options?.limit ?? null,
      beforeSha: options?.beforeSha ?? null,
      workspace: currentWorkspaceEnv(),
    }),
  gitShowCommit: (repoRoot: string, sha: string) =>
    invoke<GitDiffResult>("git_show_commit", {
      repoRoot,
      sha,
      workspace: currentWorkspaceEnv(),
    }),
  gitCommitFiles: (repoRoot: string, sha: string) =>
    invoke<GitCommitFileChange[]>("git_commit_files", {
      repoRoot,
      sha,
      workspace: currentWorkspaceEnv(),
    }),
  gitCommitFileDiff: (
    repoRoot: string,
    sha: string,
    path: string,
    originalPath?: string | null,
  ) =>
    invoke<GitDiffContentResult>("git_commit_file_diff", {
      repoRoot,
      sha,
      path,
      originalPath: originalPath ?? null,
      workspace: currentWorkspaceEnv(),
    }),
  gitRemoteUrl: (repoRoot: string, name?: string) =>
    invoke<string | null>("git_remote_url", {
      repoRoot,
      name: name ?? null,
      workspace: currentWorkspaceEnv(),
    }),
  shellBgSpawn: (command: string, cwd?: string | null) =>
    invoke<number>("shell_bg_spawn", {
      command,
      cwd: cwd ?? null,
      workspace: currentWorkspaceEnv(),
    }),
  shellBgLogs: (handle: number, sinceOffset: number) =>
    invoke<ShellBgLogResponse>("shell_bg_logs", {
      handle,
      sinceOffset,
    }),
  shellBgKill: (handle: number) =>
    invoke<void>("shell_bg_kill", {
      handle,
    }),
  shellBgList: () => invoke<ShellBgProcInfo[]>("shell_bg_list"),
  fsWatchWorkspace: (rootPath: string) =>
    invoke<void>("fs_watch_workspace", {
      rootPath,
      workspace: currentWorkspaceEnv(),
    }),
  fsUnwatchWorkspace: () => invoke<void>("fs_unwatch_workspace"),
};
