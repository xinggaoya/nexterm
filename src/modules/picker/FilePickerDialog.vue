<script setup lang="ts">
import {
  ArrowUpOutline,
  CreateOutline,
  EyeOffOutline,
  EyeOutline,
  FolderOpenOutline,
  RefreshOutline,
  SearchOutline,
} from "@vicons/ionicons5";
import {
  NButton,
  NIcon,
  NInput,
  NModal,
  NSpin,
  NTag,
  NVirtualList,
} from "naive-ui";
import { computed, nextTick, onBeforeUnmount, onMounted, ref, watch } from "vue";
import { createNativeForEnv, native, type FsDirEntry } from "@/lib/native";
import { t } from "@/modules/i18n/translate";
import { fileIconUrl, folderIconUrl } from "@/modules/explorer/lib/iconResolver";
import { normalizeWorkspacePath } from "@/modules/workspace/workspacePath";
import {
  filterPickerEntries,
  formatPickerSize,
  joinPickerPath,
  parentPickerPath,
  pickerEntryNavigable,
  resolvePickerConfirm,
  sortPickerEntries,
  splitPickerPath,
} from "./pickerService";
import type { FilePickerOptions, PickerPlace } from "./pickerTypes";

/**
 * 环境感知的文件 / 文件夹选择对话框。
 *
 * 与系统对话框不同，这里通过 createNativeForEnv(options.workspace) 列目录，
 * 浏览范围被限制在目标环境自己的文件系统里：WSL env 显示发行版内的 Linux
 * 路径，本机 env 显示 Windows 路径 —— 从根上避免“在 WSL 工作区里选出
 * Windows 路径”的歧义。
 */
const props = defineProps<{
  options: FilePickerOptions;
}>();

const emit = defineEmits<{
  confirm: [path: string];
  cancel: [];
}>();

const wsNative = createNativeForEnv(props.options.workspace);

/** 单行高度（像素），虚拟列表按此估算视口可容纳的行数。 */
const ROW_HEIGHT = 30;
/** 大目录分块注入大小：每块之间让出主线程，保证首屏与输入不被阻塞。 */
const PICKER_LOAD_CHUNK = 1000;
/** 过滤输入防抖：大目录下逐键过滤会放大重算成本。 */
const FILTER_DEBOUNCE_MS = 120;

const currentPath = ref("");
const entries = ref<FsDirEntry[]>([]);
const loading = ref(false);
const populating = ref(false);
const loadError = ref<string | null>(null);
const selectedName = ref<string | null>(null);
const filterQuery = ref("");
const filterText = ref("");
let filterTimer: ReturnType<typeof setTimeout> | null = null;
const showHidden = ref(false);
const editingPath = ref(false);
const editPathValue = ref("");
const pathInputRef = ref<InstanceType<typeof NInput> | null>(null);
const creatingFolder = ref(false);
const newFolderName = ref("");
const createError = ref<string | null>(null);
const nameInput = ref(props.options.fileName ?? "");
const homePath = ref<string | null>(null);
/** 本机模式的文件系统根（Windows 盘符），作为快捷位置。 */
const driveRoots = ref<string[]>([]);
// 丢弃过期响应：快速连续导航时，慢的旧请求不能覆盖新目录。
let requestSeq = 0;

const mode = computed(() => props.options.mode);

const dialogTitle = computed(
  () =>
    props.options.title ??
    (mode.value === "directory"
      ? t("picker.titleDirectory")
      : t("picker.titleFile")),
);

const envLabel = computed(() => {
  const env = props.options.workspace;
  if (env.kind === "wsl") return t("picker.envWsl", { distro: env.distro });
  if (env.kind === "ssh") return t("common.ssh");
  return t("picker.envLocal");
});

const crumbs = computed(() => splitPickerPath(currentPath.value, props.options.workspace));

const canGoUp = computed(
  () => parentPickerPath(currentPath.value, props.options.workspace) !== null,
);

const places = computed<PickerPlace[]>(() => {
  const list: PickerPlace[] = [];
  if (props.options.workspace.kind === "wsl") {
    list.push({ key: "picker-root", label: t("picker.placesRoot"), path: "/" });
  }
  if (homePath.value) {
    list.push({ key: "picker-home", label: t("picker.placesHome"), path: homePath.value });
  }
  for (const root of driveRoots.value) {
    // "C:/" → "C:"；根路径（POSIX "/"）不重复展示。
    if (root !== "/") {
      list.push({ key: `picker-drive:${root}`, label: root.replace(/\/$/, ""), path: root });
    }
  }
  return [...list, ...(props.options.places ?? [])];
});

