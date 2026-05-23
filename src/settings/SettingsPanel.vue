<script setup lang="ts">
import {
  CloseOutline,
  InformationCircleOutline,
  SettingsOutline,
} from "@vicons/ionicons5";
import { NButton, NIcon } from "naive-ui";
import { computed, ref } from "vue";
import TooltipTitle from "@/components/TooltipTitle.vue";
import {
  SETTINGS_DEFAULT_TAB,
  normalizeSettingsTab,
  type SettingsTab,
} from "@/modules/settings/tabs";
import { t } from "@/modules/i18n/translate";
import AboutSection from "./sections/AboutSection.vue";
import GeneralSection from "./sections/GeneralSection.vue";

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
  icon: typeof SettingsOutline;
}[] = [
  { id: "general", labelKey: "settings.tabs.general", icon: SettingsOutline },
  { id: "about", labelKey: "settings.tabs.about", icon: InformationCircleOutline },
];

const fallbackTab = ref<SettingsTab>(SETTINGS_DEFAULT_TAB);
const selectedTab = computed(() =>
  normalizeSettingsTab(props.activeTab ?? fallbackTab.value),
);
const activeSection = computed(() =>
  selectedTab.value === "about" ? AboutSection : GeneralSection,
);

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
      <div class="flex h-7 items-center gap-1 rounded-lg bg-muted/55 p-0.5">
        <button
          v-for="tab in tabs"
          :key="tab.id"
          type="button"
          :data-settings-tab="tab.id"
          :aria-pressed="selectedTab === tab.id"
          :class="[
            'inline-flex h-6 items-center gap-1.5 rounded-md px-2.5 text-[11.5px] font-medium transition-colors',
            selectedTab === tab.id
              ? 'bg-background text-foreground shadow-sm'
              : 'text-muted-foreground hover:text-foreground',
          ]"
          @click="selectTab(tab.id)"
        >
          <NIcon :component="tab.icon" :size="13" />
          <span>{{ t(tab.labelKey) }}</span>
        </button>
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

    <main class="no-scrollbar min-h-0 flex-1 overflow-y-auto px-6 pt-5 pb-6">
      <div class="mx-auto w-full max-w-160" :data-settings-section="selectedTab">
        <component :is="activeSection" />
      </div>
    </main>
  </section>
</template>
