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
  /** 正在被拖动（源）行：降低不透明度让用户知道拖的是哪几行。 */
  dragging?: boolean;
  /** 已剪切、等待粘贴的行：变淡（VS Code 行为）。 */
  cut?: boolean;
  /** 悬停中的落点行（仅目录行有意义）。 */
  dropTarget?: boolean;
  /** 落点非法：整行变禁用色，松手也不执行。 */
  dropForbidden?: boolean;
  /**
   * 同级插入线的位置：拖到行的上/下缘时出现一条横线，而不是高亮整行
   * （后者语义是"放进这个目录"）。null 表示不画插入线。
   */
  dropLine?: "before" | "after" | null;
}>();

const emit = defineEmits<{
  // 透传原始事件，父级据 ctrl/meta/shift 决定是切换多选、范围选还是单选打开。
  entryClick: [row: EntryRow, event: MouseEvent];
  entryPointerDown: [row: EntryRow, event: PointerEvent];
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

function handleEntryClick(event: MouseEvent) {
  if (props.row.kind === "entry") emit("entryClick", props.row, event);
}

// 拖拽手势由父级统一接管（`usePointerDragReorder`）：行只负责把原始
// 事件透传上去，这样阈值判定 / ghost / click 抑制只有一处实现。
function handleEntryPointerDown(event: PointerEvent) {
  if (props.row.kind === "entry") emit("entryPointerDown", props.row, event);
}

/** 行级拖拽视觉：源行变淡，落点行高亮并加左侧竖条，非法落点转警示色。 */
function dragClass(): string {
  if (props.dropForbidden) {
    return "bg-destructive/10 text-destructive/80 ring-1 ring-inset ring-destructive/50";
  }
  // 有插入线时不高亮整行：两者语义不同（"放到这一行前面" vs "进这个目录"）
  if (props.dropTarget && !props.dropLine) {
    return "bg-accent text-foreground before:absolute before:inset-y-0 before:left-0 before:w-0.5 before:rounded-full before:bg-primary";
  }
  if (props.dropLine) {
    // 缩进跟随行层级：插入线的左边界与该行图标对齐，视觉上表达"会落在哪一层"
    return props.dropLine === "before"
      ? "before:absolute before:inset-x-1 before:-top-px before:h-0.5 before:rounded-full before:bg-primary"
      : "after:absolute after:inset-x-1 after:-bottom-px after:h-0.5 after:rounded-full after:bg-primary";
  }
  if (props.dragging) return "opacity-50";
  if (props.cut) return "opacity-45";
  return "";
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
    :data-is-dir="row.isDir ? 'true' : undefined"
    :data-depth="row.depth"
    :class="[
      'group relative flex h-6 w-full min-w-0 cursor-pointer items-center gap-2 rounded-sm px-1.5 text-left text-[13px] transition-colors hover:bg-accent/70',
      selected ? 'bg-accent text-foreground' : 'text-foreground/85',
      dragClass(),
    ]"
    :style="{ paddingLeft }"
    :aria-grabbed="dragging === true"
    @click="handleEntryClick"
    @dblclick.stop.prevent="handleDoubleClick"
    @contextmenu.stop.prevent="handleContextMenu"
    @pointerdown="handleEntryPointerDown"
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
