<script setup lang="ts">
import { AddOutline, ServerOutline } from "@vicons/ionicons5";
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
const showWslAction = computed(
  () => IS_WINDOWS && wslOptions.value.length > 0,
);

function addLocalWorkspace(): void {
  emit("addWorkspace", LOCAL_WORKSPACE);
}

function addWslWorkspace(key: string | number): void {
  emit("addWorkspace", { kind: "wsl", distro: String(key) });
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
      v-if="showWslAction"
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
      v-if="showWslAction"
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
  </template>
</template>
