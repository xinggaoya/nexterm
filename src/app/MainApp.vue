<script setup lang="ts">
import {
  BrowsersOutline,
  DesktopOutline,
  FolderOpenOutline,
} from "@vicons/ionicons5";
import {
  NConfigProvider,
  NDialogProvider,
  NDrawer,
  NDrawerContent,
  NIcon,
  NMessageProvider,
  NModal,
  NNotificationProvider,
} from "naive-ui";
import { computed, nextTick, onMounted, onUnmounted, ref, watch } from "vue";
import { useI18n } from "vue-i18n";
import TitleBar from "./shell/TitleBar.vue";
import StatusBar from "./shell/StatusBar.vue";
import WorkspaceBar from "./shell/WorkspaceBar.vue";
import WorkspaceHost from "./shell/WorkspaceHost.vue";
import { applyLanguagePreference } from "@/modules/i18n";
import { getNaiveLocaleConfig } from "@/modules/i18n/naive";
import { resolveAppLocale } from "@/modules/i18n/types";
import { USE_CUSTOM_WINDOW_CONTROLS } from "@/lib/platform";
import { hasTauriInternals } from "@/lib/tauriRuntime";
import { useEventListener } from "@/lib/useEventListener";
import {
  SETTINGS_DEFAULT_TAB,
  type SettingsTab,
} from "@/modules/settings/tabs";
import { usePreferencesPiniaStore } from "@/modules/settings/preferencesPinia";
import type { Tab } from "@/modules/tabs/tabsTypes";
import { useTabsPiniaStore } from "@/modules/tabs/tabsPinia";
import NotificationBridge from "@/modules/notifications/NotificationBridge.vue";
import {
  useWorkspacesPiniaStore,
  useWorkspaceRootPiniaStore,
  useWorkspaceEnvPiniaStore,
  workspaceScopeKey,
  type WorkspaceEnv,
  type WorkspaceSelection,
} from "@/modules/workspace";
import WorkspaceWelcome from "./components/WorkspaceWelcome.vue";
import UnsavedCloseGuard from "./components/UnsavedCloseGuard.vue";
import RenameTerminalDialog from "./components/RenameTerminalDialog.vue";
import { applyTerminalSessionTheme } from "@/modules/terminal";
import { configureTerminalSessionDisposer } from "@/modules/tabs/terminalDisposal";
import { disposeSession } from "@/modules/terminal/lib/sessions";
import { buildNaiveThemeOverrides, getNaiveTheme } from "@/modules/theme/naiveTheme";
import { readAppTokens, type AppTokens } from "@/styles/tokens";
import SettingsPanel from "@/settings/SettingsPanel.vue";
import { useWorkbenchLayout } from "./useWorkbenchLayout";
import { useWindowChromeState } from "./useWindowChromeState";
import { LOCAL_WORKSPACE } from "@/modules/workspace";

const { t } = useI18n();
const prefs = usePreferencesPiniaStore();
const tabs = useTabsPiniaStore();
const workspaces = useWorkspacesPiniaStore();
const workspaceRootStore = useWorkspaceRootPiniaStore();
const workspaceEnv = useWorkspaceEnvPiniaStore();

const settingsOpen = ref(false);
const workspaceOpenChoice = ref<WorkspaceSelection | null>(null);
const activeSettingsTab = ref<SettingsTab>(SETTINGS_DEFAULT_TAB);
const SETTINGS_DRAWER_WIDTH = "min(720px, calc(100vw - 32px))";
// closeGuard is wired via template ref on UnsavedCloseGuard; the guard emits
// close-tab events handled directly in the template.

// ── Terminal disposal wiring ────────────────────────────────────────────
// The tabs store calls `disposeTerminalSession(leafId)` when closing tabs,
// but the disposer was never configured (a latent bug that leaked PTY
// processes). Wire it to the workspace-aware session registry so closes
// actually tear down the backend PTY. leafId arrives as `${workspaceId}:${n}`
// so we split to recover the workspace id.
configureTerminalSessionDisposer((leafId) => {
  const raw = String(leafId);
  // leaf ids are plain numbers from the tabs store; the workspace id is
  // resolved via the tab that owns the leaf. For the disposal callback we
  // attempt all workspace buckets — disposeSession is a no-op when the leaf
  // isn't found, so trying every workspace is safe (and rare on close).
  for (const ws of workspaces.workspaces) {
    disposeSession(ws.id, raw);
  }
});

