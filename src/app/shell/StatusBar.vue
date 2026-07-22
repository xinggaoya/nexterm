<script setup lang="ts">
import {
  GitBranchOutline,
  FolderOutline,
  ServerOutline,
  TerminalOutline,
} from "@vicons/ionicons5";
import { NIcon } from "naive-ui";
import { computed, type Component } from "vue";
import { t } from "@/modules/i18n/translate";
import type { PanelKey } from "@/app/useWorkbenchLayout";

interface PanelStates {
  workspace: boolean;
  sourceControl: boolean;
  explorer: boolean;
  taskConsole: boolean;
}

const props = defineProps<{
  workspaceName: string | null;
  gitBranch: string | null;
  panelStates: PanelStates;
}>();

const emit = defineEmits<{
  "toggle-panel": [key: PanelKey];
}>();

const PANEL_ORDER: readonly PanelKey[] = [
  "sourceControl",
  "explorer",
  "workspace",
  "taskConsole",
] as const;

function iconFor(key: PanelKey): Component {
  switch (key) {
    case "sourceControl":
      return GitBranchOutline;
    case "explorer":
      return FolderOutline;
    case "workspace":
      return ServerOutline;
    case "taskConsole":
      return TerminalOutline;
  }
}

const crumb = computed(() => {
  if (!props.workspaceName) return "";
  return t("app.status.crumb", {
    workspace: props.workspaceName,
    branch: props.gitBranch ?? "—",
  });
});

function isOn(key: PanelKey): boolean {
  return props.panelStates[key];
}

function toggle(key: PanelKey): void {
  emit("toggle-panel", key);
}
</script>

<template>
  <footer
    class="flex h-6 shrink-0 items-center justify-between gap-3 border-t border-border bg-shell-bg px-3 text-[11px] text-muted-foreground"
  >
    <div class="flex min-w-0 items-center gap-2">
      <span v-if="crumb" class="truncate" :title="crumb">{{ crumb }}</span>
    </div>

    <div class="flex shrink-0 items-center gap-0.5">
      <button
        v-for="key in PANEL_ORDER"
        :key="key"
        type="button"
        :data-toggle-panel="key"
        :aria-pressed="isOn(key)"
        :title="t(`app.status.toggle.${key}`)"
        class="grid size-5 place-items-center rounded-sm transition-colors hover:bg-surface-hover"
        :class="isOn(key) ? 'text-primary' : 'text-muted-foreground/60'"
        @click="toggle(key)"
      >
        <NIcon :component="iconFor(key)" :size="13" />
      </button>
    </div>
  </footer>
</template>
