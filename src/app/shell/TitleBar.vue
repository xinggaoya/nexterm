<script setup lang="ts">
import { SearchOutline, SettingsOutline } from "@vicons/ionicons5";
import { getCurrentWindow } from "@tauri-apps/api/window";
import { NIcon } from "naive-ui";
import TooltipTitle from "@/components/TooltipTitle.vue";
import WindowControls from "@/components/WindowControls.vue";
import { IS_MAC } from "@/lib/platform";
import { t } from "@/modules/i18n/translate";

defineProps<{
  workspaceRoot: string | null;
  gitBranch: string | null;
  showWindowControls: boolean;
}>();

const emit = defineEmits<{
  openCommandPalette: [];
  openSettings: [];
  chooseWorkspace: [];
}>();

function basename(path: string): string {
  const parts = path.split(/[\\/]/).filter(Boolean);
  return parts.length ? parts[parts.length - 1] : "/";
}

async function startWindowDrag(event: PointerEvent) {
  if (event.button !== 0) return;
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
    class="flex h-8 shrink-0 items-center border-b border-border/40 bg-title-bar"
    :class="IS_MAC ? 'pl-[70px]' : ''"
  >
    <WindowControls v-if="showWindowControls && !IS_MAC" />

    <div
      class="flex min-w-0 flex-1 items-center justify-center gap-2"
      data-window-drag-region
      @pointerdown="startWindowDrag"
    >
      <button
        v-if="workspaceRoot"
        type="button"
        class="flex items-center gap-1.5 rounded-md px-2 py-0.5 text-[12px] text-muted-foreground transition-colors hover:bg-accent/50 hover:text-foreground"
        data-open-workspace
        @click.stop="emit('chooseWorkspace')"
      >
        <span class="max-w-[200px] truncate font-medium text-foreground">
          {{ basename(workspaceRoot) }}
        </span>
        <span
          v-if="gitBranch"
          class="max-w-[140px] truncate text-[11px] text-muted-foreground"
        >
          {{ gitBranch }}
        </span>
      </button>
      <span v-else class="text-[12px] font-medium text-foreground">Nexterm</span>
    </div>

    <div class="flex shrink-0 items-center gap-0.5 pr-2">
      <TooltipTitle :label="t('app.header.openCommandCenter')">
        <button
          type="button"
          data-open-command-palette
          class="grid h-6 w-6 place-items-center rounded-md text-muted-foreground transition-colors hover:bg-accent hover:text-foreground"
          @click="emit('openCommandPalette')"
        >
          <NIcon :component="SearchOutline" :size="14" />
        </button>
      </TooltipTitle>
      <TooltipTitle :label="t('common.settings')">
        <button
          type="button"
          data-open-settings
          class="grid h-6 w-6 place-items-center rounded-md text-muted-foreground transition-colors hover:bg-accent hover:text-foreground"
          @click="emit('openSettings')"
        >
          <NIcon :component="SettingsOutline" :size="14" />
        </button>
      </TooltipTitle>
    </div>
  </header>
</template>
