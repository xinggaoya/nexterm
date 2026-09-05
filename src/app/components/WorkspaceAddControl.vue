<script setup lang="ts">
import { AddOutline, ServerOutline, TerminalOutline } from "@vicons/ionicons5";
import { NDropdown, NIcon, type DropdownOption } from "naive-ui";
import { computed, ref } from "vue";
import NextermIconButton from "@/components/NextermIconButton.vue";
import { IS_WINDOWS } from "@/lib/platform";
import { t } from "@/modules/i18n/translate";
import {
  LOCAL_WORKSPACE,
  type WorkspaceEnv,
} from "@/modules/workspace/workspaceEnvSnapshot";
import { useWorkspaceEnvPiniaStore } from "@/modules/workspace/workspaceEnvPinia";

const props = withDefaults(
  defineProps<{
    embedded?: boolean;
  }>(),
  {
    embedded: false,
  },
);

const emit = defineEmits<{
  addWorkspace: [env: WorkspaceEnv];
}>();

const workspaceEnv = useWorkspaceEnvPiniaStore();
const wslMenuOpen = ref(false);
const wslOptions = computed<DropdownOption[]>(() =>
  workspaceEnv.distros.map((distro) => ({
    key: distro.name,
    label: distro.name,
  })),
);
// 只有一个 WSL distro 时，直接打开无需弹出下拉。
const singleWslDistro = computed(() =>
  IS_WINDOWS && workspaceEnv.distros.length === 1
    ? workspaceEnv.distros[0]?.name ?? null
    : null,
);
const showWslAction = computed(
  () => IS_WINDOWS && wslOptions.value.length > 0,
);
// 多 distro 时才渲染下拉；单 distro 时走直开按钮。
const showWslDropdown = computed(
  () => showWslAction.value && !singleWslDistro.value,
);
// 单 distro 时渲染直开按钮。
const showWslDirect = computed(
  () => IS_WINDOWS && singleWslDistro.value !== null,
);

function addLocalWorkspace(): void {
  emit("addWorkspace", LOCAL_WORKSPACE);
}

// SSH:发起连接对话框(内含档案列表/新建 + 凭据校验),与欢迎页同一条链路。
function addSshWorkspace(): void {
  emit("addWorkspace", { kind: "ssh", profileId: "new" });
}

function addWslWorkspace(key: string | number): void {
  emit("addWorkspace", { kind: "wsl", distro: String(key) });
}

// 单 distro 直开：绕过下拉直接发起添加。
function addSingleWslWorkspace(): void {
  const distro = singleWslDistro.value;
  if (distro) addWslWorkspace(distro);
}
</script>

<template>
  <template v-if="props.embedded">
    <button
      type="button"
      class="nexterm-row flex h-7 items-center gap-2 px-2 text-[12px] text-muted-foreground hover:text-foreground"
      :title="t('app.workspaceBar.addLocal')"
      :aria-label="t('app.workspaceBar.addLocal')"
      data-add-workspace
      data-add-workspace-local
      @click="addLocalWorkspace"
    >
      <NIcon :component="AddOutline" :size="13" />
      <span class="truncate">{{ t("app.workspaceBar.addLocal") }}</span>
    </button>

    <NDropdown
      v-if="showWslDropdown"
      v-model:show="wslMenuOpen"
      trigger="click"
      :options="wslOptions"
      @select="addWslWorkspace"
    >
      <button
        type="button"
        class="nexterm-row flex h-7 items-center gap-2 px-2 text-[12px] text-muted-foreground hover:text-foreground"
        :title="t('app.workspaceBar.addWsl')"
        :aria-label="t('app.workspaceBar.addWsl')"
        aria-haspopup="menu"
        :aria-expanded="wslMenuOpen"
        data-add-workspace-wsl
      >
        <NIcon :component="ServerOutline" :size="13" />
        <span class="truncate">{{ t("app.workspaceBar.addWsl") }}</span>
      </button>
    </NDropdown>

    <button
      v-else-if="showWslDirect"
      type="button"
      class="nexterm-row flex h-7 items-center gap-2 px-2 text-[12px] text-muted-foreground hover:text-foreground"
      :title="t('app.workspaceBar.addWsl')"
      :aria-label="t('app.workspaceBar.addWsl')"
      data-add-workspace-wsl
      @click="addSingleWslWorkspace"
    >
      <NIcon :component="ServerOutline" :size="13" />
      <span class="truncate">{{ t("app.workspaceBar.addWsl") }}</span>
    </button>

    <button
      type="button"
      class="nexterm-row flex h-7 items-center gap-2 px-2 text-[12px] text-muted-foreground hover:text-foreground"
      :title="t('app.workspaceBar.addSsh')"
      :aria-label="t('app.workspaceBar.addSsh')"
      data-add-workspace-ssh
      @click="addSshWorkspace"
    >
      <NIcon :component="TerminalOutline" :size="13" />
      <span class="truncate">{{ t("app.workspaceBar.addSsh") }}</span>
    </button>
  </template>

  <template v-else>
    <NextermIconButton
      :title="t('app.workspaceBar.addLocal')"
      :aria-label="t('app.workspaceBar.addLocal')"
      data-add-workspace
      data-add-workspace-local
      @click="addLocalWorkspace"
    >
      <NIcon :component="AddOutline" :size="15" />
    </NextermIconButton>

    <NDropdown
      v-if="showWslDropdown"
      v-model:show="wslMenuOpen"
      trigger="click"
      :options="wslOptions"
      @select="addWslWorkspace"
    >
      <NextermIconButton
        :title="t('app.workspaceBar.addWsl')"
        :aria-label="t('app.workspaceBar.addWsl')"
        aria-haspopup="menu"
        :aria-expanded="wslMenuOpen"
        data-add-workspace-wsl
      >
        <NIcon :component="ServerOutline" :size="14" />
      </NextermIconButton>
    </NDropdown>

    <NextermIconButton
      v-else-if="showWslDirect"
      :title="t('app.workspaceBar.addWsl')"
      :aria-label="t('app.workspaceBar.addWsl')"
      data-add-workspace-wsl
      @click="addSingleWslWorkspace"
    >
      <NIcon :component="ServerOutline" :size="14" />
    </NextermIconButton>

    <NextermIconButton
      :title="t('app.workspaceBar.addSsh')"
      :aria-label="t('app.workspaceBar.addSsh')"
      data-add-workspace-ssh
      @click="addSshWorkspace"
    >
      <NIcon :component="TerminalOutline" :size="14" />
    </NextermIconButton>
  </template>
</template>
