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
import { t } from "@/modules/i18n/translate";
import { usePreferencesPiniaStore } from "@/modules/settings/preferencesPinia";
import {
  TERMINAL_CURSOR_INACTIVE_VALUES,
  TERMINAL_CURSOR_VALUES,
  TERMINAL_FONT_FAMILY_PRESETS,
  TERMINAL_FONT_SIZE_MAX,
  TERMINAL_FONT_SIZE_MIN,
  TERMINAL_FONT_WEIGHTS,
} from "@/modules/settings/store";

const prefs = usePreferencesPiniaStore();

const terminalFontFamilyOptions = computed(() => [
  { label: t("common.autoDetect"), value: "" },
  ...TERMINAL_FONT_FAMILY_PRESETS.map((value) => ({ label: value, value })),
]);

const cursorStyleOptions = computed(() =>
  TERMINAL_CURSOR_VALUES.map((value) => ({ label: value, value })),
);

const cursorInactiveOptions = computed(() =>
  TERMINAL_CURSOR_INACTIVE_VALUES.map((value) => ({ label: value, value })),
);

const fontWeightOptions = computed(() =>
  TERMINAL_FONT_WEIGHTS.map((value) => ({
    label: String(value),
    value,
  })),
);
</script>

<template>
  <NCard size="small" :title="t('settings.general.terminal')" embedded>
    <NForm label-placement="left" label-width="160" size="small">
      <NFormItem :label="t('settings.general.fontFamily')">
        <NSelect
          :value="prefs.terminalFontFamily"
          :options="terminalFontFamilyOptions"
          filterable
          @update:value="(value) => prefs.updateTerminalFontFamily(String(value ?? ''))"
        />
      </NFormItem>
      <NFormItem :label="t('settings.general.terminalFontLayersNerd')">
        <NSwitch
          :value="prefs.terminalNerdFontEnabled"
          @update:value="prefs.updateTerminalNerdFontEnabled"
        />
      </NFormItem>
      <NFormItem :label="t('settings.general.terminalFontLayersCjk')">
        <NSwitch
          :value="prefs.terminalCjkFontEnabled"
          @update:value="prefs.updateTerminalCjkFontEnabled"
        />
      </NFormItem>
      <NFormItem :label="t('settings.general.terminalFontLayersEmoji')">
        <NSwitch
          :value="prefs.terminalEmojiFontEnabled"
          @update:value="prefs.updateTerminalEmojiFontEnabled"
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
      <NFormItem :label="t('settings.general.terminalFontWeight')">
        <NSelect
          :value="prefs.terminalFontWeight"
          :options="fontWeightOptions"
          @update:value="(value) => prefs.updateTerminalFontWeight(Number(value))"
        />
      </NFormItem>
      <NFormItem :label="t('settings.general.terminalFontWeightBold')">
        <NSelect
          :value="prefs.terminalFontWeightBold"
          :options="fontWeightOptions"
          @update:value="(value) => prefs.updateTerminalFontWeightBold(Number(value))"
        />
      </NFormItem>
      <NFormItem :label="t('settings.general.letterSpacing')">
        <NSlider
          :value="prefs.terminalLetterSpacing"
          :min="-10"
          :max="10"
          :step="1"
          @update:value="prefs.updateTerminalLetterSpacing"
        />
      </NFormItem>
      <NFormItem :label="t('settings.general.terminalCursorStyle')">
        <NSelect
          :value="prefs.terminalCursorStyle"
          :options="cursorStyleOptions"
          @update:value="(value) => prefs.updateTerminalCursorStyle(value as 'block' | 'underline' | 'bar')"
        />
      </NFormItem>
      <NFormItem :label="t('settings.general.terminalCursorBlink')">
        <NSwitch
          :value="prefs.terminalCursorBlink"
          @update:value="prefs.updateTerminalCursorBlink"
        />
      </NFormItem>
      <NFormItem :label="t('settings.general.terminalCursorInactiveStyle')">
        <NSelect
          :value="prefs.terminalCursorInactiveStyle"
          :options="cursorInactiveOptions"
          @update:value="(value) => prefs.updateTerminalCursorInactiveStyle(value as 'outline' | 'block' | 'bar' | 'underline' | 'none')"
        />
      </NFormItem>
      <NFormItem :label="t('settings.general.terminalMinimumContrastRatio')">
        <NSpace vertical class="w-full">
          <NSlider
            :value="prefs.terminalMinimumContrastRatio"
            :min="1"
            :max="21"
            :step="0.5"
            @update:value="prefs.updateTerminalMinimumContrastRatio"
          />
          <span class="text-xs text-muted-foreground">
            {{ prefs.terminalMinimumContrastRatio.toFixed(1) }}
          </span>
        </NSpace>
      </NFormItem>
    </NForm>
  </NCard>
</template>