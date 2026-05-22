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
  type ThemePref,
} from "@/modules/settings/store";

const prefs = usePreferencesPiniaStore();

const themeOptions: { label: string; value: ThemePref }[] = [
  { label: "System", value: "system" },
  { label: "Light", value: "light" },
  { label: "Dark", value: "dark" },
];

const editorThemeOptions = EDITOR_THEMES.map((value) => ({
  label: EDITOR_THEME_LABELS[value],
  value,
}));

const fileOpenModeOptions: { label: string; value: FileOpenMode }[] = [
  { label: "Preview first", value: "preview" },
  { label: "Open pinned", value: "pinned" },
];

const terminalFontFamilyOptions = [
  { label: "Auto detect", value: "" },
  ...TERMINAL_FONT_FAMILY_PRESETS.map((value) => ({ label: value, value })),
];

const scrollbackOptions = computed(() =>
  TERMINAL_SCROLLBACK_PRESETS.map((value) => ({ label: value.toLocaleString(), value })),
);
</script>

<template>
  <section class="space-y-5">
    <div>
      <h1 class="text-lg font-semibold tracking-normal">General</h1>
      <p class="mt-1 text-xs text-muted-foreground">
        Appearance, startup, editor, and terminal defaults.
      </p>
    </div>

    <NCard size="small" title="Appearance" embedded>
      <NForm label-placement="left" label-width="150" size="small">
        <NFormItem label="Theme">
          <NSelect
            :value="prefs.theme"
            :options="themeOptions"
            @update:value="(value) => prefs.updateTheme(value as ThemePref)"
          />
        </NFormItem>
        <NFormItem label="Editor theme">
          <NSelect
            :value="prefs.editorTheme"
            :options="editorThemeOptions"
            @update:value="(value) => prefs.updateEditorTheme(value as EditorThemeId)"
          />
        </NFormItem>
      </NForm>
    </NCard>

    <NCard size="small" title="Startup and workspace" embedded>
      <NForm label-placement="left" label-width="150" size="small">
        <NFormItem label="Autostart">
          <NSwitch
            :value="prefs.autostart"
            @update:value="prefs.updateAutostart"
          />
        </NFormItem>
        <NFormItem label="Restore window">
          <NSwitch
            :value="prefs.restoreWindowState"
            @update:value="prefs.updateRestoreWindowState"
          />
        </NFormItem>
        <NFormItem label="Show hidden files">
          <NSwitch
            :value="prefs.showHidden"
            @update:value="prefs.updateShowHidden"
          />
        </NFormItem>
      </NForm>
    </NCard>

    <NCard size="small" title="Editor" embedded>
      <NForm label-placement="left" label-width="150" size="small">
        <NFormItem label="File click behavior">
          <NSelect
            :value="prefs.fileOpenMode"
            :options="fileOpenModeOptions"
            @update:value="(value) => prefs.updateFileOpenMode(value as FileOpenMode)"
          />
        </NFormItem>
        <NFormItem label="Vim mode">
          <NSwitch :value="prefs.vimMode" @update:value="prefs.updateVimMode" />
        </NFormItem>
      </NForm>
    </NCard>

    <NCard size="small" title="Terminal" embedded>
      <NForm label-placement="left" label-width="150" size="small">
        <NFormItem label="WebGL renderer">
          <NSwitch
            :value="prefs.terminalWebglEnabled"
            @update:value="prefs.updateTerminalWebglEnabled"
          />
        </NFormItem>
        <NFormItem label="Font family">
          <NSelect
            :value="prefs.terminalFontFamily"
            :options="terminalFontFamilyOptions"
            filterable
            @update:value="(value) => prefs.updateTerminalFontFamily(String(value ?? ''))"
          />
        </NFormItem>
        <NFormItem label="Font size">
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
        <NFormItem label="Letter spacing">
          <NInputNumber
            :value="prefs.terminalLetterSpacing"
            :min="-10"
            :max="10"
            @update:value="(value) => prefs.updateTerminalLetterSpacing(value ?? 0)"
          />
        </NFormItem>
        <NFormItem label="Scrollback">
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
