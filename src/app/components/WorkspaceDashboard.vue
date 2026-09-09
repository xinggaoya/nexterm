<script setup lang="ts">
import { onMounted } from "vue";
import { NIcon } from "naive-ui";
import { ServerOutline, TerminalOutline } from "@vicons/ionicons5";
import { IS_WINDOWS } from "@/lib/platform";
import { hasTauriInternals } from "@/lib/tauriRuntime";
import { t } from "@/modules/i18n/translate";
import type { WorkspaceSelection } from "@/modules/workspace";
import { useWorkspaceEnvPiniaStore } from "@/modules/workspace/workspaceEnvPinia";
import WorkspaceEnvSelector from "./WorkspaceEnvSelector.vue";

/**
 * 工作区仪表盘:无工作区时的全屏着陆页(终端优先壳层的"待命"状态)。
 * 居中字标 + 环境选择 + 大号打开按钮 + 最近工作区卡片网格。
 * Props/emits 与旧 WorkspaceWelcome 完全一致,MainApp 接线不变。
 */
defineProps<{
  recentWorkspaces: (WorkspaceSelection & { openedAt?: number })[];
  loading?: boolean;
  error?: string | null;
}>();

const emit = defineEmits<{
  chooseWorkspace: [env: import("@/modules/workspace").WorkspaceEnv];
  openRecent: [record: WorkspaceSelection & { openedAt?: number }];
  workspaceEnvChange: [env: import("@/modules/workspace").WorkspaceEnv];
}>();

const workspaceEnv = useWorkspaceEnvPiniaStore();

onMounted(() => {
  if (IS_WINDOWS && hasTauriInternals()) void workspaceEnv.refreshDistros();
});

function monogramOf(path: string): string {
  const name = path.split(/[\\/]/).filter(Boolean).pop() ?? "?";
  return (name[0] ?? "?").toUpperCase();
}

function envBadgeOf(record: WorkspaceSelection): "wsl" | "ssh" | null {
  if (record.env.kind === "wsl") return "wsl";
  if (record.env.kind === "ssh") return "ssh";
  return null;
}

function envLabelOf(record: WorkspaceSelection): string {
  if (record.env.kind === "wsl") return `WSL · ${record.env.distro}`;
  if (record.env.kind === "ssh") return "SSH";
  return t("app.rail.envLocal");
}
</script>

<template>
  <div
    class="flex min-h-0 flex-1 items-center justify-center overflow-y-auto bg-shell-bg p-8"
    data-workspace-dashboard
  >
    <div class="flex w-full max-w-3xl flex-col items-center gap-10">
      <!-- Hero -->
      <div class="flex flex-col items-center gap-3 text-center">
        <div class="flex items-center gap-2.5">
          <span class="v2-dot-glow v2-anim-breathe size-2.5 rounded-full bg-primary" />
          <h1 class="text-2xl font-semibold tracking-tight text-foreground">Nexterm</h1>
        </div>
        <p class="text-[13px] text-muted-foreground">{{ t("app.dashboard.tagline") }}</p>
      </div>

      <!-- 环境选择 + 打开 -->
      <div class="flex flex-col items-center gap-4">
        <WorkspaceEnvSelector
          @select="(env) => emit('workspaceEnvChange', env)"
        />
        <button
          type="button"
          data-dashboard-open
          class="flex h-11 items-center gap-2 rounded-xl bg-primary px-6 text-[14px] font-medium text-primary-foreground transition-all duration-[var(--dur-fast)] hover:brightness-110 active:scale-[0.98]"
          @click="emit('chooseWorkspace', workspaceEnv.pendingEnv)"
        >
          <NIcon :component="TerminalOutline" :size="16" />
          {{ t("app.dashboard.openFolder") }}
        </button>
      </div>

      <!-- 错误提示 -->
      <p v-if="error" class="text-[12px] text-destructive" data-dashboard-error>{{ error }}</p>

      <!-- 最近工作区 -->
      <div v-if="recentWorkspaces.length > 0" class="w-full">
        <p class="mb-3 text-center text-[11px] font-medium uppercase tracking-widest text-muted-foreground">
          {{ t("app.dashboard.recent") }}
        </p>
        <div class="grid grid-cols-2 gap-2 sm:grid-cols-3">
          <button
            v-for="record in recentWorkspaces"
            :key="`${record.path}:${record.env.kind}`"
            type="button"
            data-dashboard-recent
            class="v2-glass group flex items-center gap-3 rounded-xl border border-border/70 p-3 text-left transition-all duration-[var(--dur-fast)] hover:border-primary/40 hover:shadow-[var(--glass-shadow)]"
            :title="record.path"
            @click="emit('openRecent', record)"
          >
            <span
              class="relative grid size-9 shrink-0 place-items-center rounded-lg bg-surface-hover text-[13px] font-semibold text-foreground"
            >
              {{ monogramOf(record.path) }}
              <span
                v-if="envBadgeOf(record)"
                class="absolute -bottom-0.5 -right-0.5 size-2 rounded-full border border-card"
                :class="envBadgeOf(record) === 'wsl' ? 'bg-info' : 'bg-warning'"
              />
            </span>
            <span class="flex min-w-0 flex-col gap-0.5">
              <span class="truncate text-[12px] font-medium text-foreground">
                {{ record.path.split(/[\\/]/).filter(Boolean).pop() }}
              </span>
              <span class="flex items-center gap-1.5 text-[11px] text-muted-foreground">
                <NIcon
                  v-if="envBadgeOf(record)"
                  :component="ServerOutline"
                  :size="10"
                />
                <span class="truncate">{{ envLabelOf(record) }} · {{ record.path }}</span>
              </span>
            </span>
          </button>
        </div>
      </div>
    </div>
  </div>
</template>
