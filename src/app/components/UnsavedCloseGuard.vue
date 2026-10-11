<script setup lang="ts">
import type { UnlistenFn } from "@tauri-apps/api/event";
import { getCurrentWindow } from "@tauri-apps/api/window";
import { useDialog } from "naive-ui";
import { onBeforeUnmount, onMounted, ref } from "vue";
import { hasTauriInternals } from "@/lib/tauriRuntime";
import { t } from "@/modules/i18n/translate";
import { describeDirtyEditorTabs, dirtyEditorTabs } from "@/modules/tabs/closeGuards";
import type { EditorTab, Tab } from "@/modules/tabs/tabsTypes";

const props = defineProps<{
  tabs: Tab[];
}>();

const emit = defineEmits<{
  closeTab: [id: number];
}>();

const dialog = useDialog();
const allowWindowClose = ref(false);
let windowCloseUnlisten: UnlistenFn | null = null;
let windowCloseDialogOpen = false;
let unmounted = false;

function resetWindowCloseDialog() {
  windowCloseDialogOpen = false;
}

function closeWindowWithoutSaving() {
  allowWindowClose.value = true;
  resetWindowCloseDialog();
  getCurrentWindow()
    .destroy()
    .catch((error) => {
      allowWindowClose.value = false;
      console.error("window.destroy failed:", error);
    });
}

function showWindowCloseDialog(dirtyTabs: EditorTab[]) {
  if (windowCloseDialogOpen) return;
  windowCloseDialogOpen = true;
  dialog.warning({
    title: t("app.unsaved.exitTitle"),
    content: t("app.unsaved.exitContent", {
      files: describeDirtyEditorTabs(dirtyTabs),
    }),
    positiveText: t("app.unsaved.exitWithoutSaving"),
    negativeText: t("common.cancel"),
    positiveButtonProps: { type: "error" },
    onPositiveClick: closeWindowWithoutSaving,
    onNegativeClick: resetWindowCloseDialog,
    onClose: resetWindowCloseDialog,
  });
}

function handleWindowCloseRequested(event: { preventDefault: () => void }) {
  if (allowWindowClose.value) return;
  const dirtyTabs = dirtyEditorTabs(props.tabs);
  if (dirtyTabs.length === 0) return;
  event.preventDefault();
  showWindowCloseDialog(dirtyTabs);
}

onMounted(() => {
  if (!hasTauriInternals()) return;
  getCurrentWindow()
    .onCloseRequested(handleWindowCloseRequested)
    .then((unlisten) => {
      if (unmounted) {
        unlisten();
        return;
      }
      windowCloseUnlisten = unlisten;
    })
    .catch((error) => {
      console.warn("window close guard unavailable:", error);
    });
});

onBeforeUnmount(() => {
  unmounted = true;
  windowCloseUnlisten?.();
  windowCloseUnlisten = null;
});

// 标签级关闭守卫不在这里：唯一实现是 `modules/tabs/useTabCloseGuard.ts`
// （鼠标 ✕、右键菜单、命令面板、快捷键全部走它）。本组件只负责**窗口关闭**
// 这一条路径 —— 语义不同（丢弃的是整个应用状态，不只是一个标签），所以
// 对话框文案与按钮也不同。
</script>

<template></template>
