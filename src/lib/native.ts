import { Channel, invoke } from "@tauri-apps/api/core";
import { listen, type UnlistenFn } from "@tauri-apps/api/event";
import { exit as pluginExit, relaunch as pluginRelaunch } from "@tauri-apps/plugin-process";
import {
  type WorkspaceEnv,
} from "@/modules/workspace/workspaceEnvSnapshot";
import type { WslDistro } from "@/modules/workspace/workspaceEnvSnapshot";
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
  fullRef?: string;
  upstream: string | null;
  isCurrent: boolean;
  isRemote: boolean;
  lastCommitShortSha?: string;
  lastCommitSubject?: string;
  lastCommitTimestampSecs?: number;
  ahead?: number | null;
  behind?: number | null;
};

export type GitBranchResult = {
  branch: string;
};

export type GitStashEntry = {
  selector: string;
  fullSha?: string;
  shortSha: string;
  relativeTime: string;
  message: string;
};

export type GitStashPushOptions = {
  message: string | null;
  includeUntracked: boolean;
  keepIndex?: boolean;
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
  refs?: GitLogRef[];
};

export type GitLogRef = {
  name: string;
  kind: string;
  isHead: boolean;
};

export type GitLogPage = {
  entries: GitLogEntry[];
  hasMore: boolean;
};

