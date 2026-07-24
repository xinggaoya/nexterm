<script setup lang="ts">
import { NButton } from "naive-ui";
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
  duplicate: [path: string];
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

function duplicate() {
  if (!props.target) return;
  emit("duplicate", props.target.path);
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
    class="nexterm-overlay fixed z-50 min-w-44 p-1 text-[12px]"
    :style="{ left: `${target.x}px`, top: `${target.y}px` }"
    @contextmenu.prevent
  >
    <NButton
      v-if="!target.isDir"
      text
      block
      size="tiny"
      data-menu-action="open"
     
      @click="openFile(true)"
    >
      {{ t("explorer.open") }}
    </NButton>
    <NButton
      v-if="!target.isDir && isMarkdownPath(target.path)"
      text
      block
      size="tiny"
      data-menu-action="open-preview"
     
      @click="openMarkdownPreview"
    >
      {{ t("explorer.openPreview") }}
    </NButton>
    <NButton
      text
      block
      size="tiny"
      data-menu-action="reveal"
     
      @click="revealTarget"
    >
      {{ t("explorer.revealInFinder") }}
    </NButton>
    <NButton
      v-if="target.isDir"
      text
      block
      size="tiny"
      data-menu-action="open-in-terminal"
     
      @click="openInTerminal"
    >
      {{ t("explorer.openInTerminal") }}
    </NButton>
    <NButton
      text
      block
      size="tiny"
      data-menu-action="duplicate"
     
      @click="duplicate"
    >
      {{ t("explorer.duplicate") }}
    </NButton>
    <div class="my-1 h-px bg-border/70" />
    <NButton
      text
      block
      size="tiny"
      data-menu-action="new-file"
     
      @click="create('file')"
    >
      {{ t("explorer.newFile") }}
    </NButton>
    <NButton
      text
      block
      size="tiny"
      data-menu-action="new-folder"
     
      @click="create('dir')"
    >
      {{ t("explorer.newFolder") }}
    </NButton>
    <div class="my-1 h-px bg-border/70" />
    <NButton
      text
      block
      size="tiny"
      data-menu-action="copy-path"
     
      @click="copyPath(false)"
    >
      {{ t("explorer.copyPath") }}
    </NButton>
    <NButton
      text
      block
      size="tiny"
      data-menu-action="copy-relative-path"
     
      @click="copyPath(true)"
    >
      {{ t("explorer.copyRelativePath") }}
    </NButton>
    <template v-if="target.source !== 'root'">
      <div class="my-1 h-px bg-border/70" />
      <NButton
        text
        block
        size="tiny"
        data-menu-action="rename"
       
        @click="beginRename"
      >
        {{ t("explorer.rename") }}
      </NButton>
      <NButton
        text
        block
        size="tiny"
        data-menu-action="delete"
        :type="confirmDeletePath === target.path ? 'error' : 'default'"
       
        @click="confirmDelete"
      >
        {{
          confirmDeletePath === target.path
            ? t("explorer.clickAgainToConfirm")
            : t("explorer.delete")
        }}
      </NButton>
    </template>
  </div>
</template>