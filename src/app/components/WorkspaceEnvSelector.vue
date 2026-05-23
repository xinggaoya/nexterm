<script setup lang="ts">
import { DesktopOutline } from "@vicons/ionicons5";
import { NButton, NDropdown, NIcon, type DropdownOption } from "naive-ui";
import { computed, onMounted } from "vue";
import TooltipTitle from "@/components/TooltipTitle.vue";
import { hasTauriInternals } from "@/lib/tauriRuntime";
import { t } from "@/modules/i18n/translate";
import {
  LOCAL_WORKSPACE,
  type WorkspaceEnv,
} from "@/modules/workspace/workspaceEnvSnapshot";
import { useWorkspaceEnvPiniaStore } from "@/modules/workspace/workspaceEnvPinia";

const workspace = useWorkspaceEnvPiniaStore();
const emit = defineEmits<{
  select: [env: WorkspaceEnv];
}>();

const options = computed<DropdownOption[]>(() => [
  { key: "local", label: t("common.local") },
  ...workspace.distros.map((distro) => ({
    key: `wsl:${distro.name}`,
    label: `${distro.name}${distro.default ? ` ${t("common.default")}` : ""}${
      distro.running ? ` ${t("common.running")}` : ""
    }`,
  })),
]);

const label = computed(() =>
  workspace.env.kind === "wsl" ? workspace.env.distro : t("common.local"),
);

function handleSelect(key: string | number) {
  const value = String(key);
  if (value === "local") {
    emit("select", LOCAL_WORKSPACE);
    return;
  }
  if (value.startsWith("wsl:")) {
    emit("select", { kind: "wsl", distro: value.slice(4) });
  }
}

onMounted(() => {
  if (hasTauriInternals()) void workspace.refreshDistros();
});
</script>

<template>
  <TooltipTitle :label="t('app.workspaceEnv.title')">
    <NDropdown trigger="click" :options="options" @select="handleSelect">
      <NButton
        size="tiny"
        quaternary
        :aria-label="t('app.workspaceEnv.title')"
        class="max-w-44"
      >
        <template #icon><NIcon :component="DesktopOutline" /></template>
        <span class="truncate">{{ label }}</span>
      </NButton>
    </NDropdown>
  </TooltipTitle>
</template>
