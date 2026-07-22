<script setup lang="ts">
import { ChevronForwardOutline } from "@vicons/ionicons5";
import { NIcon } from "naive-ui";
import { computed } from "vue";
import { t } from "@/modules/i18n/translate";
import type { SourceControlStatusKind } from "@/modules/source-control";
import InlineTreeInput from "./InlineTreeInput.vue";
import { fileIconUrl, folderIconUrl } from "./lib/iconResolver";
import type { FileTreeRow } from "./lib/fileTreeRows";

type EntryRow = Extract<FileTreeRow, { kind: "entry" }>;
type MenuRow = Extract<FileTreeRow, { kind: "entry" | "rename" }>;

const props = defineProps<{
  row: FileTreeRow;
  selected: boolean;
}>();

const emit = defineEmits<{
  entryClick: [row: EntryRow];
  beginRename: [path: string];
  commitRename: [value: string];
  cancelRename: [];
  commitCreate: [value: string];
  cancelCreate: [];
  rowContext: [
    payload: {
      row: MenuRow;
      x: number;
      y: number;
    },
  ];
}>();

const paddingLeft = computed(() => `${6 + props.row.depth * 12}px`);
const statusPaddingLeft = computed(() => `${24 + props.row.depth * 12}px`);
const decoration = computed(() =>
  props.row.kind === "entry" || props.row.kind === "rename"
    ? props.row.gitDecoration
    : undefined,
);
const decorationClass = computed(() =>
  decoration.value ? statusTextClass(decoration.value.statusKind) : "",
);
const decorationDotClass = computed(() =>
  decoration.value ? statusDotClass(decoration.value.statusKind) : "",
);

const iconUrl = computed(() => {
  const row = props.row;
  if (row.kind === "pending") {
    return row.pendingKind === "dir"
      ? folderIconUrl("", false)
      : fileIconUrl("untitled");
  }
  if (row.kind === "status") return "";
  if (row.isDir) {
    return folderIconUrl(row.name, row.kind === "entry" && row.isExpanded);
  }
  return fileIconUrl(row.name);
});

function handleEntryClick() {
  if (props.row.kind === "entry") emit("entryClick", props.row);
}

function handleDoubleClick() {
  const row = props.row;
  if (row.kind === "entry" && !row.isDir) emit("beginRename", row.path);
}

function handleContextMenu(event: MouseEvent) {
  const row = props.row;
  if (row.kind !== "entry" && row.kind !== "rename") return;
  emit("rowContext", { row, x: event.clientX, y: event.clientY });
}

function statusTextClass(statusKind: SourceControlStatusKind): string {
  switch (statusKind) {
    case "added":
    case "untracked":
      return "text-success";
    case "deleted":
    case "conflict":
      return "text-destructive";
    case "renamed":
      return "text-info";
    default:
      return "text-warning";
  }
}

function statusDotClass(statusKind: SourceControlStatusKind): string {
  switch (statusKind) {
    case "added":
    case "untracked":
      return "bg-success";
    case "deleted":
    case "conflict":
      return "bg-destructive";
    case "renamed":
      return "bg-info";
    default:
      return "bg-warning";
  }
}
</script>

<template>
  <div
    v-if="row.kind === 'rename'"
    class="flex h-6 w-full min-w-0 items-center gap-2 px-1.5 text-[13px]"
    :style="{ paddingLeft }"
    @contextmenu.stop.prevent="handleContextMenu"
  >
    <span class="size-3.5 shrink-0" />
    <img :src="iconUrl" alt="" class="size-4 shrink-0" />
    <InlineTreeInput
      :initial="row.name"
      @commit="(value) => emit('commitRename', value)"
      @cancel="emit('cancelRename')"
    />
  </div>

  <button
    v-else-if="row.kind === 'entry'"
    type="button"
    :data-explorer-row-path="row.path"
    :class="[
      'group flex h-6 w-full min-w-0 cursor-pointer items-center gap-2 rounded-sm px-1.5 text-left text-[13px] transition-colors hover:bg-accent/70',
      selected ? 'bg-accent text-foreground' : 'text-foreground/85',
    ]"
    :style="{ paddingLeft }"
    @click="handleEntryClick"
    @dblclick.stop.prevent="handleDoubleClick"
    @contextmenu.stop.prevent="handleContextMenu"
  >
    <span class="flex size-3.5 shrink-0 items-center justify-center text-muted-foreground">
      <NIcon
        v-if="row.isDir"
        :component="ChevronForwardOutline"
        :size="12"
        :class="['transition-transform', row.isExpanded ? 'rotate-90' : '']"
      />
    </span>
    <img
      :src="iconUrl"
      alt=""
      data-explorer-entry-icon
      class="size-4 shrink-0"
    />
    <span :class="['min-w-0 flex-1 truncate', decorationClass]">{{ row.name }}</span>
    <span
      v-if="decoration"
      :class="[
        'size-1.5 shrink-0 rounded-full',
        decorationDotClass,
        decoration.hasDescendantChanges ? 'opacity-70' : 'opacity-100',
      ]"
      data-explorer-git-decoration
    />
  </button>

  <div
    v-else-if="row.kind === 'pending'"
    class="flex h-6 w-full min-w-0 items-center gap-2 px-1.5 text-[13px]"
    :style="{ paddingLeft }"
  >
    <span class="size-3.5 shrink-0" />
    <img :src="iconUrl" alt="" class="size-4 shrink-0 opacity-70" />
    <InlineTreeInput
      initial=""
      :placeholder="row.pendingKind === 'dir' ? t('explorer.newFolder') : t('explorer.newFile')"
      @commit="(value) => emit('commitCreate', value)"
      @cancel="emit('cancelCreate')"
    />
  </div>

  <div
    v-else
    :class="[
      'h-6 truncate px-2 text-[11px] leading-6',
      row.tone === 'error' ? 'text-destructive' : 'text-muted-foreground',
    ]"
    :style="{ paddingLeft: statusPaddingLeft }"
  >
    {{ row.message }}
  </div>
</template>
