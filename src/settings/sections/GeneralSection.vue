<script setup lang="ts">
import { NCard, NForm, NFormItem, NSwitch } from "naive-ui";
import { t } from "@/modules/i18n/translate";
import { usePreferencesPiniaStore } from "@/modules/settings/preferencesPinia";

const prefs = usePreferencesPiniaStore();
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

    <NCard size="small" :title="t('settings.general.startupAndWorkspace')" embedded>
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
  </section>
</template>
