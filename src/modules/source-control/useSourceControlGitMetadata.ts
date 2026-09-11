import { normalizeErrorMessage } from "@/lib/error";
import { getCurrentInstance, onBeforeUnmount, ref, watch } from "vue";
import type { ReadonlyRef } from "@/lib/refs";
import type {
  GitBranchInfo,
  GitRemoteInfo,
  GitStashEntry,
  GitTagInfo,
  WorkspaceNative,
} from "@/lib/native";

type SourceControlGitMetadataOptions = {
  repoRoot: ReadonlyRef<string | null>;
  /** 绑定到目标 workspace 环境的 native 调用面（git 分支/stash/标签列表）。 */
  wsNative: WorkspaceNative;
};

export function useSourceControlGitMetadata(options: SourceControlGitMetadataOptions) {
  const branches = ref<GitBranchInfo[]>([]);
  const stashes = ref<GitStashEntry[]>([]);
  const remotes = ref<GitRemoteInfo[]>([]);
  const tags = ref<GitTagInfo[]>([]);
  const loading = ref(false);
  const error = ref<string | null>(null);
  const requestId = ref(0);
  async function refreshGitMetadata() {
    const root = options.repoRoot.value;
    const currentId = ++requestId.value;
    if (!root) {
      branches.value = [];
      stashes.value = [];
      remotes.value = [];
      tags.value = [];
      error.value = null;
      return;
    }

    loading.value = true;
    error.value = null;
    try {
      const [nextBranches, nextStashes, nextRemotes, nextTags] = await Promise.all([
        options.wsNative.gitBranchList(root),
        options.wsNative.gitStashList(root),
        options.wsNative.gitRemoteList(root).catch((err) => {
          // Remotes are a soft signal — keep branches/stashes rendering even
          // when the remote list can't be read (e.g. corrupted config). The
          // error is surfaced to the reminders/modal via the `error` ref.
          error.value = normalizeErrorMessage(err);
          return [] as GitRemoteInfo[];
        }),
        options.wsNative.gitTagList(root).catch((err) => {
          // 标签列表同样是软信号：读取失败不影响分支/储藏展示。
          error.value = normalizeErrorMessage(err);
          return [] as GitTagInfo[];
        }),
      ]);
      if (currentId !== requestId.value) return;
      branches.value = nextBranches;
      stashes.value = nextStashes;
      remotes.value = nextRemotes;
      tags.value = nextTags;
    } catch (err) {
      if (currentId !== requestId.value) return;
      error.value = normalizeErrorMessage(err);
      branches.value = [];
      stashes.value = [];
      remotes.value = [];
      tags.value = [];
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
    remotes,
    tags,
    loading,
    error,
    refreshGitMetadata,
    dispose,
  };
}


