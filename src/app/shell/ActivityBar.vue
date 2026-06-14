<script setup lang="ts">
import {
  FolderOpenOutline,
  GitCommitOutline,
  SettingsOutline,
  TerminalOutline,
} from "@vicons/ionicons5";
import { NIcon } from "naive-ui";
import TooltipTitle from "@/components/TooltipTitle.vue";
import { t } from "@/modules/i18n/translate";

defineProps<{
  leftPanelOpen: boolean;
  rightPanelOpen: boolean;
  hasWorkspace: boolean;
  changeCount?: number;
}>();

const emit = defineEmits<{
  toggleLeftPanel: [];
  toggleRightPanel: [];
  newTerminal: [];
  openSettings: [];
}>();
</script>

<template>
  <nav class="flex w-12 shrink-0 flex-col bg-activity-bar">
    <div class="flex flex-col items-center gap-1 p-1.5">
      <TooltipTitle :label="t('app.header.sourceControl')" placement="right">
        <button
          type="button"
          data-toggle-left-panel
          class="relative grid h-10 w-10 place-items-center rounded-lg transition-colors"
          :class="
            leftPanelOpen
              ? 'bg-accent/60 text-foreground'
              : 'text-muted-foreground hover:bg-accent/30 hover:text-foreground'
          "
          @click="emit('toggleLeftPanel')"
        >
          <NIcon :component="GitCommitOutline" :size="20" />
          <span
            v-if="changeCount && changeCount > 0"
            class="absolute right-1 top-1 flex h-4 min-w-4 items-center justify-center rounded-full bg-primary px-1 text-[9px] font-bold text-primary-foreground"
          >
            {{ changeCount > 99 ? "99+" : changeCount }}
          </span>
          <span
            v-else-if="leftPanelOpen"
            class="absolute left-0 top-1/2 h-5 w-0.5 -translate-y-1/2 rounded-r-full bg-foreground"
          />
        </button>
      </TooltipTitle>

      <TooltipTitle :label="t('common.explorer')" placement="right">
        <button
          type="button"
          data-toggle-right-panel
          class="relative grid h-10 w-10 place-items-center rounded-lg transition-colors"
          :class="
            rightPanelOpen
              ? 'bg-accent/60 text-foreground'
              : 'text-muted-foreground hover:bg-accent/30 hover:text-foreground'
          "
          @click="emit('toggleRightPanel')"
        >
          <NIcon :component="FolderOpenOutline" :size="20" />
          <span
            v-if="rightPanelOpen"
            class="absolute left-0 top-1/2 h-5 w-0.5 -translate-y-1/2 rounded-r-full bg-foreground"
          />
        </button>
      </TooltipTitle>

      <TooltipTitle :label="t('app.header.newTerminal')" placement="right">
        <button
          type="button"
          data-new-tab
          class="grid h-10 w-10 place-items-center rounded-lg text-muted-foreground transition-colors hover:bg-accent/30 hover:text-foreground"
          :disabled="!hasWorkspace"
          @click="emit('newTerminal')"
        >
          <NIcon :component="TerminalOutline" :size="20" />
        </button>
      </TooltipTitle>
    </div>

    <div class="mt-auto flex flex-col items-center gap-1 p-1.5">
      <TooltipTitle :label="t('common.settings')" placement="right">
        <button
          type="button"
          data-open-settings
          class="grid h-10 w-10 place-items-center rounded-lg text-muted-foreground transition-colors hover:bg-accent/30 hover:text-foreground"
          @click="emit('openSettings')"
        >
          <NIcon :component="SettingsOutline" :size="20" />
        </button>
      </TooltipTitle>
    </div>
  </nav>
</template>
