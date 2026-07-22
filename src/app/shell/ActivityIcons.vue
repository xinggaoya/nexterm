<script setup lang="ts">
import {
  AddOutline,
  GitBranchOutline,
  OpenOutline,
  ServerOutline,
} from "@vicons/ionicons5";
import { NIcon } from "naive-ui";
import { computed } from "vue";
import { t } from "@/modules/i18n/translate";
import type { ActivityKey } from "@/app/useWorkbenchLayout";

defineProps<{
  activity: ActivityKey;
}>();

const emit = defineEmits<{
  "select-activity": [key: ActivityKey];
  "add-workspace": [];
  "open-in-new-window": [];
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
    class="flex w-12 shrink-0 flex-col items-center gap-1 border-r border-border/30 bg-activity-bar py-2"
    aria-label="Activity icons"
  >
    <button
      type="button"
      data-add-workspace
      :title="t('app.leftSidebar.addWorkspace')"
      class="grid size-8 place-items-center rounded text-muted-foreground transition-colors hover:bg-accent/70 hover:text-foreground"
      @click="emit('add-workspace')"
    >
      <NIcon :component="AddOutline" :size="16" />
    </button>

    <button
      type="button"
      data-open-in-new-window
      :title="t('app.leftSidebar.openInNewWindow')"
      class="grid size-8 place-items-center rounded text-muted-foreground transition-colors hover:bg-accent/70 hover:text-foreground"
      @click="emit('open-in-new-window')"
    >
      <NIcon :component="OpenOutline" :size="15" />
    </button>

    <div class="my-1 h-px w-6 bg-border/50" />

    <button
      v-for="item in activities"
      :key="item.key"
      type="button"
      :data-activity="item.key"
      :aria-pressed="activity === item.key"
      :title="item.label"
      class="grid size-8 place-items-center rounded transition-colors"
      :class="
        activity === item.key
          ? 'bg-accent text-foreground'
          : 'text-muted-foreground hover:bg-accent/70 hover:text-foreground'
      "
      @click="emit('select-activity', item.key)"
    >
      <NIcon :component="item.icon" :size="16" />
    </button>
  </nav>
</template>