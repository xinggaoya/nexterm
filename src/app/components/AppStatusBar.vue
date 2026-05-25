<script setup lang="ts">
import {
  TerminalOutline,
} from "@vicons/ionicons5";
import { NIcon } from "naive-ui";
import WorkspaceEnvSelector from "./WorkspaceEnvSelector.vue";
import { t } from "@/modules/i18n/translate";
import type { WorkspaceEnv } from "@/modules/workspace";

const props = defineProps<{
  workspaceRoot: string | null;
  terminalCwd: string | null;
  workspaceSwitching?: boolean;
  switchingWorkspaceEnv?: WorkspaceEnv | null;
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
      <WorkspaceEnvSelector
        :switching="props.workspaceSwitching"
        :switching-env="props.switchingWorkspaceEnv"
        @select="(env) => emit('workspaceChange', env)"
      />
      <NIcon :component="TerminalOutline" :size="12" class="shrink-0" />
      <span class="truncate" :title="props.workspaceRoot ?? undefined">
        {{ props.workspaceRoot ?? t("app.status.noWorkspace") }}
      </span>
      <span
        v-if="props.terminalCwd && props.workspaceRoot && props.terminalCwd !== props.workspaceRoot"
        class="hidden min-w-0 truncate text-muted-foreground/70 lg:inline"
        :title="props.terminalCwd"
      >
        {{ props.terminalCwd }}
      </span>
    </div>
    <div class="flex shrink-0 items-center gap-2" />
  </footer>
</template>
