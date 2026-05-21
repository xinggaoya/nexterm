<script setup lang="ts">
import {
  FolderOpenOutline,
  LockClosedOutline,
  TerminalOutline,
} from "@vicons/ionicons5";
import { NButton, NIcon } from "naive-ui";
import WorkspaceEnvSelector from "./WorkspaceEnvSelector.vue";
import type { WorkspaceEnv } from "@/modules/workspace";

const props = defineProps<{
  workspaceRoot: string | null;
  terminalCwd: string | null;
  privateActive: boolean;
}>();

const emit = defineEmits<{
  workspaceChange: [env: WorkspaceEnv];
  chooseWorkspace: [];
}>();
</script>

<template>
  <footer
    class="flex h-6 shrink-0 items-center justify-between gap-3 border-t border-border/60 bg-card px-2 text-[11px] text-muted-foreground"
  >
    <div class="flex min-w-0 items-center gap-1.5">
      <WorkspaceEnvSelector @select="(env) => emit('workspaceChange', env)" />
      <NButton
        size="tiny"
        quaternary
        title="Open folder"
        aria-label="Open folder"
        data-open-workspace
        @click="emit('chooseWorkspace')"
      >
        <template #icon><NIcon :component="FolderOpenOutline" /></template>
      </NButton>
      <NIcon :component="TerminalOutline" :size="12" class="shrink-0" />
      <span class="truncate" :title="props.workspaceRoot ?? undefined">
        {{ props.workspaceRoot ?? "No workspace" }}
      </span>
      <span
        v-if="props.terminalCwd && props.workspaceRoot && props.terminalCwd !== props.workspaceRoot"
        class="hidden min-w-0 truncate text-muted-foreground/70 lg:inline"
        :title="props.terminalCwd"
      >
        {{ props.terminalCwd }}
      </span>
    </div>
    <div class="flex shrink-0 items-center gap-2">
      <span
        v-if="props.privateActive"
        class="inline-flex h-4 items-center gap-1 rounded-full bg-amber-500/15 px-1.5 text-[10px] font-medium text-amber-700 dark:text-amber-300"
      >
        <NIcon :component="LockClosedOutline" :size="10" />
        Private
      </span>
    </div>
  </footer>
</template>