/**
 * 虚拟列表条目：只渲染视口内的行，几万条目录项也不卡顿。
 * key 取条目名（同目录内唯一），供 vueuc 虚拟列表做 keyField。
 */
const virtualItems = computed(() =>
  filterPickerEntries(entries.value, filterText.value).map((entry) => ({
    key: entry.name,
    entry,
  })),
);

const selectedEntry = computed(
  () => entries.value.find((entry) => entry.name === selectedName.value) ?? null,
);

const confirmTarget = computed(() =>
  resolvePickerConfirm(
    mode.value,
    currentPath.value,
    selectedEntry.value,
    mode.value === "file" ? nameInput.value : "",
  ),
);

const confirmDisabled = computed(() => !confirmTarget.value.ok);

const confirmLabel = computed(() =>
  mode.value === "directory" ? t("picker.confirmDirectory") : t("picker.confirmFile"),
);

const confirmHint = computed(() =>
  confirmTarget.value.ok ? confirmTarget.value.path : t("picker.noSelection"),
);

async function navigate(rawPath: string): Promise<void> {
  const path = normalizeWorkspacePath(rawPath);
  if (!path) return;
  const seq = ++requestSeq;
  loading.value = true;
  loadError.value = null;
  createError.value = null;
  try {
    const list = await wsNative.fsReadDir(path, showHidden.value);
    if (seq !== requestSeq) return;
    currentPath.value = path;
    selectedName.value = null;
    filterQuery.value = "";
    filterText.value = "";
    editingPath.value = false;
    creatingFolder.value = false;
    loading.value = false;
    // 大目录懒加载：排序一次后分块注入响应式数组，块间让出主线程，
    // 首屏立即渲染可交互，不再一次性 splice 几万条数据卡死 UI。
    const sorted = sortPickerEntries(list);
    entries.value = [];
    populating.value = sorted.length > PICKER_LOAD_CHUNK;
    for (let offset = 0; offset < sorted.length; offset += PICKER_LOAD_CHUNK) {
      if (seq !== requestSeq) return;
      entries.value = entries.value.concat(
        sorted.slice(offset, offset + PICKER_LOAD_CHUNK),
      );
      if (offset + PICKER_LOAD_CHUNK < sorted.length) await nextTick();
    }
  } catch (error) {
    if (seq !== requestSeq) return;
    entries.value = [];
    loadError.value = error instanceof Error ? error.message : String(error);
  } finally {
    if (seq === requestSeq) {
      loading.value = false;
      populating.value = false;
    }
  }
}

function up(): void {
  const parent = parentPickerPath(currentPath.value, props.options.workspace);
  if (parent) void navigate(parent);
}

function refresh(): void {
  if (currentPath.value) void navigate(currentPath.value);
}

function selectEntry(entry: FsDirEntry): void {
  selectedName.value = entry.name;
  if (mode.value === "file") {
    nameInput.value = entry.kind === "dir" ? "" : entry.name;
  }
}

function activateEntry(entry: FsDirEntry): void {
  if (pickerEntryNavigable(entry)) {
    void navigate(joinPickerPath(currentPath.value, entry.name));
    return;
  }
  if (mode.value === "file") confirm();
}

function onListKeydown(event: KeyboardEvent): void {
  if (virtualItems.value.length === 0) return;
  const index = virtualItems.value.findIndex(
    (item) => item.key === selectedName.value,
  );
  if (event.key === "ArrowDown" || event.key === "ArrowUp") {
    event.preventDefault();
    const delta = event.key === "ArrowDown" ? 1 : -1;
    const next =
      index === -1
        ? 0
        : Math.min(Math.max(index + delta, 0), virtualItems.value.length - 1);
    const item = virtualItems.value[next];
    if (item) selectEntry(item.entry);
    return;
  }
  if (event.key === "Enter") {
    event.preventDefault();
    if (selectedEntry.value) activateEntry(selectedEntry.value);
    else confirm();
  }
}

watch(filterQuery, (value) => {
  if (filterTimer !== null) clearTimeout(filterTimer);
  filterTimer = setTimeout(() => {
    filterTimer = null;
    filterText.value = value;
  }, FILTER_DEBOUNCE_MS);
});

onBeforeUnmount(() => {
  if (filterTimer !== null) clearTimeout(filterTimer);
});

function confirm(): void {
  if (!confirmTarget.value.ok) return;
  emit("confirm", confirmTarget.value.path);
}