export type GitLogOptions = {
  limit?: number | null;
  offset?: number | null;
  refName?: string | null;
  all?: boolean;
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

export type GitWorkspaceRepo = {
  repoRoot: string;
  relativePath: string;
  name: string;
  branch: string;
  upstream: string | null;
  isDetached: boolean;
  isWorktree: boolean;
};

export type GitRepositoryDiscovery = {
  repositories: GitWorkspaceRepo[];
  truncated: boolean;
};

export type GitRemoteInfo = {
  name: string;
  fetchUrl: string;
  pushUrl: string;
};

export type GitRemoteInput = {
  name: string;
  url: string;
};

export type GitRemoteUrlUpdate = {
  name: string;
  newUrl: string;
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
  /**
   * Parallel to `paths` — entries are `"create" | "modify" | "delete"`.
   * The webview's file explorer reads this to decide whether a silent
   * refresh should rebuild (a create/delete membership change) or just
   * patch (a content-only modify). Absent on root-refresh batches
   * (`paths` empty) and on legacy emitters — callers should treat a
   * missing `kinds` as `"modify"`.
   */
  kinds?: Array<"create" | "modify" | "delete">;
};

// LSP server configuration and session metadata exposed to the webview.
export type LspServerSpec = {
  id: string;
  language: string;
  command: string;
  args?: string[];
  cwd?: string | null;
};

export type LspResolvedCommand = {
  command: string;
  args: string[];
};

export type LspSessionInfo = {
  id: number;
  language: string;
  spec_id: string;
};

export type WorkspaceFileChangedEvent = {
  rootPath: string;
  path: string;
  kind: "create" | "modify" | "delete";
};

export type GitDiscardEntry = {
  path: string;
  untracked: boolean;
};

export type FsReadResult =
  | { kind: "text"; content: string; size: number }
  | { kind: "binary"; size: number }
  | { kind: "toolarge"; size: number; limit: number };

export type FsDirEntry = {
  name: string;
  kind: "file" | "dir" | "symlink";
  size: number;
  mtime: number;
};

export type FsSearchHit = {
  path: string;
  rel: string;
  name: string;
  is_dir: boolean;
};

export type FsSearchResult = {
  hits: FsSearchHit[];
  truncated: boolean;
};

export type FsGrepHit = {
  path: string;
  rel: string;
  line: number;
  text: string;
};

export type FsGrepResult = {
  hits: FsGrepHit[];
  truncated: boolean;
  filesScanned: number;
};

export type FsGlobHit = {
  path: string;
  rel: string;
};

export type PtyHandlers = {
  onData: (chunk: string) => void;
  onExit?: (code: number) => void;
};

export type PtySession = {
  id: number;
  write: (data: string) => Promise<void>;
  resize: (cols: number, rows: number) => Promise<void>;
  close: () => Promise<void>;
};

export const FS_SEARCH_DEFAULT_LIMIT = 200;
export const WORKSPACE_FS_CHANGED_EVENT = "nexterm://workspace-fs-changed";
/**
 * Per-path file-change event. Emitted by the watcher *before* the
 * aggregated `WORKSPACE_FS_CHANGED_EVENT` so subscribers that only care
 * about tree refresh (e.g. the file explorer) can react without waiting
 * for the 200ms batch window. The frontend may subscribe to either or
 * both; `useWorkspaceLifecycle` only forwards the aggregated event.
 */
export const WORKSPACE_FILE_CHANGED_EVENT = "nexterm://workspace-file-changed";

/**
 * Event name emitted by the Tauri backend (`src-tauri/src/lib.rs`) when a
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

export function onDeepLinkOpen(
  handler: (request: DeepLinkOpenRequest) => void,
): Promise<UnlistenFn> {
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

/**
 * The workspace-scoped native invoke surface.
 *
 * Every method that touches the filesystem, a PTY, git, or shell now takes an
 * explicit `workspace: WorkspaceEnv` argument — there is no longer a
 * process-wide "current" env singleton. This makes it impossible for one
 * workspace's native call to be silently routed to another workspace's
 * backend, which was the core defect blocking multi-workspace concurrency.
 *
 * `createNativeForEnv(env)` returns an object whose methods close over the
 * given env, so workspace-scoped modules can call e.g. `wsNative.gitStatus(r)`
 * without threading env through every call site.
 */
export function createNativeForEnv(workspace: WorkspaceEnv) {
  return {
    workspaceAuthorize: (path: string) =>
      invoke<string>("workspace_authorize", { path, workspace }),
    gitResolveRepo: (cwd: string) =>
      invoke<GitRepoInfo | null>("git_resolve_repo", { cwd, workspace }),
    gitPanelSnapshot: (cwd: string) =>
      invoke<GitPanelSnapshot>("git_panel_snapshot", { cwd, workspace }),
    gitStatus: (repoRoot: string) =>
      invoke<GitStatusSnapshot>("git_status", { repoRoot, workspace }),
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
        workspace,
      }),
    gitStage: (repoRoot: string, paths: string[]) =>
      invoke<void>("git_stage", { repoRoot, paths, workspace }),
    gitUnstage: (repoRoot: string, paths: string[]) =>
      invoke<void>("git_unstage", { repoRoot, paths, workspace }),
    gitDiscard: (repoRoot: string, entries: GitDiscardEntry[]) =>
      invoke<void>("git_discard", { repoRoot, entries, workspace }),
    gitCommit: (repoRoot: string, message: string) =>
      invoke<GitCommitResult>("git_commit", { repoRoot, message, workspace }),
    gitFetch: (repoRoot: string) =>
      invoke<GitFetchResult>("git_fetch", { repoRoot, workspace }),
    gitPullFfOnly: (repoRoot: string) =>
      invoke<GitPullResult>("git_pull_ff_only", { repoRoot, workspace }),
    gitPush: (repoRoot: string) =>
      invoke<GitPushResult>("git_push", { repoRoot, workspace }),
    gitBranchList: (repoRoot: string) =>
      invoke<GitBranchInfo[]>("git_branch_list", { repoRoot, workspace }),
    gitCheckoutBranch: (repoRoot: string, branch: string, remote: boolean) =>
      invoke<GitBranchResult>("git_checkout_branch", {
        repoRoot,
        branch,
        remote,
        workspace,
      }),
    gitCreateBranch: (repoRoot: string, branch: string) =>
      invoke<GitBranchResult>("git_create_branch", {
        repoRoot,
        branch,
        workspace,
      }),
    gitStashList: (repoRoot: string) =>
      invoke<GitStashEntry[]>("git_stash_list", { repoRoot, workspace }),
    gitStashPush: (repoRoot: string, options: GitStashPushOptions) =>
      invoke<GitStashResult>("git_stash_push", { repoRoot, options, workspace }),
    gitStashPop: (
      repoRoot: string,
      selector: string,
      expectedSha?: string | null,
    ) =>
      invoke<GitStashResult>("git_stash_pop", {
        repoRoot,
        selector,
        expectedSha: expectedSha ?? null,
        workspace,
      }),
    gitStashDrop: (
      repoRoot: string,
      selector: string,
      expectedSha?: string | null,
    ) =>
      invoke<GitStashResult>("git_stash_drop", {
        repoRoot,
        selector,
        expectedSha: expectedSha ?? null,
        workspace,
      }),
    gitStashApply: (
      repoRoot: string,
      selector: string,
      expectedSha?: string | null,
    ) =>
      invoke<GitStashResult>("git_stash_apply", {
        repoRoot,
        selector,
        expectedSha: expectedSha ?? null,
        workspace,
      }),
    gitLog: (repoRoot: string, options?: GitLogOptions) =>
      invoke<GitLogPage>("git_log", {
        repoRoot,
        options: {
          limit: options?.limit ?? null,
          offset: options?.offset ?? null,
          refName: options?.refName ?? null,
          all: options?.all ?? false,
        },
        workspace,
      }),
    gitCommitFiles: (repoRoot: string, sha: string) =>
      invoke<GitCommitFileChange[]>("git_commit_files", {
        repoRoot,
        sha,
        workspace,
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
        workspace,
      }),
    gitRemoteUrl: (repoRoot: string, name?: string) =>
      invoke<string | null>("git_remote_url", {
        repoRoot,
        name: name ?? null,
        workspace,
      }),
    gitRemoteList: (repoRoot: string) =>
      invoke<GitRemoteInfo[]>("git_remote_list", { repoRoot, workspace }),
    gitRemoteAdd: (repoRoot: string, input: GitRemoteInput) =>
      invoke<GitRemoteInfo>("git_remote_add", {
        repoRoot,
        input,
        workspace,
      }),
    gitRemoteRemove: (repoRoot: string, name: string) =>
      invoke<void>("git_remote_remove", { repoRoot, name, workspace }),
    gitRemoteSetUrl: (repoRoot: string, input: GitRemoteUrlUpdate) =>
      invoke<GitRemoteInfo>("git_remote_set_url", {
        repoRoot,
        input,
        workspace,
      }),
    gitDiscoverRepositories: (
      rootPath: string,
      options?: { maxDepth?: number; maxRepos?: number },
    ) =>
      invoke<GitRepositoryDiscovery>("git_discover_repositories", {
        rootPath,
        maxDepth: options?.maxDepth ?? 4,
        maxRepos: options?.maxRepos ?? 32,
        workspace,
      }),
    shellBgSpawn: (command: string, cwd?: string | null) =>
      invoke<number>("shell_bg_spawn", {
        command,
        cwd: cwd ?? null,
        workspace,
      }),
    fsReadFile: (path: string) =>
      invoke<FsReadResult>("fs_read_file", { path, workspace }),
    fsWriteFile: (path: string, content: string) =>
      invoke<void>("fs_write_file", { path, content, workspace }),
    fsReadDir: (path: string, showHidden: boolean) =>
      invoke<FsDirEntry[]>("fs_read_dir", { path, showHidden, workspace }),
    fsCreateDir: (path: string) =>
      invoke<void>("fs_create_dir", { path, workspace }),
    fsCreateFile: (path: string) =>
      invoke<void>("fs_create_file", { path, workspace }),
    fsRename: (from: string, to: string) =>
      invoke<void>("fs_rename", { from, to, workspace }),
    fsDelete: (path: string) =>
      invoke<void>("fs_delete", { path, workspace }),
    fsCopy: (from: string, to: string) =>
      invoke<void>("fs_copy", { from, to, workspace }),
    fsGrep: (
      pattern: string,
      root: string,
      options?: {
        glob?: string[];
        caseInsensitive?: boolean;
        maxResults?: number;
      },
    ) =>
      invoke<FsGrepResult>("fs_grep", {
        pattern,
        root,
        glob: options?.glob ?? null,
        caseInsensitive: options?.caseInsensitive ?? false,
        maxResults: options?.maxResults ?? null,
        workspace,
      }),
    fsGlob: (pattern: string, root: string) =>
      invoke<FsGlobHit[]>("fs_glob", { pattern, root, workspace }),
    fsSearch: (root: string, query: string, showHidden: boolean) =>
      invoke<FsSearchResult>("fs_search", {
        root,
        query,
        limit: FS_SEARCH_DEFAULT_LIMIT,
        showHidden,
        workspace,
      }),
    fsWatchWorkspace: (rootPath: string) =>
      invoke<void>("fs_watch_workspace", { rootPath, workspace }),
    fsUnwatchWorkspace: (rootPath: string) =>
      invoke<void>("fs_unwatch_workspace", { rootPath, workspace }),
    ptyOpen: async (
      cols: number,
      rows: number,
      handlers: PtyHandlers,
      cwd?: string,
    ): Promise<PtySession> => {
      const onData = new Channel<string>();
      const onExit = new Channel<number>();
      let released = false;
      const noop = () => {};
      const releaseHandlers = () => {
        if (released) return;
        released = true;
        onData.onmessage = noop;
        onExit.onmessage = noop;
      };
      onData.onmessage = (chunk) => handlers.onData(chunk);
      onExit.onmessage = (code) => {
        handlers.onExit?.(code);
        releaseHandlers();
      };
      const id = await invoke<number>("pty_open", {
        cols,
        rows,
        cwd: cwd ?? null,
        workspace,
        onData,
        onExit,
      });
      let closed = false;
      return {
        id,
        write: (data: string) => invoke("pty_write", { id, data }),
        resize: (c: number, r: number) =>
          invoke("pty_resize", { id, cols: c, rows: r }),
        close: async () => {
          if (closed) return;
          closed = true;
          try {
            await invoke("pty_close", { id });
          } finally {
            releaseHandlers();
          }
        },
      };
    },
  };
}

