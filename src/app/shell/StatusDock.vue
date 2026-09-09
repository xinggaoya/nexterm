<script setup lang="ts">
import { GitBranchOutline } from "@vicons/ionicons5";
import { NIcon } from "naive-ui";
import { computed } from "vue";
import { t } from "@/modules/i18n/translate";
import type { WorkspaceEnv } from "@/modules/workspace";

const props = defineProps<{
  workspaceName: string;
  env: WorkspaceEnv;
  gitBranch: string | null;
}>();

const envLabel = computed(() => {
  if (props.env.kind === "wsl") return `WSL · ${props.env.distro}`;
  if (props.env.kind === "ssh") return "SSH";
  return t("app.rail.envLocal");
});
</script>

<template>
  <footer
    class="flex h-6 shrink-0 items-center justify-between gap-3 border-t border-border bg-shell-bg px-3 text-[11px] text-muted-foreground"
    data-status-dock
  >
    <div class="flex min-w-0 items-center gap-2">
      <span class="size-1.5 shrink-0 rounded-full bg-success/70" />
      <span
        class="shrink-0 rounded-full bg-surface-hover px-1.5 text-[10px] leading-4"
        :data-env-badge="env.kind"
      >{{ envLabel }}</span>
      <span class="truncate" :title="workspaceName">{{ workspaceName }}</span>
      <span
        v-if="gitBranch"
        class="flex min-w-0 shrink-0 items-center gap-1"
        :title="gitBranch"
      >
        <NIcon :component="GitBranchOutline" :size="11" />
        <span class="max-w-36 truncate">{{ gitBranch }}</span>
      </span>
    </div>
  </footer>
</template>
