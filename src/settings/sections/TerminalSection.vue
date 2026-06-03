<script setup lang="ts">
import {
  NCard,
  NForm,
  NFormItem,
  NInputNumber,
  NSelect,
  NSlider,
  NSpace,
  NSwitch,
} from "naive-ui";
import { computed } from "vue";
import { currentLocale, t } from "@/modules/i18n/translate";
import { usePreferencesPiniaStore } from "@/modules/settings/preferencesPinia";
import {
  TERMINAL_FONT_FAMILY_PRESETS,
  TERMINAL_FONT_SIZE_MAX,
  TERMINAL_FONT_SIZE_MIN,
  TERMINAL_SCROLLBACK_PRESETS,
} from "@/modules/settings/store";

const prefs = usePreferencesPiniaStore();

const terminalFontFamilyOptions = computed(() => [
  { label: t("common.autoDetect"), value: "" },
  ...TERMINAL_FONT_FAMILY_PRESETS.map((value) => ({ label: value, value })),
]);

const scrollbackOptions = computed(() =>
  TERMINAL_SCROLLBACK_PRESETS.map((value) => ({
    label: value.toLocaleString(currentLocale()),
    value,
  })),
);

const touchOptions = computed(() => [
  { label: t("settings.terminal.touchModeAuto"), value: "auto" },
  { label: t("settings.terminal.touchModeOn"), value: "on" },
  { label: t("settings.terminal.touchModeOff"), value: "off" },
]);
</script>

<template>
  <section class="space-y-5">
    <div>
      <h1 class="text-lg font-semibold tracking-normal">
        {{ t("settings.general.terminal") }}
      </h1>
      <p class="mt-1 text-xs text-muted-foreground">
        {{ t("settings.general.terminalDescription") }}
      </p>
    </div>

    <NCard size="small" :title="t('settings.general.terminal')" embedded>
      <NForm label-placement="left" label-width="150" size="small">
        <NFormItem :label="t('settings.general.webglRenderer')">
          <NSwitch
            :value="prefs.terminalWebglEnabled"
            @update:value="prefs.updateTerminalWebglEnabled"
          />
        </NFormItem>
        <NFormItem :label="t('settings.general.fontFamily')">
          <NSelect
            :value="prefs.terminalFontFamily"
            :options="terminalFontFamilyOptions"
            filterable
            @update:value="(value) => prefs.updateTerminalFontFamily(String(value ?? ''))"
          />
        </NFormItem>
        <NFormItem :label="t('settings.general.fontSize')">
          <NSpace vertical class="w-full">
            <NSlider
              :value="prefs.terminalFontSize"
              :min="TERMINAL_FONT_SIZE_MIN"
              :max="TERMINAL_FONT_SIZE_MAX"
              @update:value="prefs.updateTerminalFontSize"
            />
            <NInputNumber
              :value="prefs.terminalFontSize"
              :min="TERMINAL_FONT_SIZE_MIN"
              :max="TERMINAL_FONT_SIZE_MAX"
              @update:value="(value) => prefs.updateTerminalFontSize(value ?? 14)"
            />
          </NSpace>
        </NFormItem>
        <NFormItem :label="t('settings.general.letterSpacing')">
          <NInputNumber
            :value="prefs.terminalLetterSpacing"
            :min="-10"
            :max="10"
            @update:value="(value) => prefs.updateTerminalLetterSpacing(value ?? 0)"
          />
        </NFormItem>
        <NFormItem :label="t('settings.general.scrollback')">
          <NSelect
            :value="prefs.terminalScrollback"
            :options="scrollbackOptions"
            tag
            @update:value="(value) => prefs.updateTerminalScrollback(Number(value))"
          />
        </NFormItem>
      </NForm>
    </NCard>

    <NCard
      size="small"
      :title="t('settings.terminal.touchCard')"
      embedded
    >
      <NForm label-placement="left" label-width="150" size="small">
        <NFormItem :label="t('settings.terminal.touchMode')">
          <NSelect
            :value="prefs.touchOptimizations"
            :options="touchOptions"
            @update:value="(value) => prefs.updateTouchOptimizations(value as 'auto' | 'on' | 'off')"
          />
        </NFormItem>
      </NForm>
      <p class="mt-2 text-xs text-muted-foreground">
        {{ t("settings.terminal.touchHint") }}
      </p>
    </NCard>
  </section>
</template>
