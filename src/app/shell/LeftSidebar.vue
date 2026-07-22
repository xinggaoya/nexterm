<script setup lang="ts">
import { onBeforeUnmount, ref } from "vue";
import ActivityIcons from "./ActivityIcons.vue";
import SourceControlPanel from "@/modules/source-control/SourceControlPanel.vue";
import WorkspaceBar from "./WorkspaceBar.vue";
import type {
  ActivityKey,
  PanelKey,
} from "@/app/useWorkbenchLayout";
import type { WorkspaceInstance } from "@/modules/workspace";

defineProps<{
  activity: ActivityKey;
  open: boolean;
  width: number;
  minWidth: number;
  maxWidth: number;
  workspace: WorkspaceInstance;
}>();

const emit = defineEmits<{
  "select-activity": [key: ActivityKey];
  "add-workspace": [];
  "open-in-new-window": [];
  "select-workspace": [id: string];
  "close-workspace": [id: string];
  "resize-width": [width: number];
  "toggle-panel": [key: PanelKey];
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
    class="flex shrink-0 border-r border-border/30 bg-activity-bar"
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
        class="absolute inset-y-0 right-0 z-10 w-1 cursor-col-resize bg-transparent hover:bg-border/60"
        @pointerdown="onResizeStart"
      />
    </div>
  </aside>
</template>