// ── Theme ───────────────────────────────────────────────────────────────
const colorSchemeQuery =
  typeof window.matchMedia === "function"
    ? window.matchMedia("(prefers-color-scheme: dark)")
    : null;
const systemDark = ref(colorSchemeQuery?.matches ?? true);
const colorSchemeListener = (event: MediaQueryListEvent) => {
  systemDark.value = event.matches;
};
const fallbackTokens: AppTokens = {
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
  "activity-bar": "rgb(248, 248, 250)",
  "title-bar": "rgb(250, 250, 252)",
  "terminal-focus": "rgb(59, 130, 246)",
  "pane-handle": "rgb(220, 220, 224)",
  "pane-handle-active": "rgb(100, 140, 230)",
  "panel-bg": "rgb(249, 249, 251)",
};

const themeOverrides = ref(buildNaiveThemeOverrides(fallbackTokens));
const resolvedLocale = ref(resolveAppLocale(prefs.language));
const resolvedTheme = computed(() => {
  if (prefs.theme === "system") return systemDark.value ? "dark" : "light";
  return prefs.theme;
});
const naiveTheme = computed(() => getNaiveTheme(resolvedTheme.value));
const naiveLocaleConfig = computed(() => getNaiveLocaleConfig(resolvedLocale.value));

// ── Active-workspace derived state (read by global shell components) ─────
const activeWorkspace = computed(() => workspaces.activeWorkspace);
const hasWorkspace = computed(() => activeWorkspace.value !== null);
const workspaceRoot = computed(() => activeWorkspace.value?.rootPath ?? null);
const workspaceScope = computed(() =>
  activeWorkspace.value
    ? workspaceScopeKey(activeWorkspace.value.env)
    : workspaceScopeKey(LOCAL_WORKSPACE),
);
const activeTab = computed<Tab | null>(() => {
  const ws = activeWorkspace.value;
  if (!ws) return null;
  const list = tabs.workspaceTabs(ws.id);
  const activeId = tabs.activeIdByWorkspace[ws.id] ?? 0;
  return list.find((tab) => tab.id === activeId) ?? null;
});
const activeCwd = computed(() =>
  activeTab.value?.kind === "terminal" ? activeTab.value.cwd ?? null : null,
);
const gitBranch = ref<string | null>(null);

const workbenchLayout = useWorkbenchLayout({ prefs });
useWindowChromeState();
const {
  toggleLeftPanel,
  toggleRightPanel,
  startLayoutObservers,
  stopLayoutObservers,
} = workbenchLayout;

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
    const update = () => {
      themeOverrides.value = buildNaiveThemeOverrides(readAppTokens());
      applyTerminalSessionTheme();
    };
    if (typeof requestAnimationFrame === "function") requestAnimationFrame(update);
    else update();
  });
}

async function syncLanguage() {
  resolvedLocale.value = await applyLanguagePreference(prefs.language);
}

// ── Add-workspace flow ──────────────────────────────────────────────────
async function startAddWorkspace(env: WorkspaceEnv = workspaceEnv.pendingEnv) {
  try {
    const selection = await workspaceRootStore.pickWorkspaceDirectory(env);
    if (!selection) return;
    workspaceOpenChoice.value = selection;
  } catch (error) {
    window.alert(String(error));
  }
}

function selectedWorkspaceLabel(selection: WorkspaceSelection): string {
  return selection.env.kind === "wsl"
    ? `WSL · ${selection.env.distro}`
    : t("common.local");
}

async function openSelectedWorkspaceInCurrentWindow() {
  const selection = workspaceOpenChoice.value;
  workspaceOpenChoice.value = null;
  if (!selection) return;
  try {
    await workspaces.addWorkspace(selection.path, selection.env);
  } catch (error) {
    window.alert(String(error));
  }
}

async function openSelectedWorkspaceInNewWindow() {
  const selection = workspaceOpenChoice.value;
  workspaceOpenChoice.value = null;
  if (!selection) return;
  try {
    const { openWorkspaceInNewWindow } = await import(
      "@/modules/workspace/workspaceWindow"
    );
    const webview = await openWorkspaceInNewWindow(selection);
    void webview.once("tauri://error", (event) => {
      window.alert(String(event.payload));
    });
  } catch (error) {
    window.alert(String(error));
  }
}

// ── Welcome screen actions (no workspace open) ──────────────────────────
async function chooseWorkspaceFromWelcome() {
  await startAddWorkspace(workspaceEnv.pendingEnv);
}

async function openRecentWorkspace(record: WorkspaceSelection & { openedAt?: number }) {
  try {
    await workspaces.addWorkspace(record.path, record.env);
  } catch (error) {
    window.alert(String(error));
  }
}

function openSettings(tab: SettingsTab = SETTINGS_DEFAULT_TAB) {
  activeSettingsTab.value = tab;
  settingsOpen.value = true;
}

function preventNativeContextMenu(event: MouseEvent) {
  event.preventDefault();
}

const renameDialogState = ref<{ leafId: number; currentTitle: string } | null>(
  null,
);

function commitRename(title: string) {
  const state = renameDialogState.value;
  if (!state) return;
  const ws = activeWorkspace.value;
  if (ws) tabs.setLeafTitle(state.leafId, title, ws.id);
  renameDialogState.value = null;
}

function cancelRename() {
  renameDialogState.value = null;
}

// ── Command palette (global; operates on active workspace) ──────────────
const commandPaletteOpen = ref(false);

onMounted(() => {
  if (hasTauriInternals()) void prefs.hydrate();
  startLayoutObservers();
});

if (colorSchemeQuery) {
  useEventListener(colorSchemeQuery, "change", colorSchemeListener);
}
useEventListener(window, "languagechange", syncLanguage);
useEventListener(window, "contextmenu", preventNativeContextMenu);

onUnmounted(() => {
  stopLayoutObservers();
});

