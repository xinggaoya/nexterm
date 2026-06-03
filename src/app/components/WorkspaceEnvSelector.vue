<script setup lang="ts">
import { DesktopOutline } from "@vicons/ionicons5";
import { NButton, NDropdown, NIcon, type DropdownOption } from "naive-ui";
import { computed, onMounted } from "vue";
import TooltipTitle from "@/components/TooltipTitle.vue";
import { useTouchDevicePreference } from "@/lib/touchDevice";
import { hasTauriInternals } from "@/lib/tauriRuntime";
import { t } from "@/modules/i18n/translate";
import {
  LOCAL_WORKSPACE,
  type WorkspaceEnv,
} from "@/modules/workspace/workspaceEnvSnapshot";
import { useWorkspaceEnvPiniaStore } from "@/modules/workspace/workspaceEnvPinia";

const workspace = useWorkspaceEnvPiniaStore();
const { effectiveTouch } = useTouchDevicePreference();
const props = withDefaults(
  defineProps<{
    switching?: boolean;
    switchingEnv?: WorkspaceEnv | null;
  }>(),
  {
    switching: false,
    switchingEnv: null,
  },
);
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

function envLabel(env: WorkspaceEnv): string {
  return env.kind === "wsl" ? env.distro : t("common.local");
}

const label = computed(() => {
  if (props.switching && props.switchingEnv) {
    return t("app.workspaceEnv.switchingTo", {
      target: envLabel(props.switchingEnv),
    });
  }
  return envLabel(workspace.env);
});

function handleSelect(key: string | number) {
  if (props.switching) return;
  const value = String(key);
  if (value === "local") {
    emit("select", LOCAL_WORKSPACE);
    return;
  }
  if (value.startsWith("wsl:")) {
    emit("select", { kind: "wsl", distro: value.slice(4) });
  }
}

const envButtonClass = computed(() =>
  effectiveTouch.value
    ? "max-w-44 h-9"
    : "max-w-44 h-6",
);

onMounted(() => {
  if (hasTauriInternals()) void workspace.refreshDistros();
});
</script>

<template>
  <TooltipTitle :label="t('app.workspaceEnv.title')">
    <NDropdown
      trigger="click"
      :options="options"
      :disabled="props.switching"
      @select="handleSelect"
    >
      <NButton
        size="tiny"
        quaternary
        :disabled="props.switching"
        :loading="props.switching"
        :aria-label="t('app.workspaceEnv.title')"
        :class="envButtonClass"
      >
        <template #icon><NIcon :component="DesktopOutline" /></template>
        <span class="truncate">{{ label }}</span>
      </NButton>
    </NDropdown>
  </TooltipTitle>
</template>
