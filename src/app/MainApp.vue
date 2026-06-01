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
import AppHeader from "./components/AppHeader.vue";
import AppStatusBar from "./components/AppStatusBar.vue";
import WorkspaceShell from "./components/WorkspaceShell.vue";
import { applyLanguagePreference } from "@/modules/i18n";
import { getNaiveLocaleConfig } from "@/modules/i18n/naive";
import { resolveAppLocale } from "@/modules/i18n/types";
import { USE_CUSTOM_WINDOW_CONTROLS } from "@/lib/platform";
import { hasTauriInternals } from "@/lib/tauriRuntime";
import {
  SETTINGS_DEFAULT_TAB,
  type SettingsTab,
} from "@/modules/settings/tabs";
import { usePreferencesPiniaStore } from "@/modules/settings/preferencesPinia";
import { useTabsPiniaStore } from "@/modules/tabs/tabsPinia";
import { MAX_PANES_PER_TAB, type Tab } from "@/modules/tabs/tabsTypes";
import CommandPalette from "@/modules/commands/CommandPalette.vue";
import NotificationBridge from "@/modules/notifications/NotificationBridge.vue";
import {
  openWorkspaceInNewWindow,
  useWorkspaceEnvPiniaStore,
  useWorkspaceRootPiniaStore,
  type WorkspaceEnv,
  type WorkspaceSelection,
} from "@/modules/workspace";
import WorkspaceWelcome from "./components/WorkspaceWelcome.vue";
import UnsavedCloseGuard from "./components/UnsavedCloseGuard.vue";
import { readEditorDocument } from "@/modules/editor/lib/documentService";
import { native } from "@/lib/native";
import { applyTerminalSessionTheme } from "@/modules/terminal";
import { leafIds, type SplitDir } from "@/modules/terminal/lib/panes";
import { buildNaiveThemeOverrides, getNaiveTheme } from "@/modules/theme/naiveTheme";
import { readAppTokens, type AppTokens } from "@/styles/tokens";
import SettingsPanel from "@/settings/SettingsPanel.vue";
import { useTaskConsoleController } from "./useTaskConsoleController";
import { useWorkbenchCommands } from "./useWorkbenchCommands";
import { useWorkbenchLayout } from "./useWorkbenchLayout";
import { useWindowChromeState } from "./useWindowChromeState";
import { useWorkspaceLifecycle } from "./useWorkspaceLifecycle";

const { t } = useI18n();
const prefs = usePreferencesPiniaStore();
const tabs = useTabsPiniaStore();
const workspaceEnv = useWorkspaceEnvPiniaStore();
const workspaceRootStore = useWorkspaceRootPiniaStore();
const settingsOpen = ref(false);
const workspaceOpenChoice = ref<WorkspaceSelection | null>(null);
const activeSettingsTab = ref<SettingsTab>(SETTINGS_DEFAULT_TAB);
const SETTINGS_DRAWER_WIDTH = "min(720px, calc(100vw - 32px))";
const closeGuard = ref<InstanceType<typeof UnsavedCloseGuard> | null>(null);
const workspaceShell = ref<InstanceType<typeof WorkspaceShell> | null>(null);
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
};

