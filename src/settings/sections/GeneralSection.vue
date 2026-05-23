<script setup lang="ts">
import {
  NCard,
  NButton,
  NForm,
  NFormItem,
  NInputNumber,
  NSelect,
  NSlider,
  NSpace,
  NSwitch,
} from "naive-ui";
import { computed, onMounted, ref } from "vue";
import { hasTauriInternals } from "@/lib/tauriRuntime";
import { currentLocale, t } from "@/modules/i18n/translate";
import {
  remoteTerminalStatus,
  type RemoteServiceStatus,
} from "@/modules/remote/remoteNative";
import {
  ensureRemoteTerminalToken,
  syncRemoteTerminalService,
} from "@/modules/remote/remoteService";
import {
  buildRemoteAccessUrl,
  redactRemoteToken,
  remoteHostFromUrl,
} from "@/modules/remote/remoteUrl";
import { usePreferencesPiniaStore } from "@/modules/settings/preferencesPinia";
import {
  EDITOR_THEME_LABELS,
  EDITOR_THEMES,
  REMOTE_TERMINAL_PORT_DEFAULT,
  TERMINAL_FONT_FAMILY_PRESETS,
  TERMINAL_FONT_SIZE_MAX,
  TERMINAL_FONT_SIZE_MIN,
  TERMINAL_SCROLLBACK_PRESETS,
  type EditorThemeId,
  type FileOpenMode,
  type LanguagePref,
  type ThemePref,
} from "@/modules/settings/store";
import KeybindingsSection from "./KeybindingsSection.vue";

const prefs = usePreferencesPiniaStore();
const remoteBusy = ref(false);
const remoteStatus = ref<RemoteServiceStatus | null>(null);
const remoteError = ref<string | null>(null);

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

const remoteAccessUrl = computed(() =>
  prefs.remoteTerminalToken && remoteStatus.value?.enabled
    ? buildRemoteAccessUrl({
        host: remoteHostFromUrl(remoteStatus.value.url) ?? "127.0.0.1",
        port: remoteStatus.value.port ?? prefs.remoteTerminalPort,
        token: prefs.remoteTerminalToken,
      })
    : "",
);

const remoteAccessUrlLabel = computed(() =>
  prefs.remoteTerminalToken && remoteStatus.value?.enabled
    ? buildRemoteAccessUrl({
        host: remoteHostFromUrl(remoteStatus.value.url) ?? "127.0.0.1",
        port: remoteStatus.value.port ?? prefs.remoteTerminalPort,
        token: redactRemoteToken(prefs.remoteTerminalToken),
      })
    : "",
);

const remoteTokenLabel = computed(() =>
  prefs.remoteTerminalToken
    ? redactRemoteToken(prefs.remoteTerminalToken)
    : t("settings.general.remoteTokenEmpty"),
);

async function refreshRemoteStatus() {
  if (!hasTauriInternals()) return;
  remoteStatus.value = await remoteTerminalStatus().catch(() => null);
}

async function updateRemoteEnabled(enabled: boolean) {
  remoteBusy.value = true;
  remoteError.value = null;
  try {
    if (enabled) await ensureRemoteTerminalToken(prefs);
    await prefs.updateRemoteTerminalEnabled(enabled);
    remoteStatus.value = await syncRemoteTerminalService(prefs);
  } catch (error) {
    remoteError.value = String(error);
    await prefs.updateRemoteTerminalEnabled(false);
  } finally {
    remoteBusy.value = false;
  }
}

async function updateRemotePort(value: number | null) {
  await prefs.updateRemoteTerminalPort(value ?? REMOTE_TERMINAL_PORT_DEFAULT);
  if (prefs.remoteTerminalEnabled) {
    await updateRemoteEnabled(true);
  }
}

async function refreshRemoteToken() {
  remoteBusy.value = true;
  remoteError.value = null;
  try {
    await prefs.updateRemoteTerminalToken("");
    await ensureRemoteTerminalToken(prefs);
    if (prefs.remoteTerminalEnabled) {
      remoteStatus.value = await syncRemoteTerminalService(prefs);
    }
  } catch (error) {
    remoteError.value = String(error);
  } finally {
    remoteBusy.value = false;
  }
}

async function copyRemoteUrl() {
  if (!remoteAccessUrl.value || !navigator.clipboard) return;
  await navigator.clipboard.writeText(remoteAccessUrl.value).catch(() => {});
}

onMounted(() => {
  void refreshRemoteStatus();
});
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

    <KeybindingsSection />

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
        <NFormItem :label="t('settings.general.remoteTerminal')">
          <div class="flex w-full flex-col gap-3">
            <div class="flex items-center justify-between gap-3">
              <div class="min-w-0">
                <div class="text-xs font-medium text-foreground">
                  {{ t("settings.general.remoteLocalhostAccess") }}
                </div>
                <div class="mt-0.5 text-[11px] leading-4 text-muted-foreground">
                  {{ t("settings.general.remoteLocalhostHint") }}
                </div>
              </div>
              <NSwitch
                :value="prefs.remoteTerminalEnabled"
                :loading="remoteBusy"
                @update:value="updateRemoteEnabled"
              />
            </div>

            <div class="grid grid-cols-[96px_minmax(0,1fr)] items-center gap-x-3 gap-y-2 text-xs">
              <span class="text-muted-foreground">
                {{ t("settings.general.remotePort") }}
              </span>
              <NInputNumber
                :value="prefs.remoteTerminalPort"
                :min="1"
                :max="65535"
                size="tiny"
                :disabled="remoteBusy"
                @update:value="updateRemotePort"
              />
              <span class="text-muted-foreground">
                {{ t("settings.general.remoteToken") }}
              </span>
              <div class="flex min-w-0 items-center gap-2">
                <code class="min-w-0 truncate rounded bg-muted px-2 py-1 text-[11px] text-foreground">
                  {{ remoteTokenLabel }}
                </code>
                <NButton size="tiny" secondary :loading="remoteBusy" @click="refreshRemoteToken">
                  {{ t("settings.general.remoteRefreshToken") }}
                </NButton>
              </div>
              <span class="text-muted-foreground">
                {{ t("settings.general.remoteUrl") }}
              </span>
              <div class="flex min-w-0 items-center gap-2">
                <code class="min-w-0 flex-1 truncate rounded bg-muted px-2 py-1 text-[11px] text-foreground">
                  {{ remoteAccessUrlLabel || t("settings.general.remoteUrlUnavailable") }}
                </code>
                <NButton
                  size="tiny"
                  secondary
                  :disabled="!remoteAccessUrl"
                  @click="copyRemoteUrl"
                >
                  {{ t("settings.general.remoteCopyUrl") }}
                </NButton>
              </div>
            </div>

            <p
              v-if="remoteError"
              class="rounded border border-destructive/25 bg-destructive/10 px-2 py-1.5 text-[11px] text-destructive"
            >
              {{ remoteError }}
            </p>
            <p v-else class="text-[11px] text-muted-foreground">
              {{
                remoteStatus?.enabled
                  ? t("settings.general.remoteRunning")
                  : t("settings.general.remoteStopped")
              }}
            </p>
          </div>
        </NFormItem>
      </NForm>
    </NCard>
  </section>
</template>
