<script setup lang="ts">
import {
  AddOutline,
  ChevronBackOutline,
  GitBranchOutline,
  OpenOutline,
  ServerOutline,
} from "@vicons/ionicons5";
import { NIcon } from "naive-ui";
import { computed } from "vue";
import NextermIconButton from "@/components/NextermIconButton.vue";
import { t } from "@/modules/i18n/translate";
import type { ActivityKey } from "@/app/useWorkbenchLayout";
import {
  LOCAL_WORKSPACE,
  type WorkspaceEnv,
} from "@/modules/workspace/workspaceEnvSnapshot";

defineProps<{
  activity: ActivityKey;
}>();

const emit = defineEmits<{
  "select-activity": [key: ActivityKey];
  "add-workspace": [env: WorkspaceEnv];
  "open-in-new-window": [];
  "toggle-left-sidebar": [];
}>();

const activities = computed(() => [
  {
    key: "sourceControl" as ActivityKey,
    icon: GitBranchOutline,
    label: t("app.leftSidebar.activity.sourceControl"),
  },
  {
    key: "workspace" as ActivityKey,
    icon: ServerOutline,
    label: t("app.leftSidebar.activity.workspace"),
  },
]);
</script>

<template>
  <nav
    class="flex w-11 shrink-0 flex-col items-center gap-1 border-r border-border bg-activity-bar py-1.5"
    aria-label="Activity icons"
  >
    <NextermIconButton
      data-add-workspace
      :title="t('app.leftSidebar.addWorkspace')"
      @click="emit('add-workspace', LOCAL_WORKSPACE)"
    >
      <NIcon :component="AddOutline" :size="16" />
    </NextermIconButton>

    <NextermIconButton
      data-open-in-new-window
      :title="t('app.leftSidebar.openInNewWindow')"
      @click="emit('open-in-new-window')"
    >
      <NIcon :component="OpenOutline" :size="15" />
    </NextermIconButton>

    <div class="v2-hairline my-1 h-px w-6 border-t" />

    <button
      v-for="item in activities"
      :key="item.key"
      type="button"
      :data-activity="item.key"
      :aria-pressed="activity === item.key"
      :title="item.label"
      class="relative grid size-8 place-items-center rounded-[6px] transition-colors duration-[var(--dur-fast)] before:absolute before:inset-y-1.5 before:left-[-6px] before:w-0.5 before:rounded-full"
      :class="
        activity === item.key
          ? 'bg-accent text-primary before:bg-primary'
          : 'text-muted-foreground before:bg-transparent hover:bg-surface-hover hover:text-foreground'
      "
      @click="emit('select-activity', item.key)"
    >
      <NIcon :component="item.icon" :size="16" />
    </button>

    <div class="v2-hairline my-1 h-px w-6 border-t" />

    <NextermIconButton
      data-toggle-left-sidebar
      :title="t('app.leftSidebar.toggle')"
      data-testid="toggle-left-sidebar"
      @click="emit('toggle-left-sidebar')"
    >
      <NIcon :component="ChevronBackOutline" :size="15" />
    </NextermIconButton>
  </nav>
</template>
