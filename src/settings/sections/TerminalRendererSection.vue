<script setup lang="ts">
import {
  NCard,
  NForm,
  NFormItem,
  NRadio,
  NRadioGroup,
  NSwitch,
} from "naive-ui";
import { computed } from "vue";
import { t } from "@/modules/i18n/translate";
import { usePreferencesPiniaStore } from "@/modules/settings/preferencesPinia";

const prefs = usePreferencesPiniaStore();

const rendererOptions = computed(() => [
  { label: t("settings.general.terminalRendererWebgl"), value: "webgl" },
  { label: t("settings.general.terminalRendererDom"), value: "dom" },
]);
</script>

<template>
  <NCard size="small" :title="t('settings.general.terminal')" embedded>
    <NForm label-placement="left" label-width="180" size="small">
      <NFormItem :label="t('settings.general.terminalRendererType')">
        <NRadioGroup
          :value="prefs.terminalRenderer"
          @update:value="(value) => prefs.updateTerminalRenderer(value as 'webgl' | 'dom')"
        >
          <NRadio
            v-for="opt in rendererOptions"
            :key="opt.value"
            :value="opt.value"
          >
            {{ opt.label }}
          </NRadio>
        </NRadioGroup>
      </NFormItem>
      <NFormItem :label="t('settings.general.terminalRendererAutoFallback')">
        <NSwitch
          :value="prefs.terminalRendererAutoFallback"
          @update:value="prefs.updateTerminalRendererAutoFallback"
        />
      </NFormItem>
      <NFormItem :label="t('settings.general.webglRenderer')">
        <NSwitch
          :value="prefs.terminalWebglEnabled"
          @update:value="prefs.updateTerminalWebglEnabled"
        />
      </NFormItem>
    </NForm>
  </NCard>
</template>