async function createFolder(): Promise<void> {
  const name = newFolderName.value.trim();
  if (!name || !currentPath.value) return;
  createError.value = null;
  try {
    await wsNative.fsCreateDir(joinPickerPath(currentPath.value, name));
    const parent = currentPath.value;
    creatingFolder.value = false;
    newFolderName.value = "";
    await navigate(parent);
    selectedName.value = name;
  } catch (error) {
    createError.value = error instanceof Error ? error.message : String(error);
  }
}

async function startEditPath(): Promise<void> {
  editPathValue.value = currentPath.value;
  editingPath.value = true;
  await nextTick();
  pathInputRef.value?.focus();
}

function commitEditPath(): void {
  const path = normalizeWorkspacePath(editPathValue.value);
  if (path && path !== currentPath.value) void navigate(path);
  else editingPath.value = false;
}

function iconFor(entry: FsDirEntry): string {
  return entry.kind === "dir"
    ? folderIconUrl(entry.name, false)
    : fileIconUrl(entry.name);
}

function entryMeta(entry: FsDirEntry): string {
  return entry.kind === "dir" ? "" : formatPickerSize(entry.size);
}

function toggleHidden(): void {
  showHidden.value = !showHidden.value;
  refresh();
}

onMounted(async () => {
  const env = props.options.workspace;
  if (env.kind === "wsl") {
    try {
      homePath.value = await native.getWslHome(env.distro);
    } catch {
      homePath.value = null;
    }
  } else if (env.kind === "local") {
    try {
      driveRoots.value = await native.listLocalRoots();
    } catch {
      driveRoots.value = [];
    }
    try {
      const launch = await native.getLaunchDir();
      if (launch) homePath.value = launch;
    } catch {
      homePath.value = null;
    }
  }
  const initial =
    props.options.initialPath ??
    homePath.value ??
    (env.kind === "wsl" ? "/" : driveRoots.value[0] ?? "");
  if (initial) {
    await navigate(initial);
    // 初始目录不存在（如最近的路径已被删除）时退回主目录 / 根。
    if (loadError.value) {
      const fallback =
        homePath.value ??
        (env.kind === "wsl" ? "/" : driveRoots.value[0] ?? "");
      if (fallback && normalizeWorkspacePath(fallback) !== normalizeWorkspacePath(initial)) {
        await navigate(fallback);
      }
    }
  } else {
    loadError.value = t("picker.noInitialPath");
  }
});
</script>