const themeOverrides = ref(buildNaiveThemeOverrides(fallbackTokens));
const resolvedLocale = ref(resolveAppLocale(prefs.language));
const resolvedTheme = computed(() => {
  if (prefs.theme === "system") return systemDark.value ? "dark" : "light";
  return prefs.theme;
});
const naiveTheme = computed(() => getNaiveTheme(resolvedTheme.value));
const naiveLocaleConfig = computed(() => getNaiveLocaleConfig(resolvedLocale.value));
const activeTab = computed<Tab | null>(
  () => tabs.tabs.find((tab) => tab.id === tabs.activeId) ?? null,
);
const hasWorkspace = computed(() => !!workspaceRootStore.rootPath);
const activeCwd = computed(() =>
  activeTab.value?.kind === "terminal" ? activeTab.value.cwd ?? null : null,
);
const workspaceRoot = computed(() => workspaceRootStore.rootPath);
const canSplitActiveTab = computed(() => {
  const tab = activeTab.value;
  if (!tab || tab.kind !== "terminal") return false;
  return leafIds(tab.paneTree).length < MAX_PANES_PER_TAB;
});
const workbenchLayout = useWorkbenchLayout({ prefs });
useWindowChromeState();
const {
  leftPanelOpen,
  rightPanelOpen,
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

function newTerminalTab() {
  if (!workspaceRoot.value) return;
  tabs.newTab(workspaceRoot.value);
}

function splitActivePane(dir: SplitDir) {
  const tab = activeTab.value;
  if (tab?.kind !== "terminal") return;
  tabs.splitActivePane(tab.id, dir);
}

function openFileTab(path: string, pin: boolean) {
  const shouldPin = pin || prefs.fileOpenMode === "pinned";
  tabs.openFileTab(path, shouldPin);
}

function openMarkdownPreview(path: string) {
  tabs.newMarkdownTab(path);
}

function openSourceDiff(input: {
  repoRoot: string;
  path: string;
  mode: "-" | "+";
  originalPath: string | null;
  title?: string;
}) {
  tabs.openGitDiffTab(input);
}

function openSourceHistory(input: { repoRoot: string; branch?: string | null }) {
  tabs.openCommitHistoryTab(input);
}

function requestCloseTab(id: number) {
  if (closeGuard.value) {
    closeGuard.value.requestCloseTab(id);
    return;
  }
  tabs.closeTab(id);
}

async function saveActiveEditor() {
  await workspaceShell.value?.saveActiveEditor();
}

async function readWorkspaceTextFile(path: string): Promise<string | null> {
  const result = await readEditorDocument(path);
  return result.status === "ready" ? result.content : null;
}

const taskConsole = useTaskConsoleController({
  workspaceRoot,
  readTextFile: readWorkspaceTextFile,
  openTaskTerminal: (input) => tabs.newTaskTerminal(input),
});

const {
  chooseWorkspace,
  openRecentWorkspace,
  openWorkspacePath,
  startWorkspaceLifecycle,
  stopWorkspaceLifecycle,
  switchWorkspace,
  switchingWorkspaceEnv,
  workspaceSwitching,
  workspaceFsEvent,
} = useWorkspaceLifecycle({
  workspaceRoot,
  workspaceEnv,
  workspaceRootStore,
  tabs,
  t: (key) => t(key),
});

function selectedWorkspaceLabel(selection: WorkspaceSelection): string {
  return selection.env.kind === "wsl"
    ? `WSL · ${selection.env.distro}`
    : t("common.local");
}

async function chooseWorkspaceOpenTarget() {
  try {
    const selection = await workspaceRootStore.pickWorkspaceDirectory();
    workspaceOpenChoice.value = selection;
  } catch (error) {
    window.alert(String(error));
  }
}

async function chooseWorkspaceInEnv(env: WorkspaceEnv) {
  try {
    const selection = await workspaceRootStore.pickWorkspaceDirectoryForEnv(env);
    workspaceOpenChoice.value = selection;
  } catch (error) {
    window.alert(String(error));
  }
}

async function openSelectedWorkspaceInCurrentWindow() {
  const selection = workspaceOpenChoice.value;
  workspaceOpenChoice.value = null;
  if (!selection) return;
  await openWorkspacePath(selection.path, selection.env);
}

async function openSelectedWorkspaceInNewWindow() {
  const selection = workspaceOpenChoice.value;
  workspaceOpenChoice.value = null;
  if (!selection) return;
  try {
    const webview = await openWorkspaceInNewWindow(selection);
    void webview.once("tauri://error", (event) => {
      window.alert(String(event.payload));
    });
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

const {
  commandContext,
  commandDefinitions,
  commandPaletteMode,
  commandPaletteOpen,
  closeCommandPalette,
  executeCommandFromPalette,
  handleGlobalCommandKeydown,
  openCommandPalette,
  openFileFromCommandPalette,
  resolvedCommandKeybindings,
} = useWorkbenchCommands({
  t: (key) => t(key),
  keybindings: computed(() => prefs.keybindings),
  hasWorkspace,
  workspaceRoot,
  activeTab,
  leftPanelOpen,
  rightPanelOpen,
  workspaceFsEvent,
  tabs,
  newTerminalTab,
  splitActivePane,
  openFileTab,
  openSettings,
  openTaskConsole: taskConsole.openTaskConsole,

  requestCloseTab,
  saveActiveEditor,
  resolveGitRepo: native.gitResolveRepo,
  gitStatus: native.gitStatus,
  gitStage: native.gitStage,
  gitUnstage: native.gitUnstage,
  gitFetch: native.gitFetch,
  gitPullFfOnly: native.gitPullFfOnly,
  gitPush: native.gitPush,
  gitBranchList: native.gitBranchList,
  gitCheckoutBranch: native.gitCheckoutBranch,
  gitCreateBranch: native.gitCreateBranch,
  gitStashList: native.gitStashList,
  gitStashPush: native.gitStashPush,
  gitStashPop: native.gitStashPop,
});

onMounted(() => {
  if (hasTauriInternals()) void prefs.hydrate();
  void startWorkspaceLifecycle();
  colorSchemeQuery?.addEventListener("change", colorSchemeListener);
  window.addEventListener("languagechange", syncLanguage);
  window.addEventListener("keydown", handleGlobalCommandKeydown);
  window.addEventListener("contextmenu", preventNativeContextMenu);
  startLayoutObservers();
});

onUnmounted(() => {
  taskConsole.disposeTaskConsole();
  colorSchemeQuery?.removeEventListener("change", colorSchemeListener);
  window.removeEventListener("languagechange", syncLanguage);
  window.removeEventListener("keydown", handleGlobalCommandKeydown);
  window.removeEventListener("contextmenu", preventNativeContextMenu);
  stopLayoutObservers();
  stopWorkspaceLifecycle();
});

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
              ref="closeGuard"
              :tabs="tabs.tabs"
              @close-tab="(id) => tabs.closeTab(id)"
            />
            <AppHeader
              :tabs="tabs.tabs"
              :active-id="tabs.activeId"
              :can-split="canSplitActiveTab"
              :workspace-ready="hasWorkspace"
              :show-window-controls="USE_CUSTOM_WINDOW_CONTROLS"
              :left-panel-open="leftPanelOpen"
              :right-panel-open="rightPanelOpen"
              @select-tab="(id) => tabs.setActiveId(id)"
              @close-tab="requestCloseTab"
              @pin-tab="(id) => tabs.pinTab(id)"
              @reorder-tab="(sourceId, targetId, placement) => tabs.moveTab(sourceId, targetId, placement)"
              @new-tab="newTerminalTab"
              @choose-workspace="chooseWorkspaceOpenTarget"
              @choose-workspace-in-env="chooseWorkspaceInEnv"
              @split-pane="splitActivePane"
              @open-command-palette="openCommandPalette"
              @open-settings="openSettings"
              @toggle-left-panel="leftPanelOpen = !leftPanelOpen"
              @toggle-right-panel="rightPanelOpen = !rightPanelOpen"
            />

            <main v-if="hasWorkspace" class="min-h-0 flex-1">
              <WorkspaceShell
                ref="workspaceShell"
                :active-id="tabs.activeId"
                :active-tab="activeTab"
                :layout="workbenchLayout"
                :tabs="tabs.tabs"
                :tabs-store="tabs"
                :task-console="taskConsole"
                :workspace-fs-event="workspaceFsEvent"
                :workspace-root="workspaceRoot"
                @open-file="openFileTab"
                @open-markdown-preview="openMarkdownPreview"
                @open-source-diff="openSourceDiff"
                @open-source-history="openSourceHistory"
              />
            </main>

            <main v-else class="min-h-0 flex-1 bg-background">
              <WorkspaceWelcome
                :recent-workspaces="workspaceRootStore.recentWorkspaces"
                :loading="workspaceRootStore.loading"
                :error="workspaceRootStore.error"
                @choose-workspace="chooseWorkspace"
                @open-recent="openRecentWorkspace"
                @workspace-env-change="switchWorkspace"
              />
            </main>

            <AppStatusBar
              :workspace-root="workspaceRoot"
              :terminal-cwd="activeCwd"
              :workspace-switching="workspaceSwitching"
              :switching-workspace-env="switchingWorkspaceEnv"
              @workspace-change="switchWorkspace"
            />

            <CommandPalette
              :show="commandPaletteOpen"
              :mode="commandPaletteMode"
              :commands="commandDefinitions"
              :keybindings="resolvedCommandKeybindings"
              :context="commandContext"
              :workspace-root="workspaceRoot"
              :show-hidden="prefs.showHidden"
              @close="closeCommandPalette"
              @execute-command="executeCommandFromPalette"
              @open-file="openFileFromCommandPalette"
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
          </div>
        </NNotificationProvider>
      </NMessageProvider>
    </NDialogProvider>
  </NConfigProvider>
</template>
