<script setup lang="ts">
import {
  NConfigProvider,
  NDialogProvider,
  NDrawer,
  NDrawerContent,
  NMessageProvider,
  NNotificationProvider,
  NSplit,
} from "naive-ui";
import { homeDir } from "@tauri-apps/api/path";
import { listen, type UnlistenFn } from "@tauri-apps/api/event";
import { computed, nextTick, onMounted, onUnmounted, ref, watch } from "vue";
import { useI18n } from "vue-i18n";
import AppHeader from "./components/AppHeader.vue";
import AppStatusBar from "./components/AppStatusBar.vue";
import { applyLanguagePreference } from "@/modules/i18n";
import { getNaiveLocaleConfig } from "@/modules/i18n/naive";
import { resolveAppLocale } from "@/modules/i18n/types";
import { USE_CUSTOM_WINDOW_CONTROLS } from "@/lib/platform";
import { hasTauriInternals } from "@/lib/tauriRuntime";
import {
  SIDE_PANEL_WIDTH_MAX,
  SIDE_PANEL_WIDTH_MIN,
  type StoredWorkspace,
} from "@/modules/settings/store";
import {
  SETTINGS_DEFAULT_TAB,
  type SettingsTab,
} from "@/modules/settings/tabs";
import { usePreferencesPiniaStore } from "@/modules/settings/preferencesPinia";
import { dirtyEditorTabs } from "@/modules/tabs/closeGuards";
import { useTabsPiniaStore } from "@/modules/tabs/tabsPinia";
import { MAX_PANES_PER_TAB } from "@/modules/tabs/tabsTypes";
import {
  getWslHome,
  normalizeWorkspacePath,
  useWorkspaceEnvPiniaStore,
  useWorkspaceRootPiniaStore,
  type WorkspaceEnv,
} from "@/modules/workspace";
import WorkspaceWelcome from "./components/WorkspaceWelcome.vue";
import UnsavedCloseGuard from "./components/UnsavedCloseGuard.vue";
import FileExplorer from "@/modules/explorer/FileExplorer.vue";
import SourceControlPanel from "@/modules/source-control/SourceControlPanel.vue";
import EditorPane from "@/modules/editor/EditorPane.vue";
import GitDiffStack from "@/modules/editor/GitDiffStack.vue";
import GitHistoryStack from "@/modules/git-history/GitHistoryStack.vue";
import MarkdownStack from "@/modules/markdown/MarkdownStack.vue";
import PreviewStack from "@/modules/preview/PreviewStack.vue";
import {
  native,
  WORKSPACE_FS_CHANGED_EVENT,
  type WorkspaceFsChangedEvent,
} from "@/lib/native";
import { applyTerminalSessionTheme } from "@/modules/terminal";
import TerminalStack from "@/modules/terminal/TerminalStack.vue";
import { leafIds, type SplitDir } from "@/modules/terminal/lib/panes";
import { buildNaiveThemeOverrides, getNaiveTheme } from "@/modules/theme/naiveTheme";
import { readAppTokens, type AppTokens } from "@/styles/tokens";
import SettingsPanel from "@/settings/SettingsPanel.vue";

