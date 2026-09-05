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
  // 常驻入口:零档案时也能发起 SSH 连接(对话框内可新建档案)。
  {
    key: "ssh:new",
    label: t("ssh.selector.newConnection"),
  },
  ...sshProfiles.value.map((profile) => ({
    key: `ssh:${profile.id}`,
    label: `${profile.name} · ${profile.host}`,
  })),
]);

const sshProfiles = ref<{ id: string; name: string; host: string }[]>([]);

async function refreshSshProfiles() {
  if (!hasTauriInternals()) return;
  try {
    const { ssh } = await import("@/lib/native");
    const all = await ssh.profileList();
    sshProfiles.value = all.map((profile) => ({
      id: profile.id,
      name: profile.name,
      host: profile.host,
    }));
  } catch {
    // SSH 档案加载失败不阻塞 env 选择(WSL/本地照常可用)。
    sshProfiles.value = [];
  }
}

function envLabel(env: WorkspaceEnv): string {
  if (env.kind === "wsl") return env.distro;
  if (env.kind === "ssh") return t("common.ssh");
  return t("common.local");
}

const label = computed(() => {
  if (props.switching && props.switchingEnv) {
    return t("app.workspaceEnv.switchingTo", {
      target: envLabel(props.switchingEnv),
    });
  }
  return envLabel(workspace.pendingEnv);
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
    return;
  }
  if (value.startsWith("ssh:")) {
    // "ssh:new" 表示新建连接:对话框内完成档案创建 + 凭据校验。
    emit("select", { kind: "ssh", profileId: value.slice(4) });
  }
}

const envButtonClass = computed(() =>
  effectiveTouch.value
    ? "max-w-44 h-9"
    : "max-w-44 h-6",
);

onMounted(() => {
  if (hasTauriInternals()) {
    void workspace.refreshDistros();
    void refreshSshProfiles();
  }
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
