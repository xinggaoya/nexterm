<script setup lang="ts">
import {
  AddOutline,
  CloseOutline,
  DuplicateOutline,
  GitBranchOutline,
  LockClosedOutline,
  SettingsOutline,
  TerminalOutline,
} from "@vicons/ionicons5";
import { NButton, NIcon } from "naive-ui";
import WindowControls from "@/components/WindowControls.vue";
import { IS_MAC } from "@/lib/platform";
import type { Tab } from "@/modules/tabs/tabsTypes";
import type { SplitDir } from "@/modules/terminal/lib/panes";

const props = withDefaults(
  defineProps<{
    tabs: Tab[];
    activeId: number;
    canSplit: boolean;
    showWindowControls?: boolean;
  }>(),
  {
    showWindowControls: false,
  },
);

const emit = defineEmits<{
  selectTab: [id: number];
  closeTab: [id: number];
  newTab: [];
  newPrivateTab: [];
  splitPane: [dir: SplitDir];
  closeActiveTab: [];
  openSettings: [];
}>();

function tabKindLabel(tab: Tab): string {
  if (tab.kind === "terminal") return tab.private ? "Private terminal" : "Terminal";
  if (tab.kind === "git-history") return "Git history";
  if (tab.kind === "git-diff" || tab.kind === "git-commit-file") return "Git diff";
  if (tab.kind === "ai-diff") return "AI diff";
  if (tab.kind === "markdown") return "Markdown";
  if (tab.kind === "preview") return "Preview";
  return "Editor";
}
</script>

<template>
  <header
    data-tauri-drag-region
    :class="[
      'flex h-11 shrink-0 items-center gap-2 border-b border-border/60 bg-card/80 backdrop-blur',
      IS_MAC ? 'pr-2 pl-22' : 'pr-0 pl-3',
    ]"
  >
    <div
      data-tauri-drag-region
      class="flex h-full shrink-0 items-center gap-2 px-1 text-[12px] font-semibold tracking-normal"
    >
      <NIcon :component="TerminalOutline" :size="15" />
      <span>Nexterm</span>
    </div>

    <div class="flex shrink-0 items-center gap-0.5">
      <NButton
        data-new-tab
        size="tiny"
        quaternary
        title="New terminal"
        aria-label="New terminal"
        @click="emit('newTab')"
      >
        <template #icon><NIcon :component="AddOutline" /></template>
      </NButton>
      <NButton
        data-new-private-tab
        size="tiny"
        quaternary
        title="New private terminal"
        aria-label="New private terminal"
        @click="emit('newPrivateTab')"
      >
        <template #icon><NIcon :component="LockClosedOutline" /></template>
      </NButton>
      <NButton
        data-split-row
        size="tiny"
        quaternary
        :disabled="!canSplit"
        title="Split right"
        aria-label="Split right"
        @click="emit('splitPane', 'row')"
      >
        <template #icon><NIcon :component="DuplicateOutline" /></template>
      </NButton>
      <NButton
        data-split-col
        size="tiny"
        quaternary
        :disabled="!canSplit"
        title="Split down"
        aria-label="Split down"
        @click="emit('splitPane', 'col')"
      >
        <template #icon><NIcon :component="GitBranchOutline" /></template>
      </NButton>
    </div>

    <div
      data-tauri-drag-region
      class="flex min-w-0 flex-1 items-center gap-1 overflow-hidden"
    >
      <button
        v-for="tab in props.tabs"
        :key="tab.id"
        type="button"
        :data-tab-id="tab.id"
        :title="`${tabKindLabel(tab)}: ${tab.title}`"
        :class="[
          'group flex h-7 min-w-0 max-w-44 items-center gap-1.5 rounded-md border px-2 text-left text-[11.5px] transition-colors',
          tab.id === props.activeId
            ? 'border-border bg-background text-foreground shadow-sm'
            : 'border-transparent text-muted-foreground hover:bg-muted/75 hover:text-foreground',
        ]"
        @click="emit('selectTab', tab.id)"
      >
        <NIcon
          v-if="tab.kind === 'terminal' && tab.private"
          :component="LockClosedOutline"
          :size="12"
          class="shrink-0 text-amber-500"
        />
        <span class="min-w-0 flex-1 truncate">{{ tab.title }}</span>
        <button
          v-if="props.tabs.length > 1"
          type="button"
          :data-close-tab-id="tab.id"
          class="grid size-4 shrink-0 place-items-center rounded-sm text-muted-foreground opacity-0 transition hover:bg-muted hover:text-foreground group-hover:opacity-100"
          title="Close tab"
          aria-label="Close tab"
          @click.stop="emit('closeTab', tab.id)"
        >
          <NIcon :component="CloseOutline" :size="11" />
        </button>
      </button>
    </div>

    <div class="flex shrink-0 items-center gap-0.5">
      <NButton
        data-close-active-tab
        size="tiny"
        quaternary
        :disabled="props.tabs.length <= 1"
        title="Close active tab"
        aria-label="Close active tab"
        @click="emit('closeActiveTab')"
      >
        <template #icon><NIcon :component="CloseOutline" /></template>
      </NButton>
      <NButton
        data-open-settings
        size="tiny"
        quaternary
        title="Settings"
        aria-label="Settings"
        @click="emit('openSettings')"
      >
        <template #icon><NIcon :component="SettingsOutline" /></template>
      </NButton>
      <WindowControls v-if="props.showWindowControls" />
    </div>
  </header>
</template>