const { t } = useI18n();
const prefs = usePreferencesPiniaStore();
const tabs = useTabsPiniaStore();
const workspaceEnv = useWorkspaceEnvPiniaStore();
const workspaceRootStore = useWorkspaceRootPiniaStore();
const leftPanelOpen = ref(false);
const rightPanelOpen = ref(true);
const settingsOpen = ref(false);
const activeSettingsTab = ref<SettingsTab>(SETTINGS_DEFAULT_TAB);
const PANEL_RESIZE_TRIGGER_SIZE = 6;
const PANEL_WIDTH_SAVE_DELAY_MS = 250;
const WORKSPACE_REFRESH_FALLBACK_MS = 5000;
const SETTINGS_DRAWER_WIDTH = "min(720px, calc(100vw - 32px))";
const sourceControlPanelWidth = ref(prefs.sourceControlPanelWidth);
const explorerPanelWidth = ref(prefs.explorerPanelWidth);
const rightSplitHost = ref<HTMLElement | null>(null);
const closeGuard = ref<InstanceType<typeof UnsavedCloseGuard> | null>(null);
const rightSplitWidth = ref(0);
const workspaceFsEvent = ref<WorkspaceFsChangedEvent | null>(null);
let rightSplitResizeObserver: ResizeObserver | null = null;
let sourceControlWidthSaveTimer: ReturnType<typeof setTimeout> | null = null;
let explorerWidthSaveTimer: ReturnType<typeof setTimeout> | null = null;
let workspaceFsUnlisten: UnlistenFn | null = null;
let watchedWorkspaceRoot: string | null = null;
let workspaceRefreshFallbackTimer: ReturnType<typeof setInterval> | null = null;
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
const activeTab = computed(() => tabs.tabs.find((tab) => tab.id === tabs.activeId));
const hasWorkspace = computed(() => !!workspaceRootStore.rootPath);
const activeCwd = computed(() =>
  activeTab.value?.kind === "terminal" ? activeTab.value.cwd ?? null : null,
);
const workspaceRoot = computed(() => workspaceRootStore.rootPath);
const privateActive = computed(
  () => activeTab.value?.kind === "terminal" && activeTab.value.private === true,
);
const canSplitActiveTab = computed(() => {
  const tab = activeTab.value;
  if (!tab || tab.kind !== "terminal") return false;
  return leafIds(tab.paneTree).length < MAX_PANES_PER_TAB;
});
const isTerminalTab = computed(() => activeTab.value?.kind === "terminal");
const isEditorTab = computed(() => activeTab.value?.kind === "editor");
const isPreviewTab = computed(() => activeTab.value?.kind === "preview");
const isMarkdownTab = computed(() => activeTab.value?.kind === "markdown");
const isGitDiffTab = computed(
  () =>
    activeTab.value?.kind === "git-diff" ||
    activeTab.value?.kind === "git-commit-file",
);
const isGitHistoryTab = computed(() => activeTab.value?.kind === "git-history");
const sourceControlSplitSize = computed(() =>
  leftPanelOpen.value ? `${sourceControlPanelWidth.value}px` : "0px",
);
const sourceControlSplitMin = computed(() =>
  leftPanelOpen.value ? `${SIDE_PANEL_WIDTH_MIN}px` : "0px",
);
const sourceControlSplitMax = computed(() =>
  leftPanelOpen.value ? `${SIDE_PANEL_WIDTH_MAX}px` : "0px",
);
const sourceControlPaneClass = computed(() =>
  [
    "h-full overflow-hidden bg-card",
    leftPanelOpen.value ? "border-r border-border/40" : "",
  ].join(" "),
);
const explorerSplitSize = computed(() => {
  if (!rightPanelOpen.value) return "100%";
  const usable = rightSplitWidth.value - PANEL_RESIZE_TRIGGER_SIZE;
  if (usable <= 0) {
    return `calc(100% - ${explorerPanelWidth.value + PANEL_RESIZE_TRIGGER_SIZE}px)`;
  }
  return `${Math.max(0, usable - explorerPanelWidth.value)}px`;
});
const explorerSplitMin = computed(() => {
  if (!rightPanelOpen.value) return "0px";
  const usable = Math.max(0, rightSplitWidth.value - PANEL_RESIZE_TRIGGER_SIZE);
  return `${Math.max(0, usable - SIDE_PANEL_WIDTH_MAX)}px`;
});
const explorerSplitMax = computed(() => {
  if (!rightPanelOpen.value) return "0px";
  const usable = Math.max(0, rightSplitWidth.value - PANEL_RESIZE_TRIGGER_SIZE);
  return `${Math.max(0, usable - SIDE_PANEL_WIDTH_MIN)}px`;
});
const explorerPaneClass = computed(() =>
  [
    "h-full overflow-hidden bg-card",
    rightPanelOpen.value ? "border-l border-border/40" : "",
  ].join(" "),
);

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

