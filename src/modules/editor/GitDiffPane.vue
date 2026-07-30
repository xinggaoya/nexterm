<script setup lang="ts">
import { NSpin, NTag } from "naive-ui";
import { computed, defineAsyncComponent, ref, watch } from "vue";
import { t } from "@/modules/i18n/translate";
import { useWorkspaceContext } from "@/app/workspaceContext";
const DiffEditor = defineAsyncComponent(() => import("./DiffEditor.vue"));
import {
  commitDiffKey,
  fetchCommitDiff,
  fetchWorkingDiff,
  getCachedDiff,
  workingDiffKey,
} from "./lib/diffCache";
import { countPatchLines } from "./lib/diffStats";

type WorkingSource = {
  kind: "working";
  repoRoot: string;
  path: string;
  mode: "-" | "+";
  originalPath: string | null;
};

type CommitSource = {
  kind: "commit";
  repoRoot: string;
  sha: string;
  path: string;
  originalPath: string | null;
};

type LoadState =
  | { kind: "idle" }
  | { kind: "loading" }
  | {
      kind: "loaded";
      originalContent: string;
      modifiedContent: string;
      isBinary: boolean;
      fallbackPatch: string;
    }
  | { kind: "error"; message: string };

const props = defineProps<{
  source: WorkingSource | CommitSource;
  chipLabel?: string;
  active: boolean;
}>();

const LARGE_FILE_THRESHOLD = 256 * 1024;
const state = ref<LoadState>({ kind: "idle" });

// 获取当前 workspace 上下文，用于 diff 缓存的 env 作用域键与 native 调用。
const wsCtx = useWorkspaceContext();

const sourceKey = computed(() =>
  props.source.kind === "working"
    ? workingDiffKey(wsCtx.workspace.env, props.source.repoRoot, props.source.path, props.source.mode)
    : commitDiffKey(wsCtx.workspace.env, props.source.repoRoot, props.source.sha, props.source.path),
);

const loaded = computed(() => (state.value.kind === "loaded" ? state.value : null));
const isTooLarge = computed(() => {
  const current = loaded.value;
  if (!current) return false;
  return (
    current.originalContent.length > LARGE_FILE_THRESHOLD ||
    current.modifiedContent.length > LARGE_FILE_THRESHOLD
  );
});
const useFallback = computed(() => {
  const current = loaded.value;
  return current ? current.isBinary || isTooLarge.value : false;
});
const stats = computed(() =>
  useFallback.value && loaded.value
    ? countPatchLines(loaded.value.fallbackPatch)
    : { added: 0, removed: 0 },
);
const mode = computed(() =>
  props.source.kind === "working" ? props.source.mode : "+",
);

function loadStateFromCache(): LoadState {
  const cached = getCachedDiff(sourceKey.value);
  if (!cached) return { kind: "idle" };
  return {
    kind: "loaded",
    originalContent: cached.originalContent,
    modifiedContent: cached.modifiedContent,
    isBinary: cached.isBinary,
    fallbackPatch: cached.fallbackPatch,
  };
}

async function loadDiff() {
  if (!props.active) return;
  const cached = loadStateFromCache();
  if (cached.kind === "loaded") {
    state.value = cached;
    return;
  }

  state.value = { kind: "loading" };
  try {
    const result =
      props.source.kind === "working"
        ? await fetchWorkingDiff(
            wsCtx.wsNative,
            wsCtx.workspace.env,
            props.source.repoRoot,
            props.source.path,
            props.source.mode,
            props.source.originalPath,
          )
        : await fetchCommitDiff(
            wsCtx.wsNative,
            wsCtx.workspace.env,
            props.source.repoRoot,
            props.source.sha,
            props.source.path,
            props.source.originalPath,
          );
    if (!props.active) return;
    state.value = {
      kind: "loaded",
      originalContent: result.originalContent,
      modifiedContent: result.modifiedContent,
      isBinary: result.isBinary,
      fallbackPatch: result.fallbackPatch,
    };
  } catch (error) {
    state.value = {
      kind: "error",
      message:
        error && typeof error === "object" && "message" in error
          ? String((error as { message: unknown }).message)
          : String(error),
    };
  }
}

watch(
  () => [props.active, sourceKey.value],
  () => void loadDiff(),
  { immediate: true },
);
</script>

<template>
  <div class="nexterm-surface flex h-full min-h-0 flex-col">
    <div class="nexterm-toolbar flex h-8 shrink-0 items-center justify-between gap-3 px-3">
      <div class="flex min-w-0 items-center gap-2">
        <NTag size="small" :bordered="false">
          {{ props.chipLabel ?? mode }}
        </NTag>
        <NTag v-if="loaded?.isBinary" size="small" :bordered="false">
          Binary / patch fallback
        </NTag>
        <NTag v-else-if="isTooLarge" size="small" :bordered="false">
          Large file / patch view
        </NTag>
        <span
          class="truncate font-mono text-[11px] text-muted-foreground"
          :title="props.source.path"
        >
          {{ props.source.path }}
        </span>
      </div>
      <div class="flex shrink-0 items-center gap-3 text-[10.5px] tabular-nums text-muted-foreground">
        <span class="max-w-80 truncate font-mono">{{ props.source.repoRoot }}</span>
        <template v-if="useFallback">
          <span class="text-success">+{{ stats.added }}</span>
          <span class="text-destructive">-{{ stats.removed }}</span>
        </template>
      </div>
    </div>

    <div class="min-h-0 flex-1 overflow-hidden">
      <div
        v-if="state.kind === 'loading' || state.kind === 'idle'"
        class="flex h-full items-center justify-center gap-2 text-[11px] text-muted-foreground"
      >
        <NSpin size="small" />
        <span>{{ t("editor.loadingDiff") }}</span>
      </div>

      <div
        v-else-if="state.kind === 'error'"
        class="flex h-full items-center justify-center px-6 text-center text-[11.5px] text-destructive"
      >
        {{ state.message }}
      </div>

      <pre
        v-else-if="useFallback"
        class="min-h-full overflow-auto whitespace-pre-wrap p-4 font-mono text-[12px] leading-relaxed text-muted-foreground"
      >{{ loaded?.fallbackPatch || t("editor.diffFallbackUnavailable") }}</pre>

      <DiffEditor
        v-else-if="loaded"
        test-id="git-diff-host"
        :path="props.source.path"
        :original-content="loaded.originalContent"
        :modified-content="loaded.modifiedContent"
      />
    </div>
  </div>
</template>
