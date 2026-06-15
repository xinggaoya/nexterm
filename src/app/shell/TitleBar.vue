<script setup lang="ts">
import {
  CaretDownOutline,
  FileTrayOutline,
  FolderOpenOutline,
  GitCommitOutline,
  SearchOutline,
  SettingsOutline,
} from "@vicons/ionicons5";
import { getCurrentWindow } from "@tauri-apps/api/window";
import { NDropdown, NIcon } from "naive-ui";
import { computed, onMounted } from "vue";
import TooltipTitle from "@/components/TooltipTitle.vue";
import WindowControls from "@/components/WindowControls.vue";
import { IS_MAC, IS_WINDOWS } from "@/lib/platform";
import { hasTauriInternals } from "@/lib/tauriRuntime";
import { t } from "@/modules/i18n/translate";
import { LOCAL_WORKSPACE, type WorkspaceEnv } from "@/modules/workspace";
import { useWorkspaceEnvPiniaStore } from "@/modules/workspace/workspaceEnvPinia";

defineProps<{
  workspaceRoot: string | null;
  gitBranch: string | null;
  showWindowControls: boolean;
}>();

const emit = defineEmits<{
  openCommandPalette: [];
  openSettings: [];
  chooseWorkspace: [];
  chooseWorkspaceInEnv: [env: WorkspaceEnv];
  toggleExplorer: [];
  toggleSourceControl: [];
}>();

const workspaceEnv = useWorkspaceEnvPiniaStore();

onMounted(() => {
  if (IS_WINDOWS && hasTauriInternals()) void workspaceEnv.refreshDistros();
});

const openFolderOptions = computed(() => {
  const items: { label: string; key: string }[] = [
    { label: t("app.header.openFolderMenu.openInLocal"), key: "local" },
  ];
  if (IS_WINDOWS && Array.isArray(workspaceEnv.distros)) {
    for (const d of workspaceEnv.distros) {
      items.push({
        label: t("app.header.openFolderMenu.openInWsl", { distro: d.name }),
        key: `wsl:${d.name}`,
      });
    }
  }
  return items;
});

function handleOpenFolderSelect(key: string) {
  if (key === "local") {
    emit("chooseWorkspaceInEnv", LOCAL_WORKSPACE);
  } else if (key.startsWith("wsl:")) {
    emit("chooseWorkspaceInEnv", { kind: "wsl", distro: key.slice(4) });
  }
}

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
    <!-- Left: open folder button group -->
    <div class="flex shrink-0 items-center gap-0.5 pl-2">
      <TooltipTitle :label="t('app.header.openFolder')">
        <button
          type="button"
          data-open-workspace
          class="grid h-6 w-6 place-items-center rounded-md text-muted-foreground transition-colors hover:bg-accent hover:text-foreground"
          @click.stop="emit('chooseWorkspace')"
        >
          <NIcon :component="FolderOpenOutline" :size="14" />
        </button>
      </TooltipTitle>
      <NDropdown
        :options="openFolderOptions"
        trigger="click"
        placement="bottom-start"
        @select="handleOpenFolderSelect"
      >
        <button
          type="button"
          class="grid h-6 w-6 place-items-center rounded-md text-muted-foreground transition-colors hover:bg-accent hover:text-foreground"
        >
          <NIcon :component="CaretDownOutline" :size="10" />
        </button>
      </NDropdown>
    </div>

    <!-- Center: workspace name + drag area -->
    <div
      class="flex min-w-0 flex-1 items-center justify-center gap-2"
      data-window-drag-region
      @pointerdown="startWindowDrag"
    >
      <button
        v-if="workspaceRoot"
        type="button"
        class="flex items-center gap-1.5 rounded-md px-2 py-0.5 text-[12px] text-muted-foreground transition-colors hover:bg-accent/50 hover:text-foreground"
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

    <!-- Right: explorer, git, command center, settings, window controls -->
    <div class="flex shrink-0 items-center gap-0.5 pr-2">
      <TooltipTitle :label="t('common.explorer')">
        <button
          type="button"
          class="grid h-6 w-6 place-items-center rounded-md text-muted-foreground transition-colors hover:bg-accent hover:text-foreground"
          @click="emit('toggleExplorer')"
        >
          <NIcon :component="FileTrayOutline" :size="14" />
        </button>
      </TooltipTitle>
      <TooltipTitle :label="t('app.header.sourceControl')">
        <button
          type="button"
          class="grid h-6 w-6 place-items-center rounded-md text-muted-foreground transition-colors hover:bg-accent hover:text-foreground"
          @click="emit('toggleSourceControl')"
        >
          <NIcon :component="GitCommitOutline" :size="14" />
        </button>
      </TooltipTitle>
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
      <WindowControls v-if="showWindowControls && !IS_MAC" />
    </div>
  </header>
</template>