function clampPanelWidth(value: number): number {
  if (!Number.isFinite(value)) return SIDE_PANEL_WIDTH_MIN;
  return Math.min(
    SIDE_PANEL_WIDTH_MAX,
    Math.max(SIDE_PANEL_WIDTH_MIN, Math.round(value)),
  );
}

function parsePxSize(value: string | number): number | null {
  if (typeof value === "number") return Number.isFinite(value) ? value : null;
  const parsed = Number.parseFloat(value);
  return Number.isFinite(parsed) ? parsed : null;
}

function measureRightSplitWidth() {
  rightSplitWidth.value = rightSplitHost.value?.getBoundingClientRect().width ?? 0;
}

function scheduleSourceControlWidthSave(width: number) {
  sourceControlPanelWidth.value = clampPanelWidth(width);
  if (sourceControlWidthSaveTimer) clearTimeout(sourceControlWidthSaveTimer);
  sourceControlWidthSaveTimer = setTimeout(() => {
    sourceControlWidthSaveTimer = null;
    void prefs.updateSourceControlPanelWidth(sourceControlPanelWidth.value);
  }, PANEL_WIDTH_SAVE_DELAY_MS);
}

function flushSourceControlWidthSave() {
  if (sourceControlWidthSaveTimer) {
    clearTimeout(sourceControlWidthSaveTimer);
    sourceControlWidthSaveTimer = null;
  }
  if (sourceControlPanelWidth.value !== prefs.sourceControlPanelWidth) {
    void prefs.updateSourceControlPanelWidth(sourceControlPanelWidth.value);
  }
}

function scheduleExplorerWidthSave(width: number) {
  explorerPanelWidth.value = clampPanelWidth(width);
  if (explorerWidthSaveTimer) clearTimeout(explorerWidthSaveTimer);
  explorerWidthSaveTimer = setTimeout(() => {
    explorerWidthSaveTimer = null;
    void prefs.updateExplorerPanelWidth(explorerPanelWidth.value);
  }, PANEL_WIDTH_SAVE_DELAY_MS);
}

function flushExplorerWidthSave() {
  if (explorerWidthSaveTimer) {
    clearTimeout(explorerWidthSaveTimer);
    explorerWidthSaveTimer = null;
  }
  if (explorerPanelWidth.value !== prefs.explorerPanelWidth) {
    void prefs.updateExplorerPanelWidth(explorerPanelWidth.value);
  }
}

function updateSourceControlSplitSize(size: string | number) {
  const width = parsePxSize(size);
  if (width !== null) scheduleSourceControlWidthSave(width);
}

function updateExplorerSplitSize(size: string | number) {
  const centerWidth = parsePxSize(size);
  const usableWidth = rightSplitWidth.value - PANEL_RESIZE_TRIGGER_SIZE;
  if (centerWidth === null || usableWidth <= 0) return;
  scheduleExplorerWidthSave(usableWidth - centerWidth);
}

function emitWorkspaceRefresh(
  rootPath: string,
  paths: string[] = [],
  gitRelated = false,
) {
  workspaceFsEvent.value = { rootPath, paths, gitRelated };
}

function isSameWorkspaceRoot(a: string | null, b: string | null): boolean {
  return !!a && !!b && normalizeWorkspacePath(a) === normalizeWorkspacePath(b);
}

function stopWorkspaceRefreshFallback() {
  if (!workspaceRefreshFallbackTimer) return;
  clearInterval(workspaceRefreshFallbackTimer);
  workspaceRefreshFallbackTimer = null;
}

function startWorkspaceRefreshFallback(rootPath: string) {
  stopWorkspaceRefreshFallback();
  workspaceRefreshFallbackTimer = setInterval(() => {
    if (workspaceRoot.value === rootPath) emitWorkspaceRefresh(rootPath, [], true);
  }, WORKSPACE_REFRESH_FALLBACK_MS);
}

