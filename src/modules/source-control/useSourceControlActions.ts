import { computed, ref, type TextareaHTMLAttributes } from "vue";
import type {
  GitBranchInfo,
  GitBranchResult,
  GitCommitResult,
  GitDiscardEntry,
  GitFetchResult,
  GitPullResult,
  GitPushResult,
  GitStashPushOptions,
  GitStashResult,
} from "@/lib/native";
import { notifyError, notifySuccess } from "@/modules/notifications/notificationCenter";
import type { SourceControlFileEntry } from "./sourceControlModel";
import {
  normalizeError,
  pushedLabel,
  type SourceControlTranslate,
} from "./sourceControlFormat";
import type { BusyAction, SourceControlRuntimeState } from "./useSourceControlState";

type SourceControlActionNative = {
  gitStage: (repoRoot: string, paths: string[]) => Promise<void>;
  gitUnstage: (repoRoot: string, paths: string[]) => Promise<void>;
  gitDiscard: (repoRoot: string, entries: GitDiscardEntry[]) => Promise<void>;
  gitCommit: (repoRoot: string, message: string) => Promise<GitCommitResult>;
  gitFetch: (repoRoot: string) => Promise<GitFetchResult>;
  gitPullFfOnly: (repoRoot: string) => Promise<GitPullResult>;
  gitPush: (repoRoot: string) => Promise<GitPushResult>;
  gitCheckoutBranch: (
    repoRoot: string,
    branch: string,
    remote: boolean,
  ) => Promise<GitBranchResult>;
  gitCreateBranch: (repoRoot: string, branch: string) => Promise<GitBranchResult>;
  gitStashPush: (
    repoRoot: string,
    options: GitStashPushOptions,
  ) => Promise<GitStashResult>;
  gitStashPop: (repoRoot: string, selector: string) => Promise<GitStashResult>;
  gitStashDrop: (repoRoot: string, selector: string) => Promise<GitStashResult>;
};

type DialogApi = {
  warning: (options: {
    title: string;
    content: string;
    positiveText: string;
    negativeText: string;
    onPositiveClick: () => void | Promise<void>;
  }) => unknown;
};

type SourceControlActionOptions = {
  state: SourceControlRuntimeState;
  native: SourceControlActionNative;
  dialog: DialogApi;
  t: SourceControlTranslate;
  emitCommitted: (result: GitCommitResult) => void;
  refreshGitMetadata?: () => Promise<void>;
};

