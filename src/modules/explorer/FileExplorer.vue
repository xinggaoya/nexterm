<script setup lang="ts">
import {
  ChevronForwardOutline,
  DocumentOutline,
  FolderOpenOutline,
  FolderOutline,
  RefreshOutline,
} from "@vicons/ionicons5";
import { NButton, NIcon, NSpin } from "naive-ui";
import { computed, ref, watch } from "vue";
import { usePreferencesPiniaStore } from "@/modules/settings/preferencesPinia";
import {
  buildFileTreeRows,
  type FileTreeRow,
  type FileTreeState,
} from "./lib/fileTreeRows";
import { readFileTreeDir } from "./lib/fileTreeService";

const props = defineProps<{
  rootPath: string | null;
}>();

const emit = defineEmits<{
  openFile: [path: string, pin: boolean];
}>();

const prefs = usePreferencesPiniaStore();
const nodes = ref<FileTreeState>({});
const expanded = ref<Set<string>>(new Set());
const pendingCreate = ref(null);
const renaming = ref<string | null>(null);

const rootName = computed(() => {
  if (!props.rootPath) return "";
  const parts = props.rootPath.split(/[\\/]/).filter(Boolean);
  return parts.length > 0 ? parts[parts.length - 1] : props.rootPath;
});

const rootState = computed(() =>
  props.rootPath ? nodes.value[props.rootPath] : undefined,
);

const rows = computed(() => {
  if (!props.rootPath) return [] as FileTreeRow[];
  return buildFileTreeRows({
    rootPath: props.rootPath,
    nodes: nodes.value,
    expanded: expanded.value,
    pendingCreate: pendingCreate.value,
    renaming: renaming.value,
  }).rows;
});

async function loadChildren(path: string) {
  nodes.value = { ...nodes.value, [path]: { status: "loading" } };
  try {
    const entries = await readFileTreeDir(path, prefs.showHidden);
    nodes.value = { ...nodes.value, [path]: { status: "loaded", entries } };
  } catch (error) {
    nodes.value = {
      ...nodes.value,
      [path]: { status: "error", message: String(error) },
    };
  }
}

function refreshRoot() {
  if (props.rootPath) void loadChildren(props.rootPath);
}

function toggleDir(path: string) {
  const next = new Set(expanded.value);
  const isOpen = next.has(path);
  if (isOpen) next.delete(path);
  else next.add(path);
  expanded.value = next;
  if (!isOpen && (!nodes.value[path] || nodes.value[path].status === "error")) {
    void loadChildren(path);
  }
}

function handleRowClick(row: FileTreeRow) {
  if (row.kind !== "entry") return;
  if (row.isDir) {
    toggleDir(row.path);
    return;
  }
  emit("openFile", row.path, false);
}

function iconForRow(row: FileTreeRow) {
  if (row.kind === "pending" || row.kind === "status") return DocumentOutline;
  if (row.isDir) return row.kind === "entry" && row.isExpanded ? FolderOpenOutline : FolderOutline;
  return DocumentOutline;
}

watch(
  () => props.rootPath,
  (rootPath) => {
    nodes.value = {};
    expanded.value = new Set();
    pendingCreate.value = null;
    renaming.value = null;
    if (rootPath) void loadChildren(rootPath);
  },
  { immediate: true },
);
</script>

<template>
  <aside class="flex h-full min-h-0 flex-col bg-card/55 text-foreground">
    <div
      class="flex h-9 shrink-0 items-center gap-1 border-b border-border/60 px-2"
      data-explorer-header
    >
      <div class="flex min-w-0 flex-1 items-center gap-1.5">
        <NIcon :component="FolderOutline" :size="14" class="shrink-0 text-muted-foreground" />
        <span class="truncate text-[12px] font-semibold">{{ rootName || "Explorer" }}</span>
      </div>
      <NButton
        size="tiny"
        quaternary
        title="Refresh"
        aria-label="Refresh"
        @click="refreshRoot"
      >
        <template #icon><NIcon :component="RefreshOutline" /></template>
      </NButton>
    </div>

    <div v-if="!rootPath" class="grid min-h-0 flex-1 place-items-center p-4 text-center">
      <div class="text-[12px] text-muted-foreground">No current directory</div>
    </div>

    <div v-else class="min-h-0 flex-1 overflow-y-auto py-1">
      <div
        v-if="rootState?.status === 'loading'"
        class="flex items-center gap-2 px-3 py-2 text-[11px] text-muted-foreground"
      >
        <NSpin size="small" />
        <span>Loading...</span>
      </div>
      <div
        v-else-if="rootState?.status === 'error'"
        class="px-3 py-2 text-[11px] text-destructive"
      >
        {{ rootState.message }}
      </div>
      <div v-else-if="rootState?.status === 'loaded'" class="space-y-0.5">
        <button
          v-for="row in rows"
          :key="row.key"
          type="button"
          :data-explorer-row-path="row.kind === 'entry' || row.kind === 'rename' ? row.path : undefined"
          :class="[
            'flex h-6 w-full min-w-0 items-center gap-1 rounded-none px-1.5 text-left text-[12px] transition-colors hover:bg-muted/80',
            row.kind === 'status' && row.tone === 'error'
              ? 'text-destructive'
              : 'text-foreground',
          ]"
          :style="{ paddingLeft: `${6 + row.depth * 14}px` }"
          @click="handleRowClick(row)"
        >
          <NIcon
            v-if="row.kind === 'entry' && row.isDir"
            :component="ChevronForwardOutline"
            :size="11"
            :class="['shrink-0 transition-transform', row.isExpanded ? 'rotate-90' : '']"
          />
          <span v-else class="w-[11px] shrink-0" />
          <NIcon
            :component="iconForRow(row)"
            :size="14"
            class="shrink-0 text-muted-foreground"
          />
          <span class="min-w-0 flex-1 truncate">
            <template v-if="row.kind === 'entry' || row.kind === 'rename'">
              {{ row.name }}
            </template>
            <template v-else-if="row.kind === 'pending'">
              {{ row.pendingKind === "dir" ? "New folder" : "New file" }}
            </template>
            <template v-else>{{ row.message }}</template>
          </span>
        </button>
      </div>
    </div>
  </aside>
</template>
