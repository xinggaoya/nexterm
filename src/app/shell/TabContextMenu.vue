<script setup lang="ts">
import { onBeforeUnmount, onMounted, ref, watch } from "vue";
import type { Tab } from "@/modules/tabs/tabsTypes";
import { t } from "@/modules/i18n/translate";

export type TabContextMenuTarget = {
  tab: Tab;
  x: number;
  y: number;
  index: number;
  total: number;
};

const props = defineProps<{
  target: TabContextMenuTarget | null;
  rootPath: string | null;
}>();

const emit = defineEmits<{
  close: [];
  closeTab: [id: number];
  closeOthers: [id: number];
  closeToRight: [id: number];
  closeAll: [];
  duplicateTerminal: [tabId: number];
  renameTab: [tabId: number, title: string];
  pinEditor: [tabId: number];
  copyPath: [path: string];
  copyRelativePath: [rootPath: string, path: string];
  moveToNewWindow: [tabId: number];
  requestRename: [tabId: number];
}>();

const menuElement = ref<HTMLElement | null>(null);

function isPathTab(tab: Tab): tab is Extract<Tab, { path: string }> {
  return "path" in tab && typeof (tab as { path?: unknown }).path === "string";
}

function pathFor(tab: Tab): string | null {
  if (tab.kind === "terminal") return tab.cwd ?? null;
  if (isPathTab(tab)) return tab.path;
  return null;
}

function close() {
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

function emitClose(action: "close" | "others" | "right" | "all") {
  if (!props.target) return;
  switch (action) {
    case "close":
      emit("closeTab", props.target.tab.id);
      break;
    case "others":
      emit("closeOthers", props.target.tab.id);
      break;
    case "right":
      emit("closeToRight", props.target.tab.id);
      break;
    case "all":
      emit("closeAll");
      break;
  }
  close();
}

function emitDuplicate() {
  if (!props.target || props.target.tab.kind !== "terminal") return;
  emit("duplicateTerminal", props.target.tab.id);
  close();
}

function emitRename() {
  if (!props.target) return;
  emit("requestRename", props.target.tab.id);
  close();
}

function emitPin() {
  if (!props.target || props.target.tab.kind !== "editor") return;
  emit("pinEditor", props.target.tab.id);
  close();
}

function emitCopyPath(relative: boolean) {
  if (!props.target) return;
  const path = pathFor(props.target.tab);
  if (!path) return;
  if (relative) {
    if (!props.rootPath) return;
    emit("copyRelativePath", props.rootPath, path);
  } else {
    emit("copyPath", path);
  }
  close();
}

function emitMoveToNewWindow() {
  if (!props.target) return;
  emit("moveToNewWindow", props.target.tab.id);
  close();
}

watch(
  () => props.target?.tab.id,
  () => {
    /* reset not needed; target is replaced */
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
      type="button"
      data-menu-action="close"
      class="flex h-7 w-full items-center rounded-md px-2 text-left hover:bg-accent"
      @click="emitClose('close')"
    >
      {{ t("tabMenu.close") }}
    </button>
    <button
      v-if="target.total > 1"
      type="button"
      data-menu-action="close-others"
      class="flex h-7 w-full items-center rounded-md px-2 text-left hover:bg-accent"
      @click="emitClose('others')"
    >
      {{ t("tabMenu.closeOthers") }}
    </button>
    <button
      v-if="target.index < target.total - 1"
      type="button"
      data-menu-action="close-right"
      class="flex h-7 w-full items-center rounded-md px-2 text-left hover:bg-accent"
      @click="emitClose('right')"
    >
      {{ t("tabMenu.closeRight") }}
    </button>
    <button
      v-if="target.total > 1"
      type="button"
      data-menu-action="close-all"
      class="flex h-7 w-full items-center rounded-md px-2 text-left hover:bg-accent"
      @click="emitClose('all')"
    >
      {{ t("tabMenu.closeAll") }}
    </button>
    <template v-if="target.tab.kind === 'terminal'">
      <div class="my-1 h-px bg-border/70" />
      <button
        type="button"
        data-menu-action="duplicate"
        class="flex h-7 w-full items-center rounded-md px-2 text-left hover:bg-accent"
        @click="emitDuplicate"
      >
        {{ t("tabMenu.duplicate") }}
      </button>
      <button
        type="button"
        data-menu-action="rename"
        class="flex h-7 w-full items-center rounded-md px-2 text-left hover:bg-accent"
        @click="emitRename"
      >
        {{ t("tabMenu.rename") }}
      </button>
    </template>
    <template
      v-else-if="target.tab.kind === 'editor' || target.tab.kind === 'markdown' || target.tab.kind === 'preview'"
    >
      <div class="my-1 h-px bg-border/70" />
      <button
        v-if="target.tab.kind === 'editor'"
        type="button"
        data-menu-action="pin"
        class="flex h-7 w-full items-center rounded-md px-2 text-left hover:bg-accent"
        @click="emitPin"
      >
        {{
          target.tab.preview ? t("tabMenu.pin") : t("tabMenu.unpin")
        }}
      </button>
      <button
        type="button"
        data-menu-action="move-to-new-window"
        class="flex h-7 w-full items-center rounded-md px-2 text-left hover:bg-accent"
        @click="emitMoveToNewWindow"
      >
        {{ t("tabMenu.moveToNewWindow") }}
      </button>
    </template>
    <template v-if="pathFor(target.tab)">
      <div class="my-1 h-px bg-border/70" />
      <button
        type="button"
        data-menu-action="copy-path"
        class="flex h-7 w-full items-center rounded-md px-2 text-left hover:bg-accent"
        @click="emitCopyPath(false)"
      >
        {{ t("tabMenu.copyPath") }}
      </button>
      <button
        v-if="rootPath && pathFor(target.tab)?.startsWith(`${rootPath}/`)"
        type="button"
        data-menu-action="copy-relative-path"
        class="flex h-7 w-full items-center rounded-md px-2 text-left hover:bg-accent"
        @click="emitCopyPath(true)"
      >
        {{ t("tabMenu.copyRelativePath") }}
      </button>
    </template>
  </div>
</template>
