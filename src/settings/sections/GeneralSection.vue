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
  EDITOR_THEME_LABELS,
  EDITOR_THEMES,
  TERMINAL_FONT_FAMILY_PRESETS,
  TERMINAL_FONT_SIZE_MAX,
  TERMINAL_FONT_SIZE_MIN,
  TERMINAL_SCROLLBACK_PRESETS,
  type EditorThemeId,
  type FileOpenMode,
  type LanguagePref,
  type ThemePref,
} from "@/modules/settings/store";

const prefs = usePreferencesPiniaStore();

const themeOptions = computed<{ label: string; value: ThemePref }[]>(() => [
  { label: t("settings.options.system"), value: "system" },
  { label: t("settings.options.light"), value: "light" },
  { label: t("settings.options.dark"), value: "dark" },
]);

const languageOptions = computed<{ label: string; value: LanguagePref }[]>(() => [
  { label: t("settings.options.system"), value: "system" },
  { label: t("settings.options.zhCN"), value: "zh-CN" },
  { label: t("settings.options.enUS"), value: "en-US" },
]);

const editorThemeOptions = EDITOR_THEMES.map((value) => ({
  label: EDITOR_THEME_LABELS[value],
  value,
}));

const fileOpenModeOptions = computed<{ label: string; value: FileOpenMode }[]>(() => [
  { label: t("settings.options.previewFirst"), value: "preview" },
  { label: t("settings.options.openPinned"), value: "pinned" },
]);

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

    <NCard size="small" :title="t('settings.general.appearance')" embedded>
      <NForm label-placement="left" label-width="150" size="small">
        <NFormItem :label="t('settings.general.theme')">
          <NSelect
            :value="prefs.theme"
            :options="themeOptions"
            @update:value="(value) => prefs.updateTheme(value as ThemePref)"
          />
        </NFormItem>
        <NFormItem :label="t('settings.general.language')">
          <NSelect
            :value="prefs.language"
            :options="languageOptions"
            @update:value="(value) => prefs.updateLanguage(value as LanguagePref)"
          />
        </NFormItem>
        <NFormItem :label="t('settings.general.editorTheme')">
          <NSelect
            :value="prefs.editorTheme"
            :options="editorThemeOptions"
            @update:value="(value) => prefs.updateEditorTheme(value as EditorThemeId)"
          />
        </NFormItem>
      </NForm>
    </NCard>

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

    <NCard size="small" :title="t('settings.general.editor')" embedded>
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
  </section>
</template>
