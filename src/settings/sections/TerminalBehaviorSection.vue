<script setup lang="ts">
import {
  NCard,
  NForm,
  NFormItem,
  NInputNumber,
  NSelect,
  NSlider,
  NSwitch,
} from "naive-ui";
import { computed } from "vue";
import { currentLocale, t } from "@/modules/i18n/translate";
import { usePreferencesPiniaStore } from "@/modules/settings/preferencesPinia";
import {
  TERMINAL_FAST_SCROLL_MODIFIER_VALUES,
  TERMINAL_SCROLLBACK_PRESETS,
} from "@/modules/settings/store";

const prefs = usePreferencesPiniaStore();

const scrollbackOptions = computed(() =>
  TERMINAL_SCROLLBACK_PRESETS.map((value) => ({
    label: value.toLocaleString(currentLocale()),
    value,
  })),
);

const fastScrollModifierOptions = computed(() =>
  TERMINAL_FAST_SCROLL_MODIFIER_VALUES.map((value) => ({
    label: value,
    value,
  })),
);
</script>

<template>
  <NCard class="nexterm-settings-group" size="small" :title="t('settings.general.terminal')" embedded>
    <NForm label-placement="left" label-width="180" size="small">
      <NFormItem :label="t('settings.general.scrollback')">
        <NSelect
          :value="prefs.terminalScrollback"
          :options="scrollbackOptions"
          tag
          @update:value="(value) => prefs.updateTerminalScrollback(Number(value))"
        />
      </NFormItem>
      <NFormItem :label="t('settings.general.terminalFastScrollSensitivity')">
        <NSpace vertical class="w-full">
          <NSlider
            :value="prefs.terminalFastScrollSensitivity"
            :min="1"
            :max="20"
            @update:value="prefs.updateTerminalFastScrollSensitivity"
          />
          <NInputNumber
            :value="prefs.terminalFastScrollSensitivity"
            :min="1"
            :max="20"
            @update:value="(value) => prefs.updateTerminalFastScrollSensitivity(value ?? 5)"
          />
        </NSpace>
      </NFormItem>
      <NFormItem :label="t('settings.general.terminalFastScrollModifier')">
        <NSelect
          :value="prefs.terminalFastScrollModifier"
          :options="fastScrollModifierOptions"
          @update:value="(value) => prefs.updateTerminalFastScrollModifier(value as 'alt' | 'ctrl' | 'shift')"
        />
      </NFormItem>
      <NFormItem :label="t('settings.general.terminalMacOptionIsMeta')">
        <NSwitch
          :value="prefs.terminalMacOptionIsMeta"
          @update:value="prefs.updateTerminalMacOptionIsMeta"
        />
      </NFormItem>
      <NFormItem :label="t('settings.general.terminalMacOptionClickForcesSelection')">
        <NSwitch
          :value="prefs.terminalMacOptionClickForcesSelection"
          @update:value="prefs.updateTerminalMacOptionClickForcesSelection"
        />
      </NFormItem>
      <NFormItem :label="t('settings.general.terminalOscHyperlink')">
        <NSwitch
          :value="prefs.terminalOscHyperlink"
          @update:value="prefs.updateTerminalOscHyperlink"
        />
      </NFormItem>
      <NFormItem :label="t('settings.general.terminalDrawBoldTextInBrightColors')">
        <NSwitch
          :value="prefs.terminalDrawBoldTextInBrightColors"
          @update:value="prefs.updateTerminalDrawBoldTextInBrightColors"
        />
      </NFormItem>
      <NFormItem :label="t('settings.general.terminalCustomGlyphs')">
        <NSwitch
          :value="prefs.terminalCustomGlyphs"
          @update:value="prefs.updateTerminalCustomGlyphs"
        />
      </NFormItem>
      <NFormItem :label="t('settings.general.terminalRescaleOverlappingGlyphs')">
        <NSwitch
          :value="prefs.terminalRescaleOverlappingGlyphs"
          @update:value="prefs.updateTerminalRescaleOverlappingGlyphs"
        />
      </NFormItem>
      <NFormItem :label="t('settings.general.terminalContextMenu')">
        <NSwitch
          :value="prefs.terminalContextMenuEnabled"
          @update:value="prefs.updateTerminalContextMenuEnabled"
        />
      </NFormItem>
      <NFormItem :label="t('settings.general.terminalNotifications')">
        <NSwitch
          :value="prefs.terminalNotificationEnabled"
          @update:value="prefs.updateTerminalNotificationEnabled"
        />
      </NFormItem>
      <NFormItem :label="t('settings.general.terminalNotificationSound')">
        <NSwitch
          :value="prefs.terminalNotificationSoundEnabled"
          @update:value="prefs.updateTerminalNotificationSoundEnabled"
        />
      </NFormItem>
    </NForm>
  </NCard>
</template>
