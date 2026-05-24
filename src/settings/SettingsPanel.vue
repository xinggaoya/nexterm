<script setup lang="ts">
import {
  CloseOutline,
  CodeSlashOutline,
  ColorPaletteOutline,
  InformationCircleOutline,
  KeypadOutline,
  OptionsOutline,
  TerminalOutline,
} from "@vicons/ionicons5";
import { NButton, NIcon } from "naive-ui";
import { computed, ref, type Component } from "vue";
import TooltipTitle from "@/components/TooltipTitle.vue";
import {
  SETTINGS_DEFAULT_TAB,
  normalizeSettingsTab,
  type SettingsTab,
} from "@/modules/settings/tabs";
import { t } from "@/modules/i18n/translate";
import AboutSection from "./sections/AboutSection.vue";
import AppearanceSection from "./sections/AppearanceSection.vue";
import EditorSection from "./sections/EditorSection.vue";
import GeneralSection from "./sections/GeneralSection.vue";
import KeybindingsSection from "./sections/KeybindingsSection.vue";
import TerminalSection from "./sections/TerminalSection.vue";

const props = withDefaults(
  defineProps<{
    activeTab?: SettingsTab;
    showClose?: boolean;
  }>(),
  {
    showClose: false,
  },
);

const emit = defineEmits<{
  "update:activeTab": [tab: SettingsTab];
  close: [];
}>();

const tabs: {
  id: SettingsTab;
  labelKey: string;
  icon: Component;
}[] = [
  { id: "general", labelKey: "settings.tabs.general", icon: OptionsOutline },
  {
    id: "appearance",
    labelKey: "settings.tabs.appearance",
    icon: ColorPaletteOutline,
  },
  { id: "editor", labelKey: "settings.tabs.editor", icon: CodeSlashOutline },
  { id: "terminal", labelKey: "settings.tabs.terminal", icon: TerminalOutline },
  {
    id: "keybindings",
    labelKey: "settings.tabs.keybindings",
    icon: KeypadOutline,
  },
  {
    id: "about",
    labelKey: "settings.tabs.about",
    icon: InformationCircleOutline,
  },
];

const sections: Record<SettingsTab, Component> = {
  general: GeneralSection,
  appearance: AppearanceSection,
  editor: EditorSection,
  terminal: TerminalSection,
  keybindings: KeybindingsSection,
  about: AboutSection,
};

const fallbackTab = ref<SettingsTab>(SETTINGS_DEFAULT_TAB);
const selectedTab = computed(() =>
  normalizeSettingsTab(props.activeTab ?? fallbackTab.value),
);
const activeSection = computed(() => sections[selectedTab.value]);

function selectTab(tab: SettingsTab) {
  fallbackTab.value = tab;
  emit("update:activeTab", tab);
}
</script>

<template>
  <section
    data-settings-panel
    class="flex h-full min-h-0 flex-col bg-background text-foreground select-none"
  >
    <header class="flex h-13 shrink-0 items-center gap-3 border-b border-border/60 px-4">
      <div class="min-w-0 flex-1">
        <h2 class="truncate text-sm font-semibold tracking-normal">
          {{ t("settings.panel.title") }}
        </h2>
      </div>
      <TooltipTitle v-if="showClose" :label="t('settings.panel.close')">
        <NButton
          data-close-settings
          size="tiny"
          quaternary
          :aria-label="t('settings.panel.close')"
          @click="emit('close')"
        >
          <template #icon><NIcon :component="CloseOutline" /></template>
        </NButton>
      </TooltipTitle>
    </header>

    <div class="min-h-0 flex-1 sm:flex">
      <aside
        class="no-scrollbar shrink-0 overflow-x-auto border-b border-border/60 px-3 py-2 sm:w-46 sm:overflow-y-auto sm:border-r sm:border-b-0 sm:py-3"
      >
        <nav class="flex gap-1 sm:flex-col" aria-label="Settings sections">
          <button
            v-for="tab in tabs"
            :key="tab.id"
            type="button"
            :data-settings-tab="tab.id"
            :aria-pressed="selectedTab === tab.id"
            :class="[
              'inline-flex h-8 shrink-0 items-center gap-2 rounded-md px-2.5 text-xs font-medium transition-colors sm:w-full',
              selectedTab === tab.id
                ? 'bg-muted text-foreground'
                : 'text-muted-foreground hover:bg-muted/60 hover:text-foreground',
            ]"
            @click="selectTab(tab.id)"
          >
            <NIcon :component="tab.icon" :size="14" />
            <span class="truncate">{{ t(tab.labelKey) }}</span>
          </button>
        </nav>
      </aside>

      <main class="no-scrollbar min-h-0 flex-1 overflow-y-auto px-5 pt-5 pb-6">
        <div class="mx-auto w-full max-w-180" :data-settings-section="selectedTab">
          <component :is="activeSection" />
        </div>
      </main>
    </div>
  </section>
</template>
