<script setup lang="ts">
import {
  InformationCircleOutline,
  KeypadOutline,
  PeopleOutline,
  SettingsOutline,
  SparklesOutline,
} from "@vicons/ionicons5";
import {
  NConfigProvider,
  NDialogProvider,
  NIcon,
  NMessageProvider,
  NNotificationProvider,
} from "naive-ui";
import { computed, nextTick, onMounted, onUnmounted, ref, watch } from "vue";
import { RouterView, useRoute, useRouter } from "vue-router";
import WindowControls from "@/components/WindowControls.vue";
import { IS_MAC, USE_CUSTOM_WINDOW_CONTROLS } from "@/lib/platform";
import { hasTauriInternals } from "@/lib/tauriRuntime";
import { usePreferencesPiniaStore } from "@/modules/settings/preferencesPinia";
import { buildNaiveThemeOverrides, getNaiveTheme } from "@/modules/theme/naiveTheme";
import { readAppTokens } from "@/styles/tokens";
import { SETTINGS_TABS, type SettingsTab } from "./routing";

const route = useRoute();
const router = useRouter();
const prefs = usePreferencesPiniaStore();
const colorSchemeQuery =
  typeof window.matchMedia === "function"
    ? window.matchMedia("(prefers-color-scheme: dark)")
    : null;
const systemDark = ref(colorSchemeQuery?.matches ?? true);
const themeOverrides = ref(buildNaiveThemeOverrides(readFallbackTokens()));
const activeTab = computed(() => route.name?.toString() ?? "general");
const colorSchemeListener = (event: MediaQueryListEvent) => {
  systemDark.value = event.matches;
};

const tabs: {
  id: SettingsTab;
  label: string;
  icon: typeof SettingsOutline;
}[] = [
  { id: "general", label: "General", icon: SettingsOutline },
  { id: "shortcuts", label: "Shortcuts", icon: KeypadOutline },
  { id: "models", label: "Models", icon: SparklesOutline },
  { id: "agents", label: "Agents", icon: PeopleOutline },
  { id: "about", label: "About", icon: InformationCircleOutline },
];

const resolvedTheme = computed(() => {
  if (prefs.theme === "system") return systemDark.value ? "dark" : "light";
  return prefs.theme;
});

const naiveTheme = computed(() => getNaiveTheme(resolvedTheme.value));

function readFallbackTokens() {
  return {
    background: "rgb(255, 255, 255)",
    foreground: "rgb(24, 24, 27)",
    card: "rgb(255, 255, 255)",
    muted: "rgb(244, 244, 245)",
    "muted-foreground": "rgb(113, 113, 122)",
    accent: "rgb(244, 244, 245)",
    "accent-foreground": "rgb(24, 24, 27)",
    border: "rgb(228, 228, 231)",
    primary: "rgb(24, 24, 27)",
    destructive: "rgb(239, 68, 68)",
    ring: "rgb(161, 161, 170)",
  };
}

function syncDocumentTheme() {
  const root = document.documentElement;
  root.classList.remove("light", "dark");
  root.classList.add(resolvedTheme.value);
  try {
    window.localStorage.setItem("nexterm-ui-theme-shadow", prefs.theme);
  } catch {
    // ignore private storage failures
  }
  void nextTick(() => {
    requestAnimationFrame(() => {
      themeOverrides.value = buildNaiveThemeOverrides(readAppTokens());
    });
  });
}

function selectTab(value: string) {
  if ((SETTINGS_TABS as string[]).includes(value)) {
    void router.push(`/${value}`);
  }
}

onMounted(() => {
  if (hasTauriInternals()) void prefs.hydrate();
  colorSchemeQuery?.addEventListener("change", colorSchemeListener);
});

onUnmounted(() => {
  colorSchemeQuery?.removeEventListener("change", colorSchemeListener);
});

watch(resolvedTheme, syncDocumentTheme, { immediate: true });
</script>

<template>
  <NConfigProvider :theme="naiveTheme" :theme-overrides="themeOverrides">
    <NDialogProvider>
      <NMessageProvider>
        <NNotificationProvider>
          <div class="flex h-screen flex-col overflow-hidden bg-background text-foreground select-none">
            <header
              data-tauri-drag-region
              :class="[
                'flex h-11 shrink-0 items-center border-b border-border/60 bg-card/70',
                IS_MAC ? 'pr-3 pl-22' : 'pr-0 pl-3',
              ]"
            >
              <div
                data-tauri-drag-region
                class="flex min-w-0 flex-1 justify-center"
              >
                <div class="flex h-7 items-center gap-1 rounded-lg bg-muted/55 p-0.5">
                  <button
                    v-for="tab in tabs"
                    :key="tab.id"
                    type="button"
                    :class="[
                      'inline-flex h-6 items-center gap-1.5 rounded-md px-2.5 text-[11.5px] font-medium transition-colors',
                      activeTab === tab.id
                        ? 'bg-background text-foreground shadow-sm'
                        : 'text-muted-foreground hover:text-foreground',
                    ]"
                    @click="selectTab(tab.id)"
                  >
                    <NIcon :component="tab.icon" :size="13" />
                    <span>{{ tab.label }}</span>
                  </button>
                </div>
              </div>
              <WindowControls v-if="USE_CUSTOM_WINDOW_CONTROLS" close-only />
            </header>

            <main class="min-h-0 flex-1 overflow-y-auto px-8 pt-6 pb-7">
              <div class="mx-auto w-full max-w-160">
                <RouterView />
              </div>
            </main>
          </div>
        </NNotificationProvider>
      </NMessageProvider>
    </NDialogProvider>
  </NConfigProvider>
</template>
