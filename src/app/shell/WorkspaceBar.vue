<script setup lang="ts">
import {
  CloseOutline,
  FolderOutline,
  LogoApple,
  OpenOutline,
} from "@vicons/ionicons5";
import { NIcon } from "naive-ui";
import { computed } from "vue";
import { useWorkspacesPiniaStore } from "@/modules/workspace/workspacesPinia";
import type { WorkspaceInstance } from "@/modules/workspace/workspacesPinia";
import type { WorkspaceEnv } from "@/modules/workspace/workspaceEnvSnapshot";
import { t } from "@/modules/i18n/translate";
import WorkspaceAddControl from "@/app/components/WorkspaceAddControl.vue";

withDefaults(
  defineProps<{
    embedded?: boolean;
  }>(),
  {
    embedded: false,
  },
);

const emit = defineEmits<{
  selectWorkspace: [id: string];
  closeWorkspace: [id: string];
  addWorkspace: [env: WorkspaceEnv];
  openInNewWindow: [];
}>();

const workspaces = useWorkspacesPiniaStore();

const list = computed(() => workspaces.workspaces);
const activeId = computed(() => workspaces.activeWorkspaceId);

function envBadge(ws: WorkspaceInstance): string {
  if (ws.env.kind === "wsl") {
    const name = ws.env.distro;
    return name.length > 6 ? name.slice(0, 4) : name;
  }
  return "";
}

function select(id: string): void {
  emit("selectWorkspace", id);
}

function close(event: MouseEvent, id: string): void {
  event.stopPropagation();
  emit("closeWorkspace", id);
}
</script>

<template>
  <div
    :class="
      embedded
        ? 'flex h-full min-h-0 flex-col gap-0.5 bg-sidebar p-1.5'
        : 'no-scrollbar flex h-full max-w-full items-center gap-0.5 overflow-x-auto px-1'
    "
    data-workspace-bar
    :data-embedded="embedded ? 'true' : 'false'"
  >
    <template v-if="!embedded">
      <button
        v-for="ws in list"
        :key="ws.id"
        type="button"
        class="group relative flex h-7 max-w-[220px] min-w-20 items-center gap-1.5 rounded-[6px] px-2.5 text-[12px] transition-colors duration-[var(--dur-fast)]"
        :class="
          ws.id === activeId
            ? 'bg-accent/70 text-foreground after:absolute after:inset-x-2 after:bottom-0 after:h-0.5 after:rounded-full after:bg-primary'
            : 'text-muted-foreground hover:bg-surface-hover hover:text-foreground'
        "
        :data-workspace-id="ws.id"
        :data-active="ws.id === activeId"
        :title="ws.rootPath"
        @click="select(ws.id)"
      >
        <span class="flex shrink-0 items-center gap-1">
          <NIcon
            v-if="ws.env.kind === 'wsl'"
            :component="LogoApple"
            :size="13"
            class="text-primary"
          />
          <NIcon v-else :component="FolderOutline" :size="13" />
        </span>
        <span class="truncate font-medium">{{ ws.name }}</span>
        <span
          v-if="envBadge(ws)"
          class="shrink-0 rounded-sm bg-primary/12 px-1 py-px text-[10px] leading-none text-primary"
        >
          {{ envBadge(ws) }}
        </span>
        <span
          class="ml-0.5 flex shrink-0 items-center rounded p-0.5 opacity-0 transition-opacity group-hover:opacity-100"
          :data-close-id="ws.id"
          @click="(e) => close(e, ws.id)"
        >
          <NIcon :component="CloseOutline" :size="12" />
        </span>
      </button>

      <WorkspaceAddControl
        @add-workspace="(env) => emit('addWorkspace', env)"
      />

      <button
        type="button"
        class="nexterm-icon-button size-7"
        :title="t('app.leftSidebar.openInNewWindow')"
        data-open-in-new-window
        @click="emit('openInNewWindow')"
      >
        <NIcon :component="OpenOutline" :size="14" />
      </button>
    </template>

    <template v-else>
      <button
        v-for="ws in list"
        :key="ws.id"
        type="button"
        class="nexterm-row group flex h-7 w-full min-w-0 items-center gap-2 px-2 text-left text-[12px]"
        :class="
          ws.id === activeId
            ? 'bg-accent text-foreground'
            : 'text-muted-foreground hover:text-foreground'
        "
        :data-workspace-id="ws.id"
        :data-active="ws.id === activeId"
        :title="ws.rootPath"
        @click="select(ws.id)"
      >
        <NIcon
          v-if="ws.env.kind === 'wsl'"
          :component="LogoApple"
          :size="13"
          class="shrink-0 text-primary"
        />
        <NIcon v-else :component="FolderOutline" :size="13" class="shrink-0" />
        <span class="min-w-0 flex-1 truncate">{{ ws.name }}</span>
        <span
          v-if="envBadge(ws)"
          class="shrink-0 rounded-sm bg-primary/12 px-1 py-px text-[10px] leading-none text-primary"
        >
          {{ envBadge(ws) }}
        </span>
        <span
          class="flex shrink-0 items-center rounded p-0.5 opacity-0 transition-opacity group-hover:opacity-100"
          :data-close-id="ws.id"
          @click="(e) => close(e, ws.id)"
        >
          <NIcon :component="CloseOutline" :size="12" />
        </span>
      </button>

      <div class="mt-1 flex flex-col gap-0.5 border-t border-border/40 pt-1">
        <WorkspaceAddControl
          embedded
          @add-workspace="(env) => emit('addWorkspace', env)"
        />
        <button
          type="button"
          class="nexterm-row flex h-7 items-center gap-2 px-2 text-[12px] text-muted-foreground hover:text-foreground"
          :title="t('app.leftSidebar.openInNewWindow')"
          data-open-in-new-window
          @click="emit('openInNewWindow')"
        >
          <NIcon :component="OpenOutline" :size="13" />
          <span class="truncate">{{ t("app.leftSidebar.openInNewWindow") }}</span>
        </button>
      </div>
    </template>
  </div>
</template>
