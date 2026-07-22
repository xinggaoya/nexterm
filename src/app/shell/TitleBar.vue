<script setup lang="ts">
import {
  SearchOutline,
  SettingsOutline,
} from "@vicons/ionicons5";
import { getCurrentWindow } from "@tauri-apps/api/window";
import { NIcon } from "naive-ui";
import { onMounted } from "vue";
import TooltipTitle from "@/components/TooltipTitle.vue";
import WindowControls from "@/components/WindowControls.vue";
import { IS_MAC, IS_WINDOWS } from "@/lib/platform";
import { hasTauriInternals } from "@/lib/tauriRuntime";
import { t } from "@/modules/i18n/translate";
import { useWorkspaceEnvPiniaStore } from "@/modules/workspace/workspaceEnvPinia";
import WorkspaceBar from "./WorkspaceBar.vue";

defineProps<{
  showWindowControls: boolean;
}>();

const emit = defineEmits<{
  openCommandPalette: [];
  openSettings: [];
  selectWorkspace: [id: string];
  closeWorkspace: [id: string];
  addWorkspace: [];
  openInNewWindow: [];
}>();

const workspaceEnv = useWorkspaceEnvPiniaStore();

onMounted(() => {
  if (IS_WINDOWS && hasTauriInternals()) void workspaceEnv.refreshDistros();
});

async function startWindowDrag(event: PointerEvent) {
  if (event.button !== 0) return;
  // Only start window drag when the user grabs the drag region itself.
  // The center container wraps WorkspaceBar — clicks on workspace tabs
  // would otherwise be swallowed by stopPropagation/preventDefault here,
  // so we let those events fall through to the underlying buttons.
  if (event.target !== event.currentTarget) return;
  event.preventDefault();
  event.stopPropagation();
  try {
    await getCurrentWindow().startDragging();
  } catch {
    // Browser-only dev/test context
  }
}
</script>

<template>
  <header
    class="flex h-10 shrink-0 items-center border-b border-border bg-title-bar"
    :class="IS_MAC ? 'pl-[70px]' : ''"
  >
    <!-- Left: Logo -->
    <div
      class="flex w-28 shrink-0 items-center gap-2 pl-3 text-[12px] font-semibold text-foreground"
      data-window-drag-region
      @pointerdown="startWindowDrag"
    >
      <span class="size-2 rounded-sm bg-primary shadow-[0_0_12px_color-mix(in_oklch,var(--primary)_55%,transparent)]" />
      <span>Nexterm</span>
    </div>

    <!-- Center: WorkspaceBar + drag area -->
    <div
      class="flex min-w-0 flex-1 items-center justify-center"
      data-window-drag-region
      @pointerdown="startWindowDrag"
    >
      <WorkspaceBar
        @select-workspace="(id) => emit('selectWorkspace', id)"
        @close-workspace="(id) => emit('closeWorkspace', id)"
        @add-workspace="emit('addWorkspace')"
        @open-in-new-window="emit('openInNewWindow')"
      />
    </div>

    <!-- Right: command center + settings + window controls -->
    <div class="flex w-28 shrink-0 items-center justify-end gap-0.5 pr-1">
      <TooltipTitle :label="t('app.header.openCommandCenter')">
        <button
          type="button"
          data-open-command-palette
          :aria-label="t('app.header.openCommandCenter')"
          class="nexterm-icon-button"
          @click="emit('openCommandPalette')"
        >
          <NIcon :component="SearchOutline" :size="14" />
        </button>
      </TooltipTitle>
      <TooltipTitle :label="t('common.settings')">
        <button
          type="button"
          data-open-settings
          :aria-label="t('common.settings')"
          class="nexterm-icon-button"
          @click="emit('openSettings')"
        >
          <NIcon :component="SettingsOutline" :size="14" />
        </button>
      </TooltipTitle>
      <WindowControls v-if="showWindowControls && !IS_MAC" />
    </div>
  </header>
</template>
