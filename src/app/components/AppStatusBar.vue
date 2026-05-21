<script setup lang="ts">
import { LockClosedOutline, TerminalOutline } from "@vicons/ionicons5";
import { NIcon } from "naive-ui";
import WorkspaceEnvSelector from "./WorkspaceEnvSelector.vue";
import type { WorkspaceEnv } from "@/modules/workspace";

const props = defineProps<{
  cwd: string | null;
  privateActive: boolean;
}>();

const emit = defineEmits<{
  workspaceChange: [env: WorkspaceEnv];
}>();
</script>

<template>
  <footer
    class="flex h-6 shrink-0 items-center justify-between gap-3 border-t border-border/60 bg-card px-2 text-[11px] text-muted-foreground"
  >
    <div class="flex min-w-0 items-center gap-1.5">
      <WorkspaceEnvSelector @select="(env) => emit('workspaceChange', env)" />
      <NIcon :component="TerminalOutline" :size="12" class="shrink-0" />
      <span class="truncate">{{ props.cwd ?? "local workspace" }}</span>
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
