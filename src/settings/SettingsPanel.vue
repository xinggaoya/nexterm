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
import { NButton, NIcon, NMenu, type MenuOption } from "naive-ui";
import { computed, h, ref, type Component } from "vue";
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

const menuOptions = computed<MenuOption[]>(() =>
  tabs.map((tab) => ({
    key: tab.id,
    label: t(tab.labelKey),
    icon: () => h(NIcon, null, { default: () => h(tab.icon) }),
  })),
);

function renderMenuLabel(option: MenuOption) {
  // The key carries the settings tab id — use it to emit the data attribute
  // for the existing test selectors without expanding the MenuOption shape.
  const tabKey = String(option.key ?? "");
  return h(
    "span",
    {
      "data-settings-tab": tabKey,
      class: "truncate",
    },
    String(option.label ?? ""),
  );
}
</script>

<template>
  <section
    data-settings-panel
    class="flex h-full min-h-0 flex-col bg-card text-foreground select-none"
  >
    <header class="nexterm-toolbar flex h-12 shrink-0 items-center gap-3 px-4">
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
        class="no-scrollbar shrink-0 overflow-x-auto border-b border-border bg-sidebar px-2 py-2 sm:w-44 sm:overflow-y-auto sm:border-r sm:border-b-0 sm:py-3"
      >
        <NMenu
          :value="selectedTab"
          :options="menuOptions"
          :render-label="renderMenuLabel"
          :indent="18"
          @update:value="(key: string) => selectTab(key as SettingsTab)"
        />
      </aside>

      <main class="no-scrollbar min-h-0 flex-1 overflow-y-auto px-5 pt-5 pb-6">
        <div class="mx-auto w-full max-w-180" :data-settings-section="selectedTab">
          <component :is="activeSection" />
        </div>
      </main>
    </div>
  </section>
</template>