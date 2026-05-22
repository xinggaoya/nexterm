<script setup lang="ts">
import {
  AddOutline,
  CloseOutline,
  DuplicateOutline,
  FolderOpenOutline,
  GitCommitOutline,
  GitCompareOutline,
  GlobeOutline,
  LockClosedOutline,
  ReorderTwoOutline,
  SettingsOutline,
  TerminalOutline,
  TimeOutline,
} from "@vicons/ionicons5";
import { NButton, NIcon } from "naive-ui";
import type { Component } from "vue";
import WindowControls from "@/components/WindowControls.vue";
import { IS_MAC } from "@/lib/platform";
import { fileIconUrl } from "@/modules/explorer/lib/iconResolver";
import type { Tab } from "@/modules/tabs/tabsTypes";
import type { SplitDir } from "@/modules/terminal/lib/panes";

const props = withDefaults(
  defineProps<{
    tabs: Tab[];
    activeId: number;
    canSplit: boolean;
    workspaceReady?: boolean;
    showWindowControls?: boolean;
    leftPanelOpen?: boolean;
    rightPanelOpen?: boolean;
  }>(),
  {
    workspaceReady: true,
    showWindowControls: false,
    leftPanelOpen: false,
    rightPanelOpen: true,
  },
);

const emit = defineEmits<{
  selectTab: [id: number];
  closeTab: [id: number];
  pinTab: [id: number];
  newTab: [];
  newPrivateTab: [];
  splitPane: [dir: SplitDir];
  openSettings: [];
  toggleLeftPanel: [];
  toggleRightPanel: [];
}>();

type TabIcon =
  | { type: "component"; name: string; component: Component; class?: string }
  | { type: "image"; name: string; src: string };

function basename(path: string): string {
  const parts = path.split(/[\\/]/).filter(Boolean);
  return parts.length ? parts[parts.length - 1] : "/";
}

function tabKindLabel(tab: Tab): string {
  if (tab.kind === "terminal") return tab.private ? "Private terminal" : "Terminal";
  if (tab.kind === "git-history") return "Git history";
  if (tab.kind === "git-diff" || tab.kind === "git-commit-file") return "Git diff";
  if (tab.kind === "markdown") return "Markdown";
  if (tab.kind === "preview") return "Preview";
  return "Editor";
}

function tabLabel(tab: Tab): string {
  if (tab.kind === "terminal" && tab.terminalTitle) return tab.terminalTitle;
  if (tab.kind === "terminal" && tab.cwd) return basename(tab.cwd);
  return tab.title;
}

function tabIcon(tab: Tab): TabIcon {
  if (tab.kind === "terminal" && tab.private) {
    return {
      type: "component",
      name: "private-terminal",
      component: LockClosedOutline,
      class: "text-amber-500",
    };
  }
  if (tab.kind === "terminal") {
    return { type: "component", name: "terminal", component: TerminalOutline };
  }
  if (tab.kind === "editor") {
    return { type: "image", name: "editor", src: fileIconUrl(tab.title) };
  }
  if (tab.kind === "markdown") {
    return { type: "image", name: "markdown", src: fileIconUrl(tab.title) };
  }
  if (tab.kind === "preview") {
    return { type: "component", name: "preview", component: GlobeOutline };
  }
  if (tab.kind === "git-history") {
    return { type: "component", name: "git-history", component: TimeOutline };
  }
  return { type: "component", name: "git-diff", component: GitCompareOutline };
}

function pinPreviewTab(tab: Tab) {
  if (tab.kind === "editor" && tab.preview) emit("pinTab", tab.id);
}
</script>

