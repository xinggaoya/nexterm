<script setup lang="ts">
import { NCard, NForm, NFormItem, NSelect } from "naive-ui";
import { computed } from "vue";
import { t } from "@/modules/i18n/translate";
import { usePreferencesPiniaStore } from "@/modules/settings/preferencesPinia";
import {
  ACCENT_PRESETS,
  ACCENT_PRESET_LABELS,
  ACCENT_PRESET_SWATCHES,
  EDITOR_THEME_LABELS,
  EDITOR_THEMES,
  type AccentPref,
  type EditorThemeId,
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

const accentOptions = computed<
  {
    value: AccentPref;
    label: string;
    swatch: { light: string; dark: string };
  }[]
>(() =>
  ACCENT_PRESETS.map((value) => ({
    value,
    label: ACCENT_PRESET_LABELS[value],
    swatch: ACCENT_PRESET_SWATCHES[value],
  })),
);

</script>

<template>
  <section class="space-y-5">
    <div>
      <h1 class="text-lg font-semibold tracking-normal">
        {{ t("settings.general.appearance") }}
      </h1>
      <p class="mt-1 text-xs text-muted-foreground">
        {{ t("settings.general.appearanceDescription") }}
      </p>
    </div>

    <NCard
      class="nexterm-settings-group"
      size="small"
      :title="t('settings.general.accent')"
      embedded
    >
      <p class="mb-3 text-xs text-muted-foreground">
        {{ t("settings.general.accentDescription") }}
      </p>
      <div class="grid grid-cols-3 gap-2 sm:grid-cols-6">
        <button
          v-for="opt in accentOptions"
          :key="opt.value"
          type="button"
          :data-testid="`accent-${opt.value}`"
          :aria-pressed="prefs.accent === opt.value"
          class="flex flex-col items-center gap-1.5 rounded-md border border-border bg-card p-2 transition hover:border-primary"
          :class="prefs.accent === opt.value && 'border-primary ring-2 ring-primary'"
          @click="prefs.updateAccent(opt.value)"
        >
          <div class="flex gap-1">
            <span
              class="h-5 w-5 rounded-full border border-border/60"
              :style="{ background: opt.swatch.light }"
              :aria-label="t('settings.options.light')"
            />
            <span
              class="h-5 w-5 rounded-full border border-border/60"
              :style="{ background: opt.swatch.dark }"
              :aria-label="t('settings.options.dark')"
            />
          </div>
          <span class="text-[11px] text-muted-foreground">{{ opt.label }}</span>
        </button>
      </div>
    </NCard>

    <NCard class="nexterm-settings-group" size="small" :title="t('settings.general.appearance')" embedded>
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
  </section>
</template>