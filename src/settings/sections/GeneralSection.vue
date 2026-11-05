<script setup lang="ts">
import { normalizeErrorMessage } from "@/lib/error";
import { BugOutline } from "@vicons/ionicons5";
import { NButton, NCard, NForm, NFormItem, NIcon, NSelect, NSwitch } from "naive-ui";
import { computed, onMounted, ref } from "vue";
import { t } from "@/modules/i18n/translate";
import { hasTauriInternals } from "@/lib/tauriRuntime";
import { native } from "@/lib/native";
import { usePreferencesPiniaStore } from "@/modules/settings/preferencesPinia";
import type { PanelLayoutPref, PanelView } from "@/modules/settings/store";
import { assignPanelView } from "@/app/shell/panelVisibility";

const prefs = usePreferencesPiniaStore();

// ── 停靠面板的左右分配 ────────────────────────────────────────────────
// 面板只有两种视图（文件树 / 更改），左右各一个，且**不允许重复** ——
// 两边都开文件树没有意义。所以选到另一侧已经占着的视图时两侧对调。
const panelViewOptions = computed(() => [
  { label: t("settings.general.panelExplorer"), value: "explorer" },
  { label: t("settings.general.panelChanges"), value: "changes" },
]);

function setPanelSide(side: "left" | "right", view: PanelView): void {
  const layout: PanelLayoutPref = assignPanelView(
    prefs.panelLayout,
    side,
    view,
  );
  prefs.panelLayout = layout;
  // 乐观更新本地 store，持久化仅在 Tauri 环境执行（与壳层同款守卫：
  // 纯浏览器 / 测试环境里写盘必然失败）。
  if (hasTauriInternals()) void prefs.updatePanelLayout(layout);
}

const devtoolsOpen = ref(false);
const devtoolsBusy = ref(false);
const devtoolsError = ref<string | null>(null);
// release 构建默认不编译 devtools（见 src-tauri/Cargo.toml features.devtools）。
// 与其渲染一个点了就报错按钮，不如整行不渲染。
const devtoolsAvailable = ref(false);

const backendDevtoolsAvailable = ref(false);
const backendDevtoolsBusy = ref(false);
const backendDevtoolsError = ref<string | null>(null);

onMounted(() => {
  void syncDevtoolsState();
  void syncBackendDevtoolsState();
});

async function syncDevtoolsState() {
  if (!hasTauriInternals()) return;
  try {
    devtoolsAvailable.value = await native.devtoolsAvailable();
    if (!devtoolsAvailable.value) return;
    devtoolsOpen.value = await native.isDevtoolsOpen();
    devtoolsError.value = null;
  } catch (error) {
    devtoolsError.value = normalizeErrorMessage(error);
  }
}

async function toggleDevtools() {
  if (!hasTauriInternals() || devtoolsBusy.value) return;
  devtoolsBusy.value = true;
  try {
    devtoolsOpen.value = await native.toggleDevtools();
    devtoolsError.value = null;
  } catch (error) {
    devtoolsError.value = normalizeErrorMessage(error);
  } finally {
    devtoolsBusy.value = false;
  }
}

async function syncBackendDevtoolsState() {
  if (!hasTauriInternals()) return;
  try {
    backendDevtoolsAvailable.value = await native.crabnebulaDevtoolsAvailable();
    backendDevtoolsError.value = null;
  } catch (error) {
    backendDevtoolsError.value = String(error);
  }
}

async function openBackendDevtools() {
  if (!hasTauriInternals() || backendDevtoolsBusy.value) return;
  backendDevtoolsBusy.value = true;
  try {
    await native.toggleCrabnebulaDevtools();
    backendDevtoolsError.value = null;
  } catch (error) {
    backendDevtoolsError.value = String(error);
  } finally {
    backendDevtoolsBusy.value = false;
  }
}
</script>

<template>
  <section class="space-y-5">
    <div>
      <h1 class="text-lg font-semibold tracking-normal">
        {{ t("settings.general.title") }}
      </h1>
      <p class="mt-1 text-xs text-muted-foreground">
        {{ t("settings.general.description") }}
      </p>
    </div>

    <NCard class="nexterm-settings-group" size="small" :title="t('settings.general.startupAndWorkspace')" embedded>
      <NForm label-placement="left" label-width="150" size="small">
        <NFormItem :label="t('settings.general.autostart')">
          <NSwitch
            :value="prefs.autostart"
            @update:value="prefs.updateAutostart"
          />
        </NFormItem>
        <NFormItem :label="t('settings.general.restoreWindow')">
          <NSwitch
            :value="prefs.restoreWindowState"
            @update:value="prefs.updateRestoreWindowState"
          />
        </NFormItem>
        <NFormItem :label="t('settings.general.showHiddenFiles')">
          <NSwitch
            :value="prefs.showHidden"
            @update:value="prefs.updateShowHidden"
          />
        </NFormItem>
      </NForm>
    </NCard>

    <NCard class="nexterm-settings-group" size="small" :title="t('settings.general.panelLayout')" embedded>
      <NForm label-placement="left" label-width="150" size="small">
        <NFormItem :label="t('settings.general.leftPanel')">
          <NSelect
            :value="prefs.panelLayout.left"
            :options="panelViewOptions"
            class="w-40"
            @update:value="(value) => setPanelSide('left', value)"
          />
        </NFormItem>
        <NFormItem :label="t('settings.general.rightPanel')">
          <NSelect
            :value="prefs.panelLayout.right"
            :options="panelViewOptions"
            class="w-40"
            @update:value="(value) => setPanelSide('right', value)"
          />
        </NFormItem>
        <p class="mt-1 text-[12px] text-muted-foreground">
          {{ t("settings.general.panelLayoutHint") }}
        </p>
      </NForm>
    </NCard>

    <NCard
      v-if="devtoolsAvailable"
      class="nexterm-settings-group"
      size="small"
      :title="t('settings.general.developer')"
      embedded
    >
      <NForm label-placement="left" label-width="150" size="small">
        <NFormItem :label="t('settings.general.devtoolsLabel')">
          <div class="flex flex-col gap-1">
            <NButton
              size="small"
              :type="devtoolsOpen ? 'primary' : 'default'"
              :loading="devtoolsBusy"
              data-toggle-devtools
              @click="toggleDevtools"
            >
              <template #icon><NIcon :component="BugOutline" /></template>
              {{
                devtoolsOpen
                  ? t("settings.general.closeAction")
                  : t("settings.general.openAction")
              }}
            </NButton>
            <span class="text-[11px] text-muted-foreground">
              {{ t("settings.general.toggleDevtoolsHint") }}
            </span>
            <span v-if="devtoolsError" class="text-[11px] text-destructive">
              {{ devtoolsError }}
            </span>
          </div>
        </NFormItem>
        <NFormItem
          v-if="backendDevtoolsAvailable"
          :label="t('settings.general.backendDevtoolsLabel')"
        >
          <div class="flex flex-col gap-1">
            <NButton
              size="small"
              type="primary"
              :loading="backendDevtoolsBusy"
              data-open-backend-devtools
              @click="openBackendDevtools"
            >
              <template #icon><NIcon :component="BugOutline" /></template>
              {{ t("settings.general.openAction") }}
            </NButton>
            <span class="text-[11px] text-muted-foreground">
              {{ t("settings.general.openBackendDevtoolsHint") }}
            </span>
            <span
              v-if="backendDevtoolsError"
              class="text-[11px] text-destructive"
            >
              {{ backendDevtoolsError }}
            </span>
          </div>
        </NFormItem>
      </NForm>
    </NCard>
  </section>
</template>
