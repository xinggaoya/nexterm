import { computed, ref, type TextareaHTMLAttributes } from "vue";
import type {
  GitBranchInfo,
  GitCommitResult,
  GitDiscardEntry,
  GitStashPushOptions,
  GitStashResult,
  WorkspaceNative,
} from "@/lib/native";
import { notifyError, notifyInfo, notifySuccess } from "@/modules/notifications/notificationCenter";
import type { SourceControlFileEntry } from "./sourceControlModel";
import {
  normalizeError,
  pushedLabel,
  type SourceControlTranslate,
} from "./sourceControlFormat";
import type { BusyAction, SourceControlRuntimeState } from "./useSourceControlState";

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
  /** 绑定到目标 workspace 环境的 native 调用面（git stage/commit/push/...）。 */
  wsNative: WorkspaceNative;
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
      await options.wsNative.gitStage(root, [entry.path]);
      await options.state.refreshStatus();
    });
  }

  async function unstageFile(entry: SourceControlFileEntry) {
    const root = options.state.repoRoot.value;
    if (!root) return;
    await runWithBusy(`unstage:${entry.path}`, async () => {
      await options.wsNative.gitUnstage(root, [entry.path]);
      await options.state.refreshStatus();
    });
  }

  async function stageAll() {
    const root = options.state.repoRoot.value;
    const paths = options.state.stageAllPaths.value;
    if (!root || paths.length === 0) return;
    await runWithBusy("stage-all", async () => {
      await options.wsNative.gitStage(root, paths);
      await options.state.refreshStatus();
    });
  }

  async function stagePaths(paths: string[]) {
    const root = options.state.repoRoot.value;
    const unique = Array.from(new Set(paths));
    if (!root || unique.length === 0) return;
    await runWithBusy("stage-selected", async () => {
      await options.wsNative.gitStage(root, unique);
      await options.state.refreshStatus();
    });
  }

  async function unstageAll() {
    const root = options.state.repoRoot.value;
    const paths = options.state.unstageAllPaths.value;
    if (!root || paths.length === 0) return;
    await runWithBusy("unstage-all", async () => {
      await options.wsNative.gitUnstage(root, paths);
      await options.state.refreshStatus();
    });
  }

  async function unstagePaths(paths: string[]) {
    const root = options.state.repoRoot.value;
    const unique = Array.from(new Set(paths));
    if (!root || unique.length === 0) return;
    await runWithBusy("unstage-selected", async () => {
      await options.wsNative.gitUnstage(root, unique);
      await options.state.refreshStatus();
    });
  }

  async function discardEntries(entries: GitDiscardEntry[], busy: BusyAction) {
    const root = options.state.repoRoot.value;
    if (!root || entries.length === 0) return;
    await runWithBusy(busy, async () => {
      await options.wsNative.gitDiscard(root, entries);
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

  function confirmDiscardEntries(entries: GitDiscardEntry[]) {
    const unique = Array.from(
      new Map(entries.map((entry) => [entry.path, entry])).values(),
    );
    if (unique.length === 0 || options.state.busyAction.value) return;
    options.dialog.warning({
      title: options.t("sourceControl.discardTitle"),
      content: options.t("sourceControl.discardManyContent", {
        count: unique.length,
        changeWord: unique.length === 1 ? "change" : "changes",
      }),
      positiveText: options.t("sourceControl.discard"),
      negativeText: options.t("common.cancel"),
      onPositiveClick: () => discardEntries(unique, "discard-selected"),
    });
  }

  async function fetchRemote() {
    const root = options.state.repoRoot.value;
    if (!root) return;
    await runWithBusy("fetch", async () => {
      const result = await options.wsNative.gitFetch(root);
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
      const result = await options.wsNative.gitPullFfOnly(root);
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
      const result = await options.wsNative.gitPush(root);
      actionMessage.value = options.t("sourceControl.pushedTo", {
        target: pushedLabel(result.remote, result.branch),
      });
      notifySuccess(options.t("sourceControl.pushSuccess"), actionMessage.value);
      await options.state.refreshStatus();
      await options.refreshGitMetadata?.();
    });
  }

  async function checkoutBranch(
    branch: Pick<GitBranchInfo, "name" | "isRemote">,
  ) {
    const root = options.state.repoRoot.value;
    if (!root) return;
    await runWithBusy(`checkout:${branch.name}`, async () => {
      // `branch.name` for remote-tracking entries arrives as `origin/main`,
      // which is what the backend needs to decide between switching to an
      // existing local branch (`main`) and `switch --track origin/main`.
      // `isRemote` is preserved so the backend can apply that logic.
      const result = await options.wsNative.gitCheckoutBranch(
        root,
        branch.name,
        branch.isRemote,
      );
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
      const result = await options.wsNative.gitCreateBranch(root, name);
      const detail = options.t("sourceControl.branchCreateDetail", {
        branch: result.branch,
      });
      actionMessage.value = detail;
      notifySuccess(options.t("sourceControl.branchCreateSuccess"), detail);
      await options.state.reloadCurrent?.();
      await options.refreshGitMetadata?.();
    });
  }

  type StashActionInput =
    | string
    | { selector: string; fullSha: string };

  function normalizeStashActionInput(
    input: StashActionInput,
    expectedSha: string | null,
  ): { selector: string; expectedSha: string | null } {
    if (typeof input === "string") {
      return { selector: input, expectedSha };
    }
    return { selector: input.selector, expectedSha: input.fullSha || null };
  }

  function reportStashResult(
    result: GitStashResult,
    successKey:
      | "sourceControl.stashSaveSuccess"
      | "sourceControl.stashPopSuccess"
      | "sourceControl.stashDropSuccess"
      | "sourceControl.stashApplySuccess",
  ) {
    actionMessage.value = result.message;
    if (result.stashed) {
      notifySuccess(options.t(successKey), result.message);
    } else {
      notifyInfo(options.t("sourceControl.stashNoChanges"), result.message);
    }
  }

  async function refreshStashState() {
    await options.state.refreshStatus();
    await options.refreshGitMetadata?.();
  }

  async function stashChanges(
    input: GitStashPushOptions | string | null = null,
    legacyKeepIndex = false,
  ) {
    const root = options.state.repoRoot.value;
    if (!root) return;
    const stashOptions: GitStashPushOptions =
      input && typeof input === "object"
        ? {
            message: input.message?.trim() || null,
            includeUntracked: input.includeUntracked,
            keepIndex: input.keepIndex ?? false,
          }
        : {
            message: typeof input === "string" ? input.trim() || null : null,
            includeUntracked: true,
            ...(legacyKeepIndex ? { keepIndex: true } : {}),
          };
    await runWithBusy("stash-save", async () => {
      try {
        const result = await options.wsNative.gitStashPush(root, stashOptions);
        reportStashResult(result, "sourceControl.stashSaveSuccess");
      } finally {
        await refreshStashState();
      }
    });
  }

  async function popStash(
    input: StashActionInput,
    expectedSha: string | null = null,
  ) {
    const root = options.state.repoRoot.value;
    if (!root) return;
    const { selector, expectedSha: sha } = normalizeStashActionInput(input, expectedSha);
    await runWithBusy(`stash-pop:${selector}`, async () => {
      try {
        const result = sha
          ? await options.wsNative.gitStashPop(root, selector, sha)
          : await options.wsNative.gitStashPop(root, selector);
        reportStashResult(result, "sourceControl.stashPopSuccess");
      } finally {
        await refreshStashState();
      }
    });
  }

  async function executeDrop(selector: string, expectedSha: string | null) {
    const root = options.state.repoRoot.value;
    if (!root) return;
    await runWithBusy(`stash-drop:${selector}`, async () => {
      try {
        const result = expectedSha
          ? await options.wsNative.gitStashDrop(root, selector, expectedSha)
          : await options.wsNative.gitStashDrop(root, selector);
        reportStashResult(result, "sourceControl.stashDropSuccess");
      } finally {
        await refreshStashState();
      }
    });
  }

  async function dropStash(
    input: StashActionInput,
    expectedSha: string | null = null,
  ) {
    if (options.state.busyAction.value) return;
    const { selector, expectedSha: sha } = normalizeStashActionInput(input, expectedSha);
    await options.dialog.warning({
      title: options.t("sourceControl.stashDropConfirmTitle"),
      content: options.t("sourceControl.stashDropConfirmContent", { selector }),
      positiveText: options.t("sourceControl.stashDrop"),
      negativeText: options.t("common.cancel"),
      onPositiveClick: () => executeDrop(selector, sha),
    });
  }

  async function applyStash(
    input: StashActionInput,
    expectedSha: string | null = null,
  ) {
    const root = options.state.repoRoot.value;
    if (!root) return;
    const { selector, expectedSha: sha } = normalizeStashActionInput(input, expectedSha);
    await runWithBusy(`stash-apply:${selector}`, async () => {
      try {
        const result = sha
          ? await options.wsNative.gitStashApply(root, selector, sha)
          : await options.wsNative.gitStashApply(root, selector);
        reportStashResult(result, "sourceControl.stashApplySuccess");
      } finally {
        await refreshStashState();
      }
    });
  }

  async function commit() {
    const root = options.state.repoRoot.value;
    const message = commitMessage.value.trim();
    if (!root || !message || options.state.busyAction.value) return;
    await runWithBusy("commit", async () => {
      const result = await options.wsNative.gitCommit(root, message);
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
    stagePaths,
    unstageAll,
    unstagePaths,
    confirmDiscardFile,
    confirmDiscardAll,
    confirmDiscardEntries,
    fetchRemote,
    pullRemote,
    pushRemote,
    checkoutBranch,
    createBranch,
    stashChanges,
    popStash,
    dropStash,
    applyStash,
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
  if (busy.startsWith("stash-apply:")) return "sourceControl.stashApplyFailed";
  return "sourceControl.actionFailed";
}