async function restartWorkspaceWatcher(rootPath: string | null) {
  if (!hasTauriInternals() || watchedWorkspaceRoot === rootPath) return;
  watchedWorkspaceRoot = rootPath;
  stopWorkspaceRefreshFallback();
  try {
    await native.fsUnwatchWorkspace();
  } catch (error) {
    console.warn("Failed to stop workspace watcher", error);
  }
  if (!rootPath) return;
  try {
    await native.fsWatchWorkspace(rootPath);
  } catch (error) {
    console.warn("Workspace watcher unavailable; using periodic refresh", error);
    startWorkspaceRefreshFallback(rootPath);
  }
}

async function listenWorkspaceFsChanges() {
  if (!hasTauriInternals() || workspaceFsUnlisten) return;
  workspaceFsUnlisten = await listen<WorkspaceFsChangedEvent>(
    WORKSPACE_FS_CHANGED_EVENT,
    (event) => {
      const rootPath = workspaceRoot.value;
      if (!isSameWorkspaceRoot(event.payload.rootPath, rootPath)) return;
      workspaceFsEvent.value = event.payload;
    },
  );
}

function newTerminalTab() {
  if (!workspaceRoot.value) return;
  tabs.newTab(workspaceRoot.value);
}

function newPrivateTerminalTab() {
  if (!workspaceRoot.value) return;
  tabs.newPrivateTab(workspaceRoot.value);
}

function sameWorkspaceEnv(a: WorkspaceEnv, b: WorkspaceEnv): boolean {
  if (a.kind !== b.kind) return false;
  return a.kind === "local" || (b.kind === "wsl" && a.distro === b.distro);
}

async function switchWorkspace(env: WorkspaceEnv) {
  if (sameWorkspaceEnv(env, workspaceEnv.env) && workspaceRoot.value) return;
  if (hasDirtyEditors()) return;

  let nextHome: string;
  try {
    nextHome =
      env.kind === "wsl"
        ? await getWslHome(env.distro)
        : (await homeDir()).replace(/\\/g, "/");
  } catch (error) {
    window.alert(String(error));
    return;
  }

  await openWorkspacePath(nextHome, env);
}

function hasDirtyEditors(): boolean {
  if (dirtyEditorTabs(tabs.tabs).length > 0) {
    window.alert(t("app.unsaved.switchWorkspaceBlocked"));
    return true;
  }
  return false;
}

function syncTabsForWorkspace(path: string, resetExisting: boolean) {
  if (!tabs.initialized || tabs.tabs.length === 0) {
    tabs.init(path);
    return;
  }
  if (!resetExisting) return;
  tabs.resetWorkspace(path);
}

async function openWorkspacePath(path: string, env: WorkspaceEnv = workspaceEnv.env) {
  const hadWorkspace = !!workspaceRoot.value;
  if (hadWorkspace && hasDirtyEditors()) return;
  try {
    const record = await workspaceRootStore.openWorkspace(path, env);
    syncTabsForWorkspace(record.path, hadWorkspace);
  } catch (error) {
    window.alert(String(error));
  }
}

async function chooseWorkspace() {
  const hadWorkspace = !!workspaceRoot.value;
  if (hadWorkspace && hasDirtyEditors()) return;
  try {
    const record = await workspaceRootStore.chooseWorkspace();
    if (record) syncTabsForWorkspace(record.path, hadWorkspace);
  } catch (error) {
    window.alert(String(error));
  }
}

