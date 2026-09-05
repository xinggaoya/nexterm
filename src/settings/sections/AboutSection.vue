<script setup lang="ts">
import { RefreshOutline } from "@vicons/ionicons5";
import {
  NButton,
  NCard,
  NDescriptions,
  NDescriptionsItem,
  NForm,
  NFormItem,
  NIcon,
  NProgress,
  NSwitch,
} from "naive-ui";
import { computed } from "vue";
import { APP_VERSION } from "@/lib/appInfo";
import { relaunchApp } from "@/lib/native";
import { t } from "@/modules/i18n/translate";
import { usePreferencesPiniaStore } from "@/modules/settings/preferencesPinia";
import { useAppUpdater } from "@/app/useAppUpdater";

const prefs = usePreferencesPiniaStore();
const updater = useAppUpdater();

const isBusy = computed(
  () =>
    updater.status.value === "checking" || updater.status.value === "downloading",
);
const isDownloading = computed(() => updater.status.value === "downloading");
const isReady = computed(() => updater.status.value === "ready");
const progressPct = computed(() =>
  isDownloading.value ? updater.downloadProgress.value : null,
);

const statusLine = computed(() => {
  switch (updater.status.value) {
    case "checking":
      return t("settings.about.statusChecking");
    case "downloading":
      return t("settings.about.statusDownloading");
    case "ready":
      return updater.availableVersion.value
        ? t("settings.about.newVersionReady", {
            version: updater.availableVersion.value,
          })
        : t("settings.about.statusReady");
    case "up-to-date":
      return t("settings.about.statusUpToDate");
    case "error":
      return t("settings.about.statusError");
    default:
      return t("settings.about.statusIdle");
  }
});

const downloadDetail = computed(() => {
  const pct = updater.downloadProgress.value;
  if (pct !== null) return `${pct}%`;
  const mb = updater.downloadedBytes.value / (1024 * 1024);
  return `${mb.toFixed(1)} MB`;
});

function checkForUpdates(): void {
  void updater.checkForUpdates();
}

function restartToUpdate(): void {
  void relaunchApp();
}
</script>

<template>
  <section class="space-y-5">
    <div>
      <h1 class="text-lg font-semibold tracking-normal">
        {{ t("settings.about.title") }}
      </h1>
      <p class="mt-1 text-xs text-muted-foreground">
        {{ t("settings.about.description") }}
      </p>
    </div>

    <NCard class="nexterm-settings-group" size="small" embedded>
      <NDescriptions label-placement="left" :column="1" size="small">
        <NDescriptionsItem :label="t('settings.about.product')">
          Nexterm
        </NDescriptionsItem>
        <NDescriptionsItem :label="t('settings.about.version')">
          {{ APP_VERSION }}
        </NDescriptionsItem>
        <NDescriptionsItem :label="t('settings.about.frontend')">
          Vue 3 · Naive UI · Vite
        </NDescriptionsItem>
        <NDescriptionsItem :label="t('settings.about.runtime')">
          Tauri 2
        </NDescriptionsItem>
      </NDescriptions>
    </NCard>

    <NCard
      class="nexterm-settings-group"
      size="small"
      :title="t('settings.about.updates')"
      embedded
    >
      <NForm label-placement="left" label-width="150" size="small">
        <NFormItem :label="t('settings.about.autoCheckUpdates')">
          <div class="flex flex-col gap-1">
            <NSwitch
              :value="prefs.autoCheckUpdates"
              @update:value="prefs.updateAutoCheckUpdates"
            />
            <span class="text-[11px] text-muted-foreground">
              {{ t("settings.about.autoCheckUpdatesHint") }}
            </span>
          </div>
        </NFormItem>
        <NFormItem :label="t('settings.about.checkUpdates')">
          <div class="flex w-full flex-col gap-1.5">
            <NButton
              size="small"
              :loading="isBusy"
              data-check-updates
              @click="checkForUpdates"
            >
              <template #icon><NIcon :component="RefreshOutline" /></template>
              {{ t("settings.about.checkUpdates") }}
            </NButton>
            <div v-if="isDownloading" class="flex flex-col gap-1">
              <NProgress
                v-if="progressPct !== null"
                type="line"
                :percentage="progressPct"
                :height="6"
                :show-indicator="false"
                processing
              />
              <span class="text-[11px] text-muted-foreground">
                {{ downloadDetail }}
              </span>
            </div>
            <span class="text-[11px] text-muted-foreground">
              {{ statusLine }}
            </span>
            <NButton
              v-if="isReady"
              size="small"
              type="primary"
              data-restart-to-update
              @click="restartToUpdate"
            >
              {{ t("settings.about.restartToUpdate") }}
            </NButton>
            <span
              v-if="updater.errorMessage.value"
              class="text-[11px] text-destructive"
            >
              {{ updater.errorMessage.value }}
            </span>
          </div>
        </NFormItem>
      </NForm>
    </NCard>
  </section>
</template>
