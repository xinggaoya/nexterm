<script setup lang="ts">
import { onBeforeUnmount, onMounted, ref, watch } from "vue";
import {
  copyToClipboard,
  relativePath,
  revealInFinder,
} from "./lib/contextActions";
import { dirname } from "./lib/fileTreeService";
import { t } from "@/modules/i18n/translate";

export type ExplorerContextMenuTarget = {
  path: string;
  name: string;
  isDir: boolean;
  x: number;
  y: number;
  source: "row" | "root";
};

const props = defineProps<{
  target: ExplorerContextMenuTarget | null;
  rootPath: string | null;
}>();

const emit = defineEmits<{
  close: [];
  openFile: [path: string, pin: boolean];
  openMarkdownPreview: [path: string];
  openInTerminal: [path: string];
  create: [parentPath: string, kind: "file" | "dir"];
  rename: [path: string];
  deletePath: [path: string];
}>();

const confirmDeletePath = ref<string | null>(null);
const menuElement = ref<HTMLElement | null>(null);

function isMarkdownPath(path: string): boolean {
  return /\.(md|markdown|mdx)$/i.test(path);
}

function close() {
  confirmDeletePath.value = null;
  emit("close");
}

function handleOutsidePointerDown(event: Event) {
  if (!props.target) return;
  const node = event.target instanceof Node ? event.target : null;
  if (node && menuElement.value?.contains(node)) return;
  close();
}

function handleGlobalKeydown(event: KeyboardEvent) {
  if (event.key === "Escape" && props.target) {
    event.preventDefault();
    close();
  }
}

function handleWindowBlur() {
  if (props.target) close();
}

function createTargetPath(target: ExplorerContextMenuTarget): string {
  return target.isDir ? target.path : dirname(target.path);
}

function openFile(pin: boolean) {
  if (!props.target || props.target.isDir) return;
  emit("openFile", props.target.path, pin);
  close();
}

function openMarkdownPreview() {
  if (!props.target || props.target.isDir) return;
  emit("openMarkdownPreview", props.target.path);
  close();
}

function revealTarget() {
  if (!props.target) return;
  void revealInFinder(props.target.path);
  close();
}

function openInTerminal() {
  if (!props.target || !props.target.isDir) return;
  emit("openInTerminal", props.target.path);
  close();
}

function copyPath(relative: boolean) {
  if (!props.target || !props.rootPath) return;
  const text = relative
    ? relativePath(props.rootPath, props.target.path)
    : props.target.path;
  void copyToClipboard(text);
  close();
}

function create(kind: "file" | "dir") {
  if (!props.target) return;
  emit("create", createTargetPath(props.target), kind);
  close();
}

function beginRename() {
  if (!props.target || props.target.source === "root") return;
  emit("rename", props.target.path);
  close();
}

function confirmDelete() {
  if (!props.target || props.target.source === "root") return;
  if (confirmDeletePath.value !== props.target.path) {
    confirmDeletePath.value = props.target.path;
    return;
  }
  emit("deletePath", props.target.path);
  close();
}

watch(
  () => props.target?.path,
  () => {
    confirmDeletePath.value = null;
  },
);

onMounted(() => {
  window.addEventListener("pointerdown", handleOutsidePointerDown, true);
  window.addEventListener("keydown", handleGlobalKeydown);
  window.addEventListener("blur", handleWindowBlur);
});

onBeforeUnmount(() => {
  window.removeEventListener("pointerdown", handleOutsidePointerDown, true);
  window.removeEventListener("keydown", handleGlobalKeydown);
  window.removeEventListener("blur", handleWindowBlur);
});
</script>

<template>
  <div
    v-if="target"
    ref="menuElement"
    class="fixed z-50 min-w-44 rounded-lg border border-border bg-popover p-1 text-[12px] text-popover-foreground shadow-lg"
    :style="{ left: `${target.x}px`, top: `${target.y}px` }"
    @click.stop
    @contextmenu.prevent
  >
    <button
      v-if="!target.isDir"
      type="button"
      data-menu-action="open"
      class="flex h-7 w-full items-center rounded-md px-2 text-left hover:bg-accent"
      @click="openFile(true)"
    >
      {{ t("explorer.open") }}
    </button>
    <button
      v-if="!target.isDir && isMarkdownPath(target.path)"
      type="button"
      data-menu-action="open-preview"
      class="flex h-7 w-full items-center rounded-md px-2 text-left hover:bg-accent"
      @click="openMarkdownPreview"
    >
      {{ t("explorer.openPreview") }}
    </button>
    <button
      type="button"
      data-menu-action="reveal"
      class="flex h-7 w-full items-center rounded-md px-2 text-left hover:bg-accent"
      @click="revealTarget"
    >
      {{ t("explorer.revealInFinder") }}
    </button>
    <button
      v-if="target.isDir"
      type="button"
      data-menu-action="open-in-terminal"
      class="flex h-7 w-full items-center rounded-md px-2 text-left hover:bg-accent"
      @click="openInTerminal"
    >
      {{ t("explorer.openInTerminal") }}
    </button>
    <div class="my-1 h-px bg-border/70" />
    <button
      type="button"
      data-menu-action="new-file"
      class="flex h-7 w-full items-center rounded-md px-2 text-left hover:bg-accent"
      @click="create('file')"
    >
      {{ t("explorer.newFile") }}
    </button>
    <button
      type="button"
      data-menu-action="new-folder"
      class="flex h-7 w-full items-center rounded-md px-2 text-left hover:bg-accent"
      @click="create('dir')"
    >
      {{ t("explorer.newFolder") }}
    </button>
    <div class="my-1 h-px bg-border/70" />
    <button
      type="button"
      data-menu-action="copy-path"
      class="flex h-7 w-full items-center rounded-md px-2 text-left hover:bg-accent"
      @click="copyPath(false)"
    >
      {{ t("explorer.copyPath") }}
    </button>
    <button
      type="button"
      data-menu-action="copy-relative-path"
      class="flex h-7 w-full items-center rounded-md px-2 text-left hover:bg-accent"
      @click="copyPath(true)"
    >
      {{ t("explorer.copyRelativePath") }}
    </button>
    <template v-if="target.source !== 'root'">
      <div class="my-1 h-px bg-border/70" />
      <button
        type="button"
        data-menu-action="rename"
        class="flex h-7 w-full items-center rounded-md px-2 text-left hover:bg-accent"
        @click="beginRename"
      >
        {{ t("explorer.rename") }}
      </button>
      <button
        type="button"
        data-menu-action="delete"
        class="flex h-7 w-full items-center rounded-md px-2 text-left text-destructive hover:bg-destructive/10"
        @click="confirmDelete"
      >
        {{
          confirmDeletePath === target.path
            ? t("explorer.clickAgainToConfirm")
            : t("explorer.delete")
        }}
      </button>
    </template>
  </div>
</template>
