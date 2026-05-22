<script setup lang="ts">
import type { UnlistenFn } from "@tauri-apps/api/event";
import { getCurrentWindow } from "@tauri-apps/api/window";
import { useDialog } from "naive-ui";
import { onBeforeUnmount, onMounted, ref } from "vue";
import { hasTauriInternals } from "@/lib/tauriRuntime";
import {
  describeDirtyEditorTabs,
  dirtyEditorTabs,
  isDirtyEditorTab,
} from "@/modules/tabs/closeGuards";
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

function showCloseTabDialog(tab: EditorTab) {
  dialog.warning({
    title: "Close unsaved file?",
    content: `Unsaved changes in ${describeDirtyEditorTabs([tab])} will be discarded.`,
    positiveText: "Close Without Saving",
    negativeText: "Cancel",
    positiveButtonProps: { type: "error" },
    onPositiveClick: () => emit("closeTab", tab.id),
  });
}

function requestCloseTab(id: number) {
  const tab = props.tabs.find((item) => item.id === id);
  if (!tab) return;
  if (!isDirtyEditorTab(tab)) {
    emit("closeTab", id);
    return;
  }
  showCloseTabDialog(tab);
}

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
    title: "Exit with unsaved files?",
    content: `${describeDirtyEditorTabs(
      dirtyTabs,
    )} will be discarded if you exit Nexterm.`,
    positiveText: "Exit Without Saving",
    negativeText: "Cancel",
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

defineExpose({
  requestCloseTab,
});
</script>

<template></template>
