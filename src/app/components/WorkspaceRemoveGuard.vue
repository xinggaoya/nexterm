<script setup lang="ts">
import { useDialog } from "naive-ui";
import { t } from "@/modules/i18n/translate";
import type { WorkspaceInstance } from "@/modules/workspace";

// 无渲染组件：必须挂在 NDialogProvider 之下才能拿到 useDialog，
// MainApp 本身位于 provider 之外，所以通过 ref 暴露 confirmRemove 供其调用。
const dialog = useDialog();
let pendingId: string | null = null;

function confirmRemove(workspace: WorkspaceInstance, onConfirm: () => void) {
  if (pendingId === workspace.id) return;
  pendingId = workspace.id;
  dialog.warning({
    title: t("app.workspace.removeTitle"),
    content: t("app.workspace.removeContent", { name: workspace.name }),
    positiveText: t("app.workspace.removeConfirm"),
    negativeText: t("common.cancel"),
    positiveButtonProps: { type: "error" },
    onPositiveClick: onConfirm,
    onAfterLeave: () => {
      pendingId = null;
    },
  });
}

defineExpose({
  confirmRemove,
});
</script>

<template></template>
