<script setup lang="ts">
import { onBeforeUnmount, ref, type Ref } from "vue";
import ActivityIcons from "./ActivityIcons.vue";
import SourceControlPanel from "@/modules/source-control/SourceControlPanel.vue";
import WorkspaceBar from "./WorkspaceBar.vue";
import type {
  ActivityKey,
  PanelKey,
} from "@/app/useWorkbenchLayout";
import type { WorkspaceInstance } from "@/modules/workspace";
import type { GitDecorationMap } from "@/modules/source-control";
import type { GitCommitResult } from "@/lib/native";
import type { WorkspaceFsChangedEvent } from "@/lib/native";

const props = defineProps<{
  activity: ActivityKey;
  open: boolean;
  width: number;
  minWidth: number;
  maxWidth: number;
  workspace: WorkspaceInstance;
  activeRepoRoot: string | null;
  fsEvent: WorkspaceFsChangedEvent | null;
  showBranchesModal: Ref<boolean>;
}>();

const emit = defineEmits<{
  "select-activity": [key: ActivityKey];
  "add-workspace": [];
  "open-in-new-window": [];
  "select-workspace": [id: string];
  "close-workspace": [id: string];
  "resize-width": [width: number];
  "toggle-panel": [key: PanelKey];
  "open-diff": [
    input: {
      repoRoot: string;
      path: string;
      mode: "+" | "-";
      originalPath: string | null;
      title: string;
    },
  ];
  "open-history": [
    input: {
      repoRoot: string;
      branch: string | null;
      refName: string | null;
      allRefs: boolean;
    },
  ];
  "repo-selected": [repoRoot: string | null];
  "decoration-change": [decorations: GitDecorationMap];
  committed: [result: GitCommitResult];
}>();

const dragging = ref(false);
let detachMove: (() => void) | null = null;
let detachUp: (() => void) | null = null;

function onResizeStart(e: PointerEvent) {
  e.preventDefault();
  dragging.value = true;
  const startX = e.clientX;
  const startWidth = (e.currentTarget as HTMLElement).parentElement
    ?.parentElement?.getBoundingClientRect().width ?? 0;

  function onMove(ev: PointerEvent) {
    const dx = ev.clientX - startX;
    emit("resize-width", startWidth + dx);
  }

  function onUp() {
    dragging.value = false;
    window.removeEventListener("pointermove", onMove);
    window.removeEventListener("pointerup", onUp);
    detachMove = null;
    detachUp = null;
  }

  window.addEventListener("pointermove", onMove);
  window.addEventListener("pointerup", onUp);
  detachMove = () => window.removeEventListener("pointermove", onMove);
  detachUp = () => window.removeEventListener("pointerup", onUp);
}

onBeforeUnmount(() => {
  detachMove?.();
  detachUp?.();
});
</script>

<template>
  <aside
    v-if="open"
    class="v2-anim-slide-left flex shrink-0 border-r border-border bg-sidebar"
    :style="{ width: `${width}px` }"
    :data-activity="activity"
  >
    <ActivityIcons
      :activity="activity"
      @select-activity="(k) => emit('select-activity', k)"
      @add-workspace="emit('add-workspace')"
      @open-in-new-window="emit('open-in-new-window')"
    />

    <div class="relative min-w-0 flex-1">
      <SourceControlPanel
        v-show="activity === 'sourceControl'"
        :root-path="workspace.rootPath"
        :workspace-scope="workspace.env.kind === 'wsl' ? `wsl:${workspace.env.distro}` : 'local'"
        :active-repo-root="activeRepoRoot"
        :fs-event="fsEvent"
        :show-branches-modal="showBranchesModal"
        @open-diff="(input) => emit('open-diff', input)"
        @open-history="(input) => emit('open-history', input)"
        @repo-selected="(repoRoot) => emit('repo-selected', repoRoot)"
        @decorations-change="(d) => emit('decoration-change', d)"
        @committed="(result) => emit('committed', result)"
      />
      <WorkspaceBar
        v-show="activity === 'workspace'"
        embedded
        @select-workspace="(id) => emit('select-workspace', id)"
        @close-workspace="(id) => emit('close-workspace', id)"
        @add-workspace="emit('add-workspace')"
        @open-in-new-window="emit('open-in-new-window')"
      />

      <div
        data-left-sidebar-resizer
        class="absolute inset-y-0 right-0 z-10 w-1 cursor-col-resize bg-transparent transition-colors duration-[var(--dur-fast)] hover:bg-primary/40"
        @pointerdown="onResizeStart"
      />
    </div>
  </aside>
</template>