export type WorkspaceNative = ReturnType<typeof createNativeForEnv>;

/**
 * Workspace-agnostic native methods that don't route by env — OS-level queries
 * (distros, launch dir), and resource handles that are already identified by
 * an opaque id (pty write/resize/close, shell bg logs/kill, lsp). These stay
 * global because their backend counterparts don't take a workspace either.
 */
export const native = {
  shellBgLogs: (handle: number, sinceOffset: number) =>
    invoke<ShellBgLogResponse>("shell_bg_logs", { handle, sinceOffset }),
  shellBgKill: (handle: number) =>
    invoke<void>("shell_bg_kill", { handle }),
  shellBgList: () => invoke<ShellBgProcInfo[]>("shell_bg_list"),
  getLaunchDir: () => invoke<string | null>("get_launch_dir"),
  getWslHome: (distro: string) => invoke<string>("wsl_home", { distro }),
  wslListDistros: () => invoke<WslDistro[]>("wsl_list_distros"),
  ptyWrite: (id: number, data: string) =>
    invoke<void>("pty_write", { id, data }),
  ptyResize: (id: number, cols: number, rows: number) =>
    invoke<void>("pty_resize", { id, cols, rows }),
  ptyClose: (id: number) => invoke<void>("pty_close", { id }),
  ptyKill: (id: number) => invoke<void>("pty_kill", { id }),

  // LSP transport — Section 2.
  lspStart: (spec: LspServerSpec) => invoke<number>("lsp_start", { spec }),
  lspWrite: (id: number, message: string) =>
    invoke<void>("lsp_write", { id, message }),
  lspStop: (id: number) => invoke<void>("lsp_stop", { id }),
  lspList: () => invoke<LspSessionInfo[]>("lsp_list"),
  lspResolveCommand: (language: string) =>
    invoke<LspResolvedCommand | null>("lsp_resolve_command", { language }),

  // DevTools — lets the settings page toggle the webview inspector without a
  // right-click (which the app disables for custom context menus).
  toggleDevtools: () => invoke<boolean>("toggle_devtools"),
  isDevtoolsOpen: () => invoke<boolean>("is_devtools_open"),
};