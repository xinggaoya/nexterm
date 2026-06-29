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
import { computed, nextTick, onMounted, onUnmounted, ref, useTemplateRef, watch } from "vue";
import { useI18n } from "vue-i18n";
import TitleBar from "./shell/TitleBar.vue";
import TabBar from "./shell/TabBar.vue";
import StatusBar from "./shell/StatusBar.vue";
import Workbench from "./shell/Workbench.vue";
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
import RenameTerminalDialog from "./components/RenameTerminalDialog.vue";
import { readEditorDocument } from "@/modules/editor/lib/documentService";
import { native } from "@/lib/native";
import { applyTerminalSessionTheme } from "@/modules/terminal";
import { copyToClipboard, relativePath } from "@/modules/explorer/lib/contextActions";
import { notifyInfo } from "@/modules/notifications/notificationCenter";
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
const closeGuard = useTemplateRef<typeof UnsavedCloseGuard>("closeGuard");
const workbench = useTemplateRef<typeof Workbench>("workbench");
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
const gitBranch = ref<string | null>(null);
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

function openTerminalInDir(cwd: string) {
  if (!cwd) return;
  tabs.newTab(cwd);
}

function duplicateTerminalTab(tabId: number) {
  const tab = tabs.tabs.find((t) => t.id === tabId);
  if (!tab || tab.kind !== "terminal") return;
  tabs.newTab(tab.cwd);
}

function renameTabTitle(tabId: number, title: string) {
  const trimmed = title.trim();
  if (!trimmed) return;
  tabs.updateTab(tabId, { title: trimmed });
}

function startTabRename(tabId: number) {
  // Placeholder: TabBar 的右键菜单只发起 requestRename，UI 入口
  // （如 inline edit / modal dialog）在下一轮迭代时实现。本轮先
  // 静默 no-op 以保证右键流程不会报错。
  void tabId;
}

function notifyMoveToNewWindow(tabId: number) {
  void tabId;
  notifyInfo(
    t("tabMenu.moveToNewWindow"),
    t("tabMenu.moveToNewWindowHint"),
  );
}

function splitActivePane(dir: SplitDir) {
  const tab = activeTab.value;
  if (tab?.kind !== "terminal") return;
  tabs.splitActivePane(tab.id, dir);
}

const renameDialogState = ref<{ leafId: number; currentTitle: string } | null>(
  null,
);

function openRenameDialog(leafId: number, currentTitle: string) {
  renameDialogState.value = { leafId, currentTitle };
}

function commitRename(title: string) {
  const state = renameDialogState.value;
  if (!state) return;
  tabs.setLeafTitle(state.leafId, title);
  renameDialogState.value = null;
}

function cancelRename() {
  renameDialogState.value = null;
}

async function killActiveTerminal() {
  const tab = activeTab.value;
  if (tab?.kind !== "terminal") return;
  await workbench.value?.killTerminal(tab.activeLeafId);
}

function openFileTab(path: string, pin: boolean) {
  const shouldPin = pin || prefs.fileOpenMode === "pinned";
  tabs.openFileTab(path, shouldPin);
  void prefs.recordOpenedFile(path);
}

function openMarkdownPreview(path: string) {
  tabs.newMarkdownTab(path);
}

function openSearchResult(path: string, _line: number) {
  // 本轮不实现 openAtLine 精准跳行；先打开文件，后续轮次扩展。
  // 参数前导下划线表明有意未使用。
  tabs.openFileTab(path, true);
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
  await workbench.value?.saveActiveEditor();
}

function openGotoLine() {
  workbench.value?.openGotoLine?.();
}

function openFindInFiles() {
  // 资源管理器未挂载时静默 no-op
  workbench.value?.openFindInFiles?.();
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
  openGotoLine,
  openFindInFiles,
  openCommandPalette: (mode) => openCommandPalette(mode ?? "commands"),
  openRenameDialog,
  killActiveTerminal,
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
  startLayoutObservers();
});

if (colorSchemeQuery) {
  useEventListener(colorSchemeQuery, "change", colorSchemeListener);
}
useEventListener(window, "languagechange", syncLanguage);
useEventListener(window, "keydown", handleGlobalCommandKeydown);
useEventListener(window, "contextmenu", preventNativeContextMenu);

onUnmounted(() => {
  taskConsole.disposeTaskConsole();
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
            <TitleBar
              :workspace-root="workspaceRoot"
              :git-branch="gitBranch"
              :show-window-controls="USE_CUSTOM_WINDOW_CONTROLS"
              :active-tab="activeTab"
              @open-command-palette="openCommandPalette"
              @open-settings="openSettings"
              @choose-workspace="chooseWorkspaceOpenTarget"
              @choose-workspace-in-env="chooseWorkspaceInEnv"
              @toggle-explorer="rightPanelOpen = !rightPanelOpen"
              @toggle-source-control="leftPanelOpen = !leftPanelOpen"
            />
            <div class="flex min-h-0 flex-1 flex-col">
              <TabBar
                v-if="hasWorkspace"
                :tabs="tabs.tabs"
                :active-id="tabs.activeId"
                :can-split="canSplitActiveTab"
                :show-actions="hasWorkspace"
                :workspace-root="workspaceRoot"
                @select-tab="(id) => tabs.setActiveId(id)"
                @close-tab="requestCloseTab"
                @close-others="(id) => tabs.closeOthers(id)"
                @close-to-right="(id) => tabs.closeToRight(id)"
                @close-all="tabs.closeAll()"
                @duplicate-terminal="duplicateTerminalTab"
                @rename-tab="renameTabTitle"
                @request-rename="startTabRename"
                @pin-tab="(id) => tabs.pinTab(id)"
                @copy-path="(path) => void copyToClipboard(path)"
                @copy-relative-path="(root, path) => void copyToClipboard(relativePath(root, path))"
                @move-to-new-window="notifyMoveToNewWindow"
                @reorder-tab="(sourceId, targetId, placement) => tabs.moveTab(sourceId, targetId, placement)"
                @new-tab="newTerminalTab"
                @split-pane="splitActivePane"
              />
              <main class="flex min-h-0 flex-1 flex-col overflow-hidden">
                <Workbench
                  v-if="hasWorkspace"
                  ref="workbench"
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
                  @open-in-terminal="openTerminalInDir"
                  @open-search-result="openSearchResult"
                  @open-source-diff="openSourceDiff"
                  @open-source-history="openSourceHistory"
                />
                <WorkspaceWelcome
                  v-else
                  :recent-workspaces="workspaceRootStore.recentWorkspaces"
                  :loading="workspaceRootStore.loading"
                  :error="workspaceRootStore.error"
                  @choose-workspace="chooseWorkspace"
                  @open-recent="openRecentWorkspace"
                  @workspace-env-change="switchWorkspace"
                />
              </main>
            </div>
            <StatusBar
              :workspace-root="workspaceRoot"
              :terminal-cwd="activeCwd"
              :git-branch="gitBranch"
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