export function useSourceControlActions(options: SourceControlActionOptions) {
  const actionMessage = ref<string | null>(null);
  const actionError = ref<string | null>(null);
  const commitMessage = ref("");
  const commitInputProps = {
    "data-commit-message": "",
  } as unknown as TextareaHTMLAttributes;

  const canCommit = computed(
    () =>
      !!options.state.repoRoot.value &&
      options.state.stagedCount.value > 0 &&
      commitMessage.value.trim().length > 0 &&
      options.state.busyAction.value === null,
  );

  function resetActionFeedback() {
    actionMessage.value = null;
    actionError.value = null;
  }

  async function runWithBusy(busy: BusyAction, run: () => Promise<void>) {
    if (options.state.busyAction.value) return;
    options.state.busyAction.value = busy;
    resetActionFeedback();
    try {
      await run();
    } catch (error) {
      actionError.value = normalizeError(error, options.t);
      notifyError(options.t(errorTitleForBusy(busy)), actionError.value);
    } finally {
      options.state.busyAction.value = null;
    }
  }

  async function refresh() {
    await runWithBusy("refresh", async () => {
      await (options.state.reloadCurrent?.() ?? options.state.refreshStatus());
    });
  }

  async function stageFile(entry: SourceControlFileEntry) {
    const root = options.state.repoRoot.value;
    if (!root) return;
    await runWithBusy(`stage:${entry.path}`, async () => {
      await options.native.gitStage(root, [entry.path]);
      await options.state.refreshStatus();
    });
  }

  async function unstageFile(entry: SourceControlFileEntry) {
    const root = options.state.repoRoot.value;
    if (!root) return;
    await runWithBusy(`unstage:${entry.path}`, async () => {
      await options.native.gitUnstage(root, [entry.path]);
      await options.state.refreshStatus();
    });
  }

  async function stageAll() {
    const root = options.state.repoRoot.value;
    const paths = options.state.stageAllPaths.value;
    if (!root || paths.length === 0) return;
    await runWithBusy("stage-all", async () => {
      await options.native.gitStage(root, paths);
      await options.state.refreshStatus();
    });
  }

  async function unstageAll() {
    const root = options.state.repoRoot.value;
    const paths = options.state.unstageAllPaths.value;
    if (!root || paths.length === 0) return;
    await runWithBusy("unstage-all", async () => {
      await options.native.gitUnstage(root, paths);
      await options.state.refreshStatus();
    });
  }

  async function discardEntries(entries: GitDiscardEntry[], busy: BusyAction) {
    const root = options.state.repoRoot.value;
    if (!root || entries.length === 0) return;
    await runWithBusy(busy, async () => {
      await options.native.gitDiscard(root, entries);
      await options.state.refreshStatus();
    });
  }

  function confirmDiscardFile(entry: SourceControlFileEntry) {
    if (!entry.unstaged || options.state.busyAction.value) return;
    options.dialog.warning({
      title: options.t("sourceControl.discardTitle"),
      content: options.t("sourceControl.discardFileContent", { path: entry.path }),
      positiveText: options.t("sourceControl.discard"),
      negativeText: options.t("common.cancel"),
      onPositiveClick: () =>
        discardEntries(
          [{ path: entry.path, untracked: entry.untracked }],
          `discard:${entry.path}`,
        ),
    });
  }

  function confirmDiscardAll() {
    const entries = options.state.discardAllEntries.value;
    if (entries.length === 0 || options.state.busyAction.value) return;
    options.dialog.warning({
      title: options.t("sourceControl.discardTitle"),
      content: options.t("sourceControl.discardManyContent", {
        count: entries.length,
        changeWord: entries.length === 1 ? "change" : "changes",
      }),
      positiveText: options.t("sourceControl.discard"),
      negativeText: options.t("common.cancel"),
      onPositiveClick: () => discardEntries(entries, "discard-all"),
    });
  }

  async function fetchRemote() {
    const root = options.state.repoRoot.value;
    if (!root) return;
    await runWithBusy("fetch", async () => {
      const result = await options.native.gitFetch(root);
      actionMessage.value = result.summary;
      notifySuccess(options.t("sourceControl.fetchSuccess"), result.summary);
      await options.state.refreshStatus();
      await options.refreshGitMetadata?.();
    });
  }

  async function pullRemote() {
    const root = options.state.repoRoot.value;
    if (!root) return;
    await runWithBusy("pull", async () => {
      const result = await options.native.gitPullFfOnly(root);
      actionMessage.value = result.summary;
      notifySuccess(options.t("sourceControl.pullSuccess"), result.summary);
      await options.state.refreshStatus();
      await options.refreshGitMetadata?.();
    });
  }

  async function pushRemote() {
    const root = options.state.repoRoot.value;
    if (!root) return;
    await runWithBusy("push", async () => {
      const result = await options.native.gitPush(root);
      actionMessage.value = options.t("sourceControl.pushedTo", {
        target: pushedLabel(result.remote, result.branch),
      });
      notifySuccess(options.t("sourceControl.pushSuccess"), actionMessage.value);
      await options.state.refreshStatus();
      await options.refreshGitMetadata?.();
    });
  }

  async function checkoutBranch(branch: Pick<GitBranchInfo, "name" | "isRemote">) {
    const root = options.state.repoRoot.value;
    if (!root) return;
    await runWithBusy(`checkout:${branch.name}`, async () => {
      const result = await options.native.gitCheckoutBranch(root, branch.name, branch.isRemote);
      const detail = options.t("sourceControl.branchCheckoutDetail", {
        branch: result.branch,
      });
      actionMessage.value = detail;
      notifySuccess(options.t("sourceControl.branchCheckoutSuccess"), detail);
      await options.state.reloadCurrent?.();
      await options.refreshGitMetadata?.();
    });
  }

  async function createBranch(branch: string) {
    const root = options.state.repoRoot.value;
    const name = branch.trim();
    if (!root || !name) return;
    await runWithBusy("branch-create", async () => {
      const result = await options.native.gitCreateBranch(root, name);
      const detail = options.t("sourceControl.branchCreateDetail", {
        branch: result.branch,
      });
      actionMessage.value = detail;
      notifySuccess(options.t("sourceControl.branchCreateSuccess"), detail);
      await options.state.reloadCurrent?.();
      await options.refreshGitMetadata?.();
    });
  }

  async function stashChanges(message: string | null = null) {
    const root = options.state.repoRoot.value;
    if (!root) return;
    await runWithBusy("stash-save", async () => {
      const result = await options.native.gitStashPush(root, {
        message: message?.trim() || null,
        includeUntracked: true,
      });
      actionMessage.value = result.message;
      notifySuccess(options.t("sourceControl.stashSaveSuccess"), result.message);
      await options.state.refreshStatus();
      await options.refreshGitMetadata?.();
    });
  }

  async function popStash(selector: string) {
    const root = options.state.repoRoot.value;
    if (!root) return;
    await runWithBusy(`stash-pop:${selector}`, async () => {
      const result = await options.native.gitStashPop(root, selector);
      actionMessage.value = result.message;
      notifySuccess(options.t("sourceControl.stashPopSuccess"), result.message);
      await options.state.refreshStatus();
      await options.refreshGitMetadata?.();
    });
  }

  async function dropStash(selector: string) {
    const root = options.state.repoRoot.value;
    if (!root) return;
    await runWithBusy(`stash-drop:${selector}`, async () => {
      const result = await options.native.gitStashDrop(root, selector);
      actionMessage.value = result.message;
      notifySuccess(options.t("sourceControl.stashDropSuccess"), result.message);
      await options.refreshGitMetadata?.();
    });
  }

  async function commit() {
    const root = options.state.repoRoot.value;
    const message = commitMessage.value.trim();
    if (!root || !message || options.state.busyAction.value) return;
    await runWithBusy("commit", async () => {
      const result = await options.native.gitCommit(root, message);
      commitMessage.value = "";
      actionMessage.value = result.summary;
      notifySuccess(options.t("sourceControl.commitSuccess"), result.summary);
      options.emitCommitted(result);
      await options.state.refreshStatus();
      await options.refreshGitMetadata?.();
    });
  }

  function handleCommitKeydown(event: KeyboardEvent) {
    if (event.key !== "Enter" || (!event.metaKey && !event.ctrlKey)) return;
    event.preventDefault();
    void commit();
  }

  return {
    actionMessage,
    actionError,
    commitMessage,
    commitInputProps,
    canCommit,
    refresh,
    stageFile,
    unstageFile,
    stageAll,
    unstageAll,
    confirmDiscardFile,
    confirmDiscardAll,
    fetchRemote,
    pullRemote,
    pushRemote,
    checkoutBranch,
    createBranch,
    stashChanges,
    popStash,
    dropStash,
    commit,
    handleCommitKeydown,
  };
}

function errorTitleForBusy(busy: BusyAction): string {
  if (busy === "fetch") return "sourceControl.fetchFailed";
  if (busy === "pull") return "sourceControl.pullFailed";
  if (busy === "push") return "sourceControl.pushFailed";
  if (busy === "commit") return "sourceControl.commitFailed";
  if (busy === "branch-create") return "sourceControl.branchCreateFailed";
  if (busy.startsWith("checkout:")) return "sourceControl.branchCheckoutFailed";
  if (busy === "stash-save") return "sourceControl.stashSaveFailed";
  if (busy.startsWith("stash-pop:")) return "sourceControl.stashPopFailed";
  if (busy.startsWith("stash-drop:")) return "sourceControl.stashDropFailed";
  return "sourceControl.actionFailed";
}