async function openRecentWorkspace(record: StoredWorkspace) {
  await openWorkspacePath(record.path, record.env);
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

function openSettings(tab: SettingsTab = SETTINGS_DEFAULT_TAB) {
  activeSettingsTab.value = tab;
  settingsOpen.value = true;
}

onMounted(() => {
  if (hasTauriInternals()) {
    void prefs.hydrate();
    void listenWorkspaceFsChanges();
    void restartWorkspaceWatcher(workspaceRoot.value);
  }
  colorSchemeQuery?.addEventListener("change", colorSchemeListener);
  window.addEventListener("languagechange", syncLanguage);
  if (typeof ResizeObserver === "function") {
    rightSplitResizeObserver = new ResizeObserver(measureRightSplitWidth);
    if (rightSplitHost.value) rightSplitResizeObserver.observe(rightSplitHost.value);
  }
  window.addEventListener("resize", measureRightSplitWidth);
  void nextTick(measureRightSplitWidth);
});

onUnmounted(() => {
  colorSchemeQuery?.removeEventListener("change", colorSchemeListener);
  window.removeEventListener("languagechange", syncLanguage);
  rightSplitResizeObserver?.disconnect();
  rightSplitResizeObserver = null;
  window.removeEventListener("resize", measureRightSplitWidth);
  flushSourceControlWidthSave();
  flushExplorerWidthSave();
  stopWorkspaceRefreshFallback();
  if (workspaceFsUnlisten) {
    workspaceFsUnlisten();
    workspaceFsUnlisten = null;
  }
  if (hasTauriInternals()) void native.fsUnwatchWorkspace();
});

watch(resolvedTheme, syncDocumentTheme, { immediate: true });
watch(
  () => prefs.language,
  () => {
    void syncLanguage();
  },
  { immediate: true },
);
watch(
  () => workspaceRootStore.rootPath,
  (rootPath) => {
    void restartWorkspaceWatcher(rootPath);
    if (!rootPath) return;
    if (!tabs.initialized || tabs.tabs.length === 0) tabs.init(rootPath);
  },
  { immediate: true },
);

watch(
  () => prefs.sourceControlPanelWidth,
  (width) => {
    if (!sourceControlWidthSaveTimer) {
      sourceControlPanelWidth.value = clampPanelWidth(width);
    }
  },
  { immediate: true },
);

watch(
  () => prefs.explorerPanelWidth,
  (width) => {
    if (!explorerWidthSaveTimer) {
      explorerPanelWidth.value = clampPanelWidth(width);
    }
  },
  { immediate: true },
);

watch([leftPanelOpen, rightPanelOpen], () => {
  void nextTick(measureRightSplitWidth);
});
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
        <NNotificationProvider>
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
              @new-private-tab="newPrivateTerminalTab"
              @split-pane="splitActivePane"
              @open-settings="openSettings"
              @toggle-left-panel="leftPanelOpen = !leftPanelOpen"
              @toggle-right-panel="rightPanelOpen = !rightPanelOpen"
            />

            <main v-if="hasWorkspace" class="min-h-0 flex-1">
              <NSplit
                class="h-full min-w-0"
                direction="horizontal"
                :size="sourceControlSplitSize"
                :min="sourceControlSplitMin"
                :max="sourceControlSplitMax"
                :disabled="!leftPanelOpen"
                :resize-trigger-size="PANEL_RESIZE_TRIGGER_SIZE"
                :pane1-class="sourceControlPaneClass"
                pane2-class="h-full min-w-0"
                @update:size="updateSourceControlSplitSize"
                @drag-end="flushSourceControlWidthSave"
              >
                <template #1>
                  <SourceControlPanel
                    v-show="leftPanelOpen"
                    :root-path="workspaceRoot"
                    :fs-event="workspaceFsEvent"
                    @open-diff="openSourceDiff"
                    @open-history="openSourceHistory"
                  />
                </template>
                <template #resize-trigger>
                  <div
                    v-if="leftPanelOpen"
                    class="h-full w-full bg-border/30 transition-colors hover:bg-primary/25"
                  />
                </template>
                <template #2>
                  <div ref="rightSplitHost" class="h-full min-w-0">
                    <NSplit
                      class="h-full min-w-0"
                      direction="horizontal"
                      :size="explorerSplitSize"
                      :min="explorerSplitMin"
                      :max="explorerSplitMax"
                      :disabled="!rightPanelOpen"
                      :resize-trigger-size="PANEL_RESIZE_TRIGGER_SIZE"
                      pane1-class="h-full min-w-0"
                      :pane2-class="explorerPaneClass"
                      @update:size="updateExplorerSplitSize"
                      @drag-end="flushExplorerWidthSave"
                    >
                      <template #1>
                        <section class="relative h-full min-w-0 bg-background">
                          <div
                            :class="[
                              'absolute inset-0 px-3 pt-2 pb-2',
                              isTerminalTab ? '' : 'pointer-events-none invisible',
                            ]"
                            :aria-hidden="!isTerminalTab"
                          >
                            <TerminalStack
                              :tabs="tabs.tabs"
                              :active-id="tabs.activeId"
                              @focus-leaf="(tabId, leafId) => tabs.focusPane(tabId, leafId)"
                              @cwd="(leafId, cwd) => tabs.setLeafCwd(leafId, cwd)"
                              @title="(leafId, title) => tabs.setLeafTitle(leafId, title)"
                            />
                          </div>

                          <div
                            :class="[
                              'absolute inset-0 px-3 pt-2 pb-2',
                              isPreviewTab ? '' : 'pointer-events-none invisible',
                            ]"
                            :aria-hidden="!isPreviewTab"
                          >
                            <PreviewStack
                              :tabs="tabs.tabs"
                              :active-id="tabs.activeId"
                              @url-change="(id, url) => tabs.updateTab(id, { url })"
                            />
                          </div>

                          <div
                            :class="[
                              'absolute inset-0 px-3 pt-2 pb-2',
                              isMarkdownTab ? '' : 'pointer-events-none invisible',
                            ]"
                            :aria-hidden="!isMarkdownTab"
                          >
                            <MarkdownStack
                              :tabs="tabs.tabs"
                              :active-id="tabs.activeId"
                            />
                          </div>

                          <div
                            :class="[
                              'absolute inset-0 px-3 pt-2 pb-2',
                              isGitDiffTab ? '' : 'pointer-events-none invisible',
                            ]"
                            :aria-hidden="!isGitDiffTab"
                          >
                            <GitDiffStack
                              :tabs="tabs.tabs"
                              :active-id="tabs.activeId"
                            />
                          </div>

                          <div
                            :class="[
                              'absolute inset-0',
                              isGitHistoryTab ? '' : 'pointer-events-none invisible',
                            ]"
                            :aria-hidden="!isGitHistoryTab"
                          >
                            <GitHistoryStack
                              :tabs="tabs.tabs"
                              :active-id="tabs.activeId"
                              @open-commit-file="(input) => tabs.openCommitFileDiffTab(input)"
                            />
                          </div>

                          <div
                            v-if="activeTab && activeTab.kind === 'editor'"
                            class="absolute inset-0 flex min-h-0 flex-col bg-background px-3 pt-2 pb-2"
                            :class="isEditorTab ? '' : 'pointer-events-none invisible'"
                            :aria-hidden="!isEditorTab"
                          >
                            <EditorPane
                              :path="activeTab.path"
                              @dirty-change="(dirty) => tabs.updateTab(activeTab!.id, { dirty })"
                            />
                          </div>
                        </section>
                      </template>
                      <template #resize-trigger>
                        <div
                          v-if="rightPanelOpen"
                          class="h-full w-full bg-border/30 transition-colors hover:bg-primary/25"
                        />
                      </template>
                      <template #2>
                        <FileExplorer
                          v-show="rightPanelOpen"
                          :root-path="workspaceRoot"
                          :fs-event="workspaceFsEvent"
                          @open-file="openFileTab"
                          @open-markdown-preview="openMarkdownPreview"
                        />
                      </template>
                    </NSplit>
                  </div>
                </template>
              </NSplit>
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
              :private-active="privateActive"
              @choose-workspace="chooseWorkspace"
              @workspace-change="switchWorkspace"
            />

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
