<script setup lang="ts">
import { DesktopOutline } from "@vicons/ionicons5";
import { NButton, NDropdown, NIcon, type DropdownOption } from "naive-ui";
import { computed, onMounted } from "vue";
import { hasTauriInternals } from "@/lib/tauriRuntime";
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
  { key: "local", label: "Local" },
  ...workspace.distros.map((distro) => ({
    key: `wsl:${distro.name}`,
    label: `${distro.name}${distro.default ? " default" : ""}${
      distro.running ? " running" : ""
    }`,
  })),
]);

const label = computed(() =>
  workspace.env.kind === "wsl" ? workspace.env.distro : "Local",
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
  <NDropdown trigger="click" :options="options" @select="handleSelect">
    <NButton
      size="tiny"
      quaternary
      title="Workspace environment"
      aria-label="Workspace environment"
      class="max-w-44"
    >
      <template #icon><NIcon :component="DesktopOutline" /></template>
      <span class="truncate">{{ label }}</span>
    </NButton>
  </NDropdown>
</template>