<template>
  <header
    data-tauri-drag-region
    :class="[
      'flex h-11 shrink-0 items-center border-b border-border/60 bg-card',
      IS_MAC ? 'pr-2 pl-22' : 'pr-2 pl-2',
    ]"
  >
    <div class="flex shrink-0 items-center gap-0.5">
      <button
        type="button"
        :data-toggle-left-panel="leftPanelOpen"
        title="Source Control"
        aria-label="Toggle source control panel"
        :class="[
          'grid h-7 w-7 place-items-center rounded-md text-[12px] transition-colors',
          leftPanelOpen
            ? 'bg-accent text-foreground'
            : 'text-muted-foreground hover:bg-accent/70 hover:text-foreground',
        ]"
        @click="emit('toggleLeftPanel')"
      >
        <NIcon :component="GitCommitOutline" :size="15" />
      </button>
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
    </div>

    <div class="no-scrollbar ml-1 mr-1 min-w-0 flex-1 overflow-x-auto">
      <div
        data-tauri-drag-region
        class="flex items-center gap-0.5"
      >
        <button
          v-for="tab in props.tabs"
          :key="tab.id"
          type="button"
          :data-tab-id="tab.id"
          :title="`${tabKindLabel(tab)}: ${tabLabel(tab)}`"
          :class="[
            'group flex h-7 min-w-0 max-w-56 shrink-0 items-center justify-between gap-1.5 rounded-md px-2 text-left text-[12px] transition-colors',
            props.tabs.length === 1 ? 'pe-2' : 'pe-1',
            tab.id === props.activeId
              ? 'bg-accent text-foreground'
              : 'text-muted-foreground hover:bg-accent/70 hover:text-foreground',
          ]"
          @click="emit('selectTab', tab.id)"
          @dblclick="pinPreviewTab(tab)"
        >
          <span class="flex min-w-0 flex-1 items-center gap-1.5 truncate">
            <template v-for="icon in [tabIcon(tab)]" :key="icon.name">
              <img
                v-if="icon.type === 'image'"
                :src="icon.src"
                alt=""
                :data-tab-icon="icon.name"
                class="size-3.5 shrink-0"
              />
              <NIcon
                v-else
                :component="icon.component"
                :size="14"
                :data-tab-icon="icon.name"
                :class="['shrink-0', icon.class]"
              />
            </template>
            <span
              class="min-w-0 truncate"
              :class="tab.kind === 'editor' && tab.preview ? 'italic' : ''"
              :data-tab-label="tab.id"
            >
              {{ tabLabel(tab) }}
            </span>
            <span
              v-if="tab.kind === 'editor' && tab.dirty"
              :data-tab-dirty="tab.id"
              aria-label="Unsaved changes"
              class="size-1.5 shrink-0 rounded-full bg-foreground/70"
            />
          </span>
          <span
            v-if="props.tabs.length > 1"
            role="button"
            tabindex="-1"
            :data-close-tab-id="tab.id"
            class="grid size-4 shrink-0 place-items-center rounded-sm text-muted-foreground opacity-0 transition hover:bg-accent hover:text-foreground group-hover:opacity-70 group-hover:hover:opacity-100"
            title="Close tab"
            aria-label="Close tab"
            @click.stop="emit('closeTab', tab.id)"
            @keydown.enter.stop.prevent="emit('closeTab', tab.id)"
            @keydown.space.stop.prevent="emit('closeTab', tab.id)"
          >
            <NIcon :component="CloseOutline" :size="11" />
          </span>
        </button>
      </div>
    </div>

    <div
      data-header-actions
      class="flex shrink-0 items-center gap-0.5 border-l border-border/60 pl-2"
    >
      <NButton
        data-split-row
        size="tiny"
        quaternary
        :disabled="!props.workspaceReady || !canSplit"
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
        :disabled="!props.workspaceReady || !canSplit"
        title="Split down"
        aria-label="Split down"
        @click="emit('splitPane', 'col')"
      >
        <template #icon><NIcon :component="ReorderTwoOutline" /></template>
      </NButton>
      <div class="mx-0.5 h-4 w-px bg-border/60" />
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
      <button
        type="button"
        :data-toggle-right-panel="rightPanelOpen"
        title="Explorer"
        aria-label="Toggle file explorer panel"
        :class="[
          'grid h-6 w-6 shrink-0 place-items-center rounded-md transition-colors',
          rightPanelOpen
            ? 'bg-accent text-foreground'
            : 'text-muted-foreground hover:bg-accent/70 hover:text-foreground',
        ]"
        @click="emit('toggleRightPanel')"
      >
        <NIcon :component="FolderOpenOutline" :size="14" />
      </button>
      <WindowControls v-if="props.showWindowControls" />
    </div>
  </header>
</template>
