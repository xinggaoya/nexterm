<script setup lang="ts">
import { AddOutline, CloseOutline, LogoApple } from "@vicons/ionicons5";
import { NIcon } from "naive-ui";
import { computed } from "vue";
import { useWorkspacesPiniaStore } from "@/modules/workspace/workspacesPinia";
import type { WorkspaceInstance } from "@/modules/workspace/workspacesPinia";
import { IS_WINDOWS } from "@/lib/platform";
import { t } from "@/modules/i18n/translate";

const workspaces = useWorkspacesPiniaStore();

const emit = defineEmits<{
  addWorkspace: [];
}>();

const list = computed(() => workspaces.workspaces);
const activeId = computed(() => workspaces.activeWorkspaceId);

function envBadge(ws: WorkspaceInstance): string {
  if (ws.env.kind === "wsl") {
    // Show a short distro tag (first letters uppercased).
    const name = ws.env.distro;
    return name.length > 6 ? name.slice(0, 4) : name;
  }
  return "";
}

function isWindowsIcon(): boolean {
  // Use a neutral folder glyph for local on all platforms; WSL shows a Tux-ish
  // badge via text since ionicons has no penguin. Kept simple for now.
  return IS_WINDOWS;
}

function select(id: string): void {
  workspaces.setActive(id);
}

function close(event: MouseEvent, id: string): void {
  // Stop the click from also selecting the workspace.
  event.stopPropagation();
  void workspaces.removeWorkspace(id);
}
</script>

<template>
  <div
    class="flex items-center gap-1 border-b border-border/60 bg-title-bar px-2 py-1"
    data-workspace-bar
  >
    <button
      v-for="ws in list"
      :key="ws.id"
      type="button"
      class="group flex max-w-[220px] min-w-0 items-center gap-1.5 rounded-md px-2.5 py-1 text-[12px] transition-colors"
      :class="
        ws.id === activeId
          ? 'bg-accent text-foreground'
          : 'text-muted-foreground hover:bg-accent/60 hover:text-foreground'
      "
      :data-workspace-id="ws.id"
      :data-active="ws.id === activeId"
      :title="ws.rootPath"
      @click="select(ws.id)"
    >
      <span class="flex shrink-0 items-center gap-1">
        <NIcon
          v-if="ws.env.kind === 'wsl'"
          :component="LogoApple"
          :size="13"
          class="text-primary"
        />
        <span
          v-else
          class="text-[11px]"
          :aria-hidden="true"
        >📁</span>
      </span>
      <span class="truncate font-medium">{{ ws.name }}</span>
      <span
        v-if="envBadge(ws)"
        class="shrink-0 rounded bg-primary/15 px-1 py-px text-[10px] leading-none text-primary"
      >
        {{ envBadge(ws) }}
      </span>
      <span
        class="ml-0.5 flex shrink-0 items-center rounded p-0.5 opacity-0 transition-opacity group-hover:opacity-100"
        :data-close-id="ws.id"
        @click="(e) => close(e, ws.id)"
      >
        <NIcon :component="CloseOutline" :size="12" />
      </span>
    </button>

    <button
      type="button"
      class="flex shrink-0 items-center justify-center rounded-md p-1 text-muted-foreground transition-colors hover:bg-accent/60 hover:text-foreground"
      :title="t('app.workspaceBar.add')"
      data-add-workspace
      @click="emit('addWorkspace')"
    >
      <NIcon :component="AddOutline" :size="15" />
    </button>

    <span v-if="isWindowsIcon()" class="sr-only">multi-env</span>
  </div>
</template>
