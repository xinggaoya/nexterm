<script setup lang="ts">
import {
  NButton,
  NCard,
  NForm,
  NFormItem,
  NInputNumber,
  NSelect,
  NSlider,
  NSpace,
  NSwitch,
} from "naive-ui";
import { computed, onMounted, ref } from "vue";
import { IS_WINDOWS } from "@/lib/platform";
import { hasTauriInternals } from "@/lib/tauriRuntime";
import { native, type ShellProfileInfo } from "@/lib/native";
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

// 本地默认 Shell（Windows）：探测白名单由后端维护，前端只持有 id。
// 切换仅影响之后新开的终端，运行中的 PTY 不重启。
const shellProfiles = ref<ShellProfileInfo[]>([]);
const shellLoading = ref(false);

async function loadShellProfiles(): Promise<void> {
  if (!IS_WINDOWS || !hasTauriInternals()) return;
  shellLoading.value = true;
  try {
    shellProfiles.value = await native.shellListProfiles();
  } catch {
    shellProfiles.value = [];
  } finally {
    shellLoading.value = false;
  }
}

onMounted(() => {
  void loadShellProfiles();
});

const shellOptions = computed(() => [
  { label: t("settings.general.terminalShellAuto"), value: "auto" },
  ...shellProfiles.value.map((profile) => ({
    label: profile.name,
    value: profile.id,
  })),
]);

const selectedShellProgram = computed(() => {
  if (prefs.terminalShellId === "auto") return null;
  return (
    shellProfiles.value.find((profile) => profile.id === prefs.terminalShellId)
      ?.program ?? null
  );
});
</script>

<template>
  <NCard class="nexterm-settings-group" size="small" :title="t('settings.general.terminal')" embedded>
    <NForm label-placement="left" label-width="180" size="small">
      <NFormItem v-if="IS_WINDOWS" :label="t('settings.general.terminalShell')">
        <NSpace vertical class="w-full">
          <NSpace>
            <NSelect
              class="w-60"
              :value="prefs.terminalShellId"
              :options="shellOptions"
              @update:value="(value) => prefs.updateTerminalShellId(String(value))"
            />
            <NButton
              size="small"
              quaternary
              :loading="shellLoading"
              @click="loadShellProfiles"
            >
              {{ t("settings.general.terminalShellRescan") }}
            </NButton>
          </NSpace>
          <span class="text-xs text-muted-foreground">
            {{
              selectedShellProgram ??
              t("settings.general.terminalShellAutoHint")
            }}
            · {{ t("settings.general.terminalShellHint") }}
          </span>
        </NSpace>
      </NFormItem>
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
