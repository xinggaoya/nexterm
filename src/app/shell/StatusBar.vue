<script setup lang="ts">
import { GitBranchOutline, TerminalOutline } from "@vicons/ionicons5";
import { NIcon } from "naive-ui";
import WorkspaceEnvSelector from "@/app/components/WorkspaceEnvSelector.vue";
import { t } from "@/modules/i18n/translate";
import type { WorkspaceEnv } from "@/modules/workspace";

defineProps<{
  workspaceRoot: string | null;
  terminalCwd: string | null;
  gitBranch: string | null;
  workspaceSwitching?: boolean;
  switchingWorkspaceEnv?: WorkspaceEnv | null;
}>();

const emit = defineEmits<{
  workspaceChange: [env: WorkspaceEnv];
}>();
</script>

<template>
  <footer
    class="flex h-6 shrink-0 items-center justify-between gap-3 border-t border-border/40 bg-title-bar px-3 text-[11px] text-muted-foreground"
  >
    <div class="flex min-w-0 items-center gap-2">
      <WorkspaceEnvSelector
        :switching="workspaceSwitching"
        :switching-env="switchingWorkspaceEnv"
        @select="(env) => emit('workspaceChange', env)"
      />

      <template v-if="gitBranch">
        <span class="text-muted-foreground/40">|</span>
        <span class="flex items-center gap-1">
          <NIcon :component="GitBranchOutline" :size="12" />
          <span class="max-w-[120px] truncate">{{ gitBranch }}</span>
        </span>
      </template>

      <template v-if="workspaceRoot">
        <span class="text-muted-foreground/40">|</span>
        <NIcon :component="TerminalOutline" :size="12" class="shrink-0" />
        <span class="max-w-[200px] truncate" :title="workspaceRoot">
          {{ workspaceRoot }}
        </span>
      </template>

      <span
        v-if="terminalCwd && workspaceRoot && terminalCwd !== workspaceRoot"
        class="hidden max-w-[200px] truncate text-muted-foreground/60 lg:inline"
        :title="terminalCwd"
      >
        {{ terminalCwd }}
      </span>
    </div>

    <div class="flex shrink-0 items-center gap-2">
      <span v-if="!workspaceRoot" class="text-muted-foreground/60">
        {{ t("app.status.noWorkspace") }}
      </span>
    </div>
  </footer>
</template>
