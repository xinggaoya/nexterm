import { computed, ref, type TextareaHTMLAttributes } from "vue";
import type { GitCommitResult, GitDiscardEntry, GitPushResult } from "@/lib/native";
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
  gitFetch: (repoRoot: string) => Promise<void>;
  gitPullFfOnly: (repoRoot: string) => Promise<void>;
  gitPush: (repoRoot: string) => Promise<GitPushResult>;
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
      await options.native.gitFetch(root);
      actionMessage.value = options.t("sourceControl.fetchedLatestRefs");
      await options.state.refreshStatus();
    });
  }

  async function pullRemote() {
    const root = options.state.repoRoot.value;
    if (!root) return;
    await runWithBusy("pull", async () => {
      await options.native.gitPullFfOnly(root);
      actionMessage.value = options.t("sourceControl.pulledLatestChanges");
      await options.state.refreshStatus();
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
      await options.state.refreshStatus();
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
      options.emitCommitted(result);
      await options.state.refreshStatus();
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
    commit,
    handleCommitKeydown,
  };
}