<template>
  <NModal
    :show="true"
    preset="card"
    :title="dialogTitle"
    :bordered="false"
    style="width: 680px; max-width: calc(100vw - 48px)"
    @update:show="emit('cancel')"
  >
    <div class="flex flex-col gap-2 text-[13px]">
      <div class="flex min-w-0 items-center gap-1.5">
        <NTag size="small" :bordered="false" round>{{ envLabel }}</NTag>
        <div v-if="!editingPath" class="flex min-w-0 flex-1 items-center gap-0.5 overflow-hidden">
          <template v-for="(crumb, index) in crumbs" :key="crumb.path">
            <span v-if="index > 0" class="text-muted-foreground">/</span>
            <button
              class="max-w-40 shrink-0 truncate rounded px-1.5 py-0.5 text-[12px] hover:bg-accent/60"
              :class="index === crumbs.length - 1 ? 'font-medium text-foreground' : 'text-muted-foreground'"
              :title="crumb.path"
              @click="navigate(crumb.path)"
            >
              {{ crumb.label }}
            </button>
          </template>
        </div>
        <NInput
          v-else
          ref="pathInputRef"
          v-model:value="editPathValue"
          size="small"
          :placeholder="t('picker.pathPlaceholder')"
          autofocus
          @keydown.enter="commitEditPath"
          @blur="editingPath = false"
        />
        <NButton quaternary size="tiny" :title="t('picker.editPath')" @click="startEditPath">
          <template #icon><NIcon :component="CreateOutline" /></template>
        </NButton>
        <NButton quaternary size="tiny" :disabled="!canGoUp" :title="t('picker.up')" @click="up">
          <template #icon><NIcon :component="ArrowUpOutline" /></template>
        </NButton>
      </div>

      <div v-if="places.length > 0" class="flex flex-wrap items-center gap-1">
        <NButton
          v-for="place in places"
          :key="place.key"
          quaternary
          size="tiny"
          @click="navigate(place.path)"
        >
          {{ place.label }}
        </NButton>
      </div>

      <div class="flex items-center gap-2">
        <NInput
          v-model:value="filterQuery"
          size="small"
          clearable
          :placeholder="t('picker.filterPlaceholder')"
          class="flex-1"
        >
          <template #prefix><NIcon :component="SearchOutline" /></template>
        </NInput>
        <NButton
          quaternary
          size="small"
          :title="t('picker.showHidden')"
          :type="showHidden ? 'primary' : 'default'"
          @click="toggleHidden"
        >
          <template #icon>
            <NIcon :component="showHidden ? EyeOutline : EyeOffOutline" />
          </template>
        </NButton>
        <NButton
          v-if="mode === 'directory'"
          quaternary
          size="small"
          :title="t('picker.newFolder')"
          :disabled="!currentPath"
          @click="creatingFolder = !creatingFolder"
        >
          <template #icon><NIcon :component="FolderOpenOutline" /></template>
        </NButton>
        <NButton quaternary size="small" :title="t('picker.refresh')" :disabled="!currentPath" @click="refresh">
          <template #icon><NIcon :component="RefreshOutline" /></template>
        </NButton>
        <span v-if="currentPath && !loading" class="shrink-0 text-xs text-muted-foreground">
          {{ t("picker.itemCount", { count: virtualItems.length }) }}
        </span>
      </div>

      <div v-if="creatingFolder" class="flex items-center gap-2">
        <NInput
          v-model:value="newFolderName"
          size="small"
          :placeholder="t('picker.newFolderPlaceholder')"
          autofocus
          @keydown.enter="createFolder"
        />
        <NButton size="small" quaternary @click="creatingFolder = false">
          {{ t("common.cancel") }}
        </NButton>
        <NButton size="small" type="primary" @click="createFolder">
          {{ t("picker.newFolderConfirm") }}
        </NButton>
      </div>
      <div v-if="createError" class="text-xs text-red-500">{{ createError }}</div>

      <div
        class="h-72 rounded-md border border-border/70 bg-muted/30"
        role="listbox"
        :aria-label="dialogTitle"
        tabindex="0"
        @keydown="onListKeydown"
      >
        <div v-if="loading" class="flex h-full items-center justify-center gap-2 text-muted-foreground">
          <NSpin size="small" />
          <span class="text-xs">{{ t("picker.loading") }}</span>
        </div>
        <div v-else-if="loadError" class="flex h-full flex-col items-center justify-center gap-2 text-muted-foreground">
          <span class="text-xs">{{ t("picker.loadFailed") }}</span>
          <span class="max-w-[90%] truncate text-xs opacity-70" :title="loadError">{{ loadError }}</span>
          <NButton size="tiny" @click="places[0] ? navigate(places[0].path) : refresh()">
            {{ t("picker.retry") }}
          </NButton>
        </div>
        <div v-else-if="virtualItems.length === 0" class="flex h-full items-center justify-center text-xs text-muted-foreground">
          {{ filterText ? t("picker.noMatches") : t("picker.emptyDir") }}
        </div>
        <!-- 虚拟列表：视口外不渲染，超大目录滚动/过滤均保持流畅。 -->
        <NVirtualList
          v-else
          :items="virtualItems"
          :item-size="ROW_HEIGHT"
          class="h-full"
        >
          <template #default="{ item }">
            <div
              role="option"
              :aria-selected="item.entry.name === selectedName"
              class="flex h-[30px] cursor-default select-none items-center gap-2 px-3 text-[13px] text-foreground/90 hover:bg-accent/40"
              :class="item.entry.name === selectedName ? 'bg-accent text-foreground' : ''"
              @click="selectEntry(item.entry)"
              @dblclick="activateEntry(item.entry)"
            >
              <img :src="iconFor(item.entry)" class="h-4 w-4 shrink-0" alt="" />
              <span class="min-w-0 flex-1 truncate text-left">{{ item.entry.name }}</span>
              <span class="shrink-0 text-xs text-muted-foreground">{{ entryMeta(item.entry) }}</span>
            </div>
          </template>
        </NVirtualList>
      </div>

      <div v-if="mode === 'file'" class="flex items-center gap-2">
        <span class="shrink-0 text-xs text-muted-foreground">{{ t("picker.nameLabel") }}</span>
        <NInput
          v-model:value="nameInput"
          size="small"
          :placeholder="t('picker.namePlaceholder')"
          @keydown.enter="confirm"
        />
      </div>

      <div class="flex items-center justify-between gap-3">
        <span class="min-w-0 flex-1 truncate text-xs text-muted-foreground" :title="confirmHint">
          {{ confirmHint }}
        </span>
        <NButton size="small" @click="emit('cancel')">{{ t("common.cancel") }}</NButton>
        <NButton size="small" type="primary" :disabled="confirmDisabled" @click="confirm">
          {{ confirmLabel }}
        </NButton>
      </div>
    </div>
  </NModal>
</template>
