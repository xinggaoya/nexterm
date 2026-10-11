<script setup lang="ts">
import { normalizeErrorMessage } from "@/lib/error";
import { BugOutline } from "@vicons/ionicons5";
import { NButton, NCard, NForm, NFormItem, NIcon, NSwitch } from "naive-ui";
import { onMounted, ref } from "vue";
import { t } from "@/modules/i18n/translate";
import { hasTauriInternals } from "@/lib/tauriRuntime";
import { native } from "@/lib/native";
import { usePreferencesPiniaStore } from "@/modules/settings/preferencesPinia";

const prefs = usePreferencesPiniaStore();

const devtoolsOpen = ref(false);
const devtoolsBusy = ref(false);
const devtoolsError = ref<string | null>(null);
// release 构建默认不编译 devtools（见 src-tauri/Cargo.toml features.devtools）。
// 与其渲染一个点了就报错按钮，不如整行不渲染。
const devtoolsAvailable = ref(false);

onMounted(() => {
  void syncDevtoolsState();
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

    <NCard
      v-if="devtoolsAvailable"
      class="nexterm-settings-group"
      size="small"
      :title="t('settings.general.developer')"
      embedded
    >
      <NForm label-placement="left" label-width="150" size="small">
        <NFormItem :label="t('settings.general.toggleDevtools')">
          <div class="flex flex-col gap-1">
            <NButton
              size="small"
              :type="devtoolsOpen ? 'primary' : 'default'"
              :loading="devtoolsBusy"
              data-toggle-devtools
              @click="toggleDevtools"
            >
              <template #icon><NIcon :component="BugOutline" /></template>
              {{ devtoolsOpen ? "✓ " : "" }}{{ t("settings.general.toggleDevtools") }}
            </NButton>
            <span class="text-[11px] text-muted-foreground">
              {{ t("settings.general.toggleDevtoolsHint") }}
            </span>
            <span v-if="devtoolsError" class="text-[11px] text-destructive">
              {{ devtoolsError }}
            </span>
          </div>
        </NFormItem>
      </NForm>
    </NCard>
  </section>
</template>
