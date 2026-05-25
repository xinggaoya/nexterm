import { getCurrentInstance, onBeforeUnmount, ref, watch } from "vue";
import type { GitBranchInfo, GitStashEntry } from "@/lib/native";
import type { ReadableRef } from "./useSourceControlState";

type SourceControlGitMetadataNative = {
  gitBranchList: (repoRoot: string) => Promise<GitBranchInfo[]>;
  gitStashList: (repoRoot: string) => Promise<GitStashEntry[]>;
};

type SourceControlGitMetadataOptions = {
  repoRoot: ReadableRef<string | null>;
  native: SourceControlGitMetadataNative;
};

export function useSourceControlGitMetadata(options: SourceControlGitMetadataOptions) {
  const branches = ref<GitBranchInfo[]>([]);
  const stashes = ref<GitStashEntry[]>([]);
  const loading = ref(false);
  const error = ref<string | null>(null);
  const requestId = ref(0);

  async function refreshGitMetadata() {
    const root = options.repoRoot.value;
    const currentId = ++requestId.value;
    if (!root) {
      branches.value = [];
      stashes.value = [];
      error.value = null;
      return;
    }

    loading.value = true;
    error.value = null;
    try {
      const [nextBranches, nextStashes] = await Promise.all([
        options.native.gitBranchList(root),
        options.native.gitStashList(root),
      ]);
      if (currentId !== requestId.value) return;
      branches.value = nextBranches;
      stashes.value = nextStashes;
    } catch (err) {
      if (currentId !== requestId.value) return;
      error.value = normalizeError(err);
      branches.value = [];
      stashes.value = [];
    } finally {
      if (currentId === requestId.value) loading.value = false;
    }
  }

  function dispose() {
    requestId.value++;
  }

  watch(
    () => options.repoRoot.value,
    () => {
      void refreshGitMetadata();
    },
    { immediate: true },
  );

  if (getCurrentInstance()) {
    onBeforeUnmount(dispose);
  }

  return {
    branches,
    stashes,
    loading,
    error,
    refreshGitMetadata,
    dispose,
  };
}

function normalizeError(error: unknown): string {
  if (typeof error === "string") return error;
  if (error && typeof error === "object" && "message" in error) {
    const message = (error as { message?: unknown }).message;
    if (typeof message === "string") return message;
  }
  return "Unknown Git metadata error";
}
