<script setup lang="ts">
import {
  AlertCircleOutline,
  DesktopOutline,
  FolderOpenOutline,
  ServerOutline,
  TimeOutline,
} from "@vicons/ionicons5";
import { NButton, NIcon, NSpin } from "naive-ui";
import { computed, onMounted } from "vue";
import WorkspaceEnvSelector from "./WorkspaceEnvSelector.vue";
import { hasTauriInternals } from "@/lib/tauriRuntime";
import { t } from "@/modules/i18n/translate";
import type { StoredWorkspace } from "@/modules/settings/store";
import {
  LOCAL_WORKSPACE,
  useWorkspaceEnvPiniaStore,
  type WorkspaceEnv,
} from "@/modules/workspace";

const props = defineProps<{
  recentWorkspaces: StoredWorkspace[];
  loading: boolean;
  error: string | null;
}>();

const emit = defineEmits<{
  chooseWorkspace: [];
  openRecent: [workspace: StoredWorkspace];
  workspaceEnvChange: [env: WorkspaceEnv];
}>();

const workspaceEnv = useWorkspaceEnvPiniaStore();

const distros = computed(() => workspaceEnv.distros ?? []);
const distrosLoading = computed(() => workspaceEnv.loading);

function basename(path: string): string {
  const parts = path.split(/[\\/]/).filter(Boolean);
  return parts.length ? parts[parts.length - 1] : path;
}

function envLabel(env: WorkspaceEnv): string {
  return env.kind === "wsl" ? env.distro : t("common.local");
}

function openEnv(env: WorkspaceEnv) {
  emit("workspaceEnvChange", env);
}

onMounted(() => {
  if (hasTauriInternals()) void workspaceEnv.refreshDistros();
});
</script>

<template>
  <section
    data-workspace-welcome
    class="flex h-full min-h-0 items-center justify-center px-6 py-8"
  >
    <div class="grid w-full max-w-4xl gap-8 lg:grid-cols-[minmax(0,1fr)_320px]">
      <div class="flex min-h-[420px] flex-col justify-center">
        <div class="mb-7 flex items-center gap-3 text-foreground">
          <div class="grid size-10 place-items-center rounded-lg border border-border/70 bg-card">
            <NIcon :component="FolderOpenOutline" :size="20" />
          </div>
          <div class="min-w-0">
            <h1 class="text-2xl font-semibold tracking-normal">Nexterm</h1>
            <div class="mt-1 flex items-center gap-2 text-xs text-muted-foreground">
              <WorkspaceEnvSelector @select="(env) => emit('workspaceEnvChange', env)" />
            </div>
          </div>
        </div>

        <div class="flex flex-wrap items-center gap-2">
          <NButton
            type="primary"
            size="large"
            data-open-workspace-primary
            :loading="props.loading"
            @click="emit('chooseWorkspace')"
          >
            <template #icon><NIcon :component="FolderOpenOutline" /></template>
            {{ t("app.welcome.openFolder") }}
          </NButton>
          <NButton
            size="medium"
            secondary
            data-open-workspace-local
            :loading="props.loading"
            @click="openEnv(LOCAL_WORKSPACE)"
          >
            <template #icon><NIcon :component="DesktopOutline" /></template>
            {{ t("app.welcome.openInLocal") }}
          </NButton>
          <NButton
            v-for="distro in distros"
            :key="`open-wsl-${distro.name}`"
            size="medium"
            secondary
            :data-open-workspace-wsl="distro.name"
            :loading="distrosLoading"
            @click="openEnv({ kind: 'wsl', distro: distro.name })"
          >
            <template #icon><NIcon :component="ServerOutline" /></template>
            {{ t("app.welcome.openInWsl", { distro: distro.name }) }}
          </NButton>
        </div>

        <div
          v-if="props.error"
          class="mt-5 flex max-w-xl items-start gap-2 rounded-md border border-destructive/25 bg-destructive/10 px-3 py-2 text-xs text-destructive"
        >
          <NIcon :component="AlertCircleOutline" :size="14" class="mt-0.5 shrink-0" />
          <span class="min-w-0 break-words">{{ props.error }}</span>
        </div>
      </div>

      <aside class="min-h-0 rounded-lg border border-border/70 bg-card">
        <div class="flex h-10 items-center gap-2 border-b border-border/60 px-3">
          <NIcon :component="TimeOutline" :size="15" class="text-muted-foreground" />
          <h2 class="text-xs font-semibold tracking-normal text-foreground/85">
            {{ t("app.welcome.recentWorkspaces") }}
          </h2>
        </div>
        <div v-if="props.loading" class="flex items-center gap-2 px-3 py-4 text-xs text-muted-foreground">
          <NSpin size="small" />
          <span>{{ t("app.welcome.opening") }}</span>
        </div>
        <div
          v-else-if="props.recentWorkspaces.length === 0"
          class="px-3 py-4 text-xs text-muted-foreground"
        >
          {{ t("app.welcome.noRecentWorkspaces") }}
        </div>
        <div v-else class="max-h-[420px] overflow-y-auto p-1">
          <button
            v-for="workspace in props.recentWorkspaces"
            :key="`${envLabel(workspace.env)}:${workspace.path}`"
            type="button"
            class="flex w-full min-w-0 items-center gap-2 rounded-md px-2 py-2 text-left transition-colors hover:bg-muted"
            :title="workspace.path"
            @click="emit('openRecent', workspace)"
          >
            <NIcon :component="FolderOpenOutline" :size="15" class="shrink-0 text-muted-foreground" />
            <span class="min-w-0 flex-1">
              <span class="block truncate text-xs font-medium text-foreground">
                {{ basename(workspace.path) }}
              </span>
              <span class="block truncate text-[11px] text-muted-foreground">
                {{ envLabel(workspace.env) }} · {{ workspace.path }}
              </span>
            </span>
          </button>
        </div>
      </aside>
    </div>
  </section>
</template>