watch(
  [workspaceRoot, workspaceScope],
  () => {
    gitBranch.value = null;
  },
);
watch(resolvedTheme, syncDocumentTheme, { immediate: true });
watch(
  () => prefs.language,
  () => {
    void syncLanguage();
  },
  { immediate: true },
);
</script>
<template>
  <NConfigProvider
    :theme="naiveTheme"
    :theme-overrides="themeOverrides"
    :locale="naiveLocaleConfig.locale"
    :date-locale="naiveLocaleConfig.dateLocale"
  >
    <NDialogProvider>
      <NMessageProvider>
        <NNotificationProvider
          placement="bottom-right"
          container-style="right: 12px; bottom: 12px;"
        >
          <NotificationBridge />
          <div class="flex h-screen flex-col overflow-hidden bg-background text-foreground select-none">
            <UnsavedCloseGuard
              :tabs="tabs.tabs"
              @close-tab="(id) => tabs.closeTab(id)"
            />
            <TitleBar
              :workspace-root="workspaceRoot"
              :git-branch="gitBranch"
              :show-window-controls="USE_CUSTOM_WINDOW_CONTROLS"
              :active-tab="activeTab"
              @open-command-palette="commandPaletteOpen = true"
              @open-settings="openSettings"
              @choose-workspace="startAddWorkspace()"
              @choose-workspace-in-env="(env) => startAddWorkspace(env)"
              @toggle-explorer="toggleRightPanel"
              @toggle-source-control="toggleLeftPanel"
            />
            <WorkspaceBar @add-workspace="startAddWorkspace()" />
            <div class="flex min-h-0 flex-1 flex-col">
              <!--
                All open workspaces are mounted simultaneously and toggled via
                v-show so inactive ones keep running in the background (PTY
                sessions, watchers, editor state all stay alive). Only the
                active workspace is visible.
              -->
              <WorkspaceHost
                v-for="ws in workspaces.workspaces"
                :key="ws.id"
                v-show="ws.id === workspaces.activeWorkspaceId"
                :workspace="ws"
              />
              <WorkspaceWelcome
                v-if="!hasWorkspace"
                :recent-workspaces="workspaceRootStore.recentWorkspaces"
                :loading="workspaceRootStore.loading"
                :error="workspaceRootStore.error"
                @choose-workspace="chooseWorkspaceFromWelcome"
                @open-recent="openRecentWorkspace"
                @workspace-env-change="(env) => workspaceEnv.setPendingEnv(env)"
              />
            </div>
            <StatusBar
              :workspace-root="workspaceRoot"
              :terminal-cwd="activeCwd"
              :git-branch="gitBranch"
              :workspace-switching="false"
              :switching-workspace-env="null"
              @workspace-change="(env) => startAddWorkspace(env)"
            />

            <NModal
              :show="!!workspaceOpenChoice"
              preset="card"
              :title="t('app.workspaceOpen.title')"
              :bordered="false"
              :auto-focus="false"
              :mask-closable="true"
              class="max-w-[420px]"
              @update:show="(show) => { if (!show) workspaceOpenChoice = null; }"
            >
              <div v-if="workspaceOpenChoice" class="space-y-4">
                <div
                  data-workspace-open-choice-path
                  class="rounded-md border border-border/70 bg-muted/40 px-3 py-2"
                >
                  <div class="flex min-w-0 items-center gap-2 text-[12px] text-muted-foreground">
                    <NIcon :component="FolderOpenOutline" class="shrink-0" />
                    <span class="truncate">{{ selectedWorkspaceLabel(workspaceOpenChoice) }}</span>
                  </div>
                  <div class="mt-1 truncate text-[13px] text-foreground">
                    {{ workspaceOpenChoice.path }}
                  </div>
                </div>
                <div class="grid grid-cols-1 gap-2 sm:grid-cols-2">
                  <button
                    type="button"
                    data-open-workspace-current
                    class="flex min-h-20 items-center gap-3 rounded-md border border-border/70 bg-card px-3 py-3 text-left transition-colors hover:border-primary/40 hover:bg-accent focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
                    @click="openSelectedWorkspaceInCurrentWindow"
                  >
                    <span class="grid size-8 shrink-0 place-items-center rounded-md bg-accent text-foreground">
                      <NIcon :component="DesktopOutline" :size="17" />
                    </span>
                    <span class="min-w-0">
                      <span class="block text-[13px] font-medium text-foreground">
                        {{ t("app.workspaceOpen.currentWindow") }}
                      </span>
                    </span>
                  </button>
                  <button
                    type="button"
                    data-open-workspace-new-window
                    class="flex min-h-20 items-center gap-3 rounded-md border border-border/70 bg-card px-3 py-3 text-left transition-colors hover:border-primary/40 hover:bg-accent focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
                    @click="openSelectedWorkspaceInNewWindow"
                  >
                    <span class="grid size-8 shrink-0 place-items-center rounded-md bg-accent text-foreground">
                      <NIcon :component="BrowsersOutline" :size="17" />
                    </span>
                    <span class="min-w-0">
                      <span class="block text-[13px] font-medium text-foreground">
                        {{ t("app.workspaceOpen.newWindow") }}
                      </span>
                    </span>
                  </button>
                </div>
              </div>
            </NModal>

            <NDrawer
              v-model:show="settingsOpen"
              placement="right"
              :width="SETTINGS_DRAWER_WIDTH"
              :auto-focus="false"
            >
              <NDrawerContent
                body-content-style="height: 100%; padding: 0;"
                :native-scrollbar="false"
              >
                <SettingsPanel
                  v-model:active-tab="activeSettingsTab"
                  show-close
                  @close="settingsOpen = false"
                />
              </NDrawerContent>
            </NDrawer>

            <RenameTerminalDialog
              :show="renameDialogState !== null"
              :current-title="renameDialogState?.currentTitle ?? ''"
              @submit="commitRename"
              @cancel="cancelRename"
            />
          </div>
        </NNotificationProvider>
      </NMessageProvider>
    </NDialogProvider>
  </NConfigProvider>
</template>
