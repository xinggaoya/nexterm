<script setup lang="ts">
import { NCard, NForm, NFormItem, NSelect, NSwitch } from "naive-ui";
import { computed } from "vue";
import { t } from "@/modules/i18n/translate";
import { usePreferencesPiniaStore } from "@/modules/settings/preferencesPinia";
import type { FileOpenMode } from "@/modules/settings/store";

const prefs = usePreferencesPiniaStore();

const fileOpenModeOptions = computed<{ label: string; value: FileOpenMode }[]>(() => [
  { label: t("settings.options.previewFirst"), value: "preview" },
  { label: t("settings.options.openPinned"), value: "pinned" },
]);
</script>

<template>
  <section class="space-y-5">
    <div>
      <h1 class="text-lg font-semibold tracking-normal">
        {{ t("settings.general.editor") }}
      </h1>
      <p class="mt-1 text-xs text-muted-foreground">
        {{ t("settings.general.editorDescription") }}
      </p>
    </div>

    <NCard class="nexterm-settings-group" size="small" :title="t('settings.general.editor')" embedded>
      <NForm label-placement="left" label-width="150" size="small">
        <NFormItem :label="t('settings.general.fileClickBehavior')">
          <NSelect
            :value="prefs.fileOpenMode"
            :options="fileOpenModeOptions"
            @update:value="(value) => prefs.updateFileOpenMode(value as FileOpenMode)"
          />
        </NFormItem>
        <NFormItem :label="t('settings.general.vimMode')">
          <NSwitch :value="prefs.vimMode" @update:value="prefs.updateVimMode" />
        </NFormItem>
      </NForm>
    </NCard>
  </section>
</template>
