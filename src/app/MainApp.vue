<script setup lang="ts">
import { FolderOutline, GitBranchOutline } from "@vicons/ionicons5";
import {
  NConfigProvider,
  NDialogProvider,
  NIcon,
  NMessageProvider,
  NNotificationProvider,
} from "naive-ui";
import { homeDir } from "@tauri-apps/api/path";
import { computed, nextTick, onMounted, onUnmounted, ref, watch } from "vue";
import AppHeader from "./components/AppHeader.vue";
import AppStatusBar from "./components/AppStatusBar.vue";
import { USE_CUSTOM_WINDOW_CONTROLS } from "@/lib/platform";
import { hasTauriInternals } from "@/lib/tauriRuntime";
import type { StoredWorkspace } from "@/modules/settings/store";
import { openSettingsWindow } from "@/modules/settings/openSettingsWindow";
import { usePreferencesPiniaStore } from "@/modules/settings/preferencesPinia";
import { useTabsPiniaStore } from "@/modules/tabs/tabsPinia";
import { MAX_PANES_PER_TAB } from "@/modules/tabs/tabsTypes";
import {
  getWslHome,
  useWorkspaceEnvPiniaStore,
  useWorkspaceRootPiniaStore,
  type WorkspaceEnv,
} from "@/modules/workspace";
import WorkspaceWelcome from "./components/WorkspaceWelcome.vue";
import FileExplorer from "@/modules/explorer/FileExplorer.vue";
import SourceControlPanel from "@/modules/source-control/SourceControlPanel.vue";
import EditorPane from "@/modules/editor/EditorPane.vue";
import GitDiffStack from "@/modules/editor/GitDiffStack.vue";
import GitHistoryStack from "@/modules/git-history/GitHistoryStack.vue";
import MarkdownStack from "@/modules/markdown/MarkdownStack.vue";
import PreviewStack from "@/modules/preview/PreviewStack.vue";
import { applyTerminalSessionTheme } from "@/modules/terminal";
import TerminalStack from "@/modules/terminal/TerminalStack.vue";
import { leafIds, type SplitDir } from "@/modules/terminal/lib/panes";
import { buildNaiveThemeOverrides, getNaiveTheme } from "@/modules/theme/naiveTheme";
import { readAppTokens, type AppTokens } from "@/styles/tokens";

const prefs = usePreferencesPiniaStore();
const tabs = useTabsPiniaStore();
const workspaceEnv = useWorkspaceEnvPiniaStore();
const workspaceRootStore = useWorkspaceRootPiniaStore();
const sidebarView = ref<"explorer" | "source">("explorer");
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
const resolvedTheme = computed(() => {
  if (prefs.theme === "system") return systemDark.value ? "dark" : "light";
  return prefs.theme;
});
const naiveTheme = computed(() => getNaiveTheme(resolvedTheme.value));
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
  const dirty = tabs.tabs.some((tab) => tab.kind === "editor" && tab.dirty);
  if (dirty) {
    window.alert("Save or close unsaved editor tabs before switching workspace.");
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
  tabs.openFileTab(path, pin);
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

onMounted(() => {
  if (hasTauriInternals()) void prefs.hydrate();
  colorSchemeQuery?.addEventListener("change", colorSchemeListener);
});

onUnmounted(() => {
  colorSchemeQuery?.removeEventListener("change", colorSchemeListener);
});

watch(resolvedTheme, syncDocumentTheme, { immediate: true });
watch(
  () => workspaceRootStore.rootPath,
  (rootPath) => {
    if (!rootPath) return;
    if (!tabs.initialized || tabs.tabs.length === 0) tabs.init(rootPath);
  },
  { immediate: true },
);
</script>

<template>
  <NConfigProvider :theme="naiveTheme" :theme-overrides="themeOverrides">
    <NDialogProvider>
      <NMessageProvider>
        <NNotificationProvider>
          <div class="flex h-screen flex-col overflow-hidden bg-background text-foreground select-none">
            <AppHeader
              :tabs="tabs.tabs"
              :active-id="tabs.activeId"
              :can-split="canSplitActiveTab"
              :workspace-ready="hasWorkspace"
              :show-window-controls="USE_CUSTOM_WINDOW_CONTROLS"
              @select-tab="(id) => tabs.setActiveId(id)"
              @close-tab="(id) => tabs.closeTab(id)"
              @new-tab="newTerminalTab"
              @new-private-tab="newPrivateTerminalTab"
              @split-pane="splitActivePane"
              @open-settings="() => void openSettingsWindow()"
            />

            <main v-if="hasWorkspace" class="flex min-h-0 flex-1">
              <aside class="hidden w-72 shrink-0 border-r border-border/60 bg-card md:block">
                <div class="flex h-full min-h-0">
                  <nav
                    class="flex w-10 shrink-0 flex-col items-center gap-1 border-r border-border/60 bg-card py-2"
                    aria-label="Sidebar"
                  >
                    <button
                      type="button"
                      data-sidebar-explorer
                      title="Explorer"
                      aria-label="Explorer"
                      :aria-pressed="sidebarView === 'explorer'"
                      :class="[
                        'grid h-8 w-8 place-items-center rounded-md text-muted-foreground transition-colors hover:bg-muted hover:text-foreground',
                        sidebarView === 'explorer' ? 'bg-muted text-foreground' : '',
                      ]"
                      @click="sidebarView = 'explorer'"
                    >
                      <NIcon :component="FolderOutline" :size="16" />
                    </button>
                    <button
                      type="button"
                      data-sidebar-source
                      title="Source Control"
                      aria-label="Source Control"
                      :aria-pressed="sidebarView === 'source'"
                      :class="[
                        'grid h-8 w-8 place-items-center rounded-md text-muted-foreground transition-colors hover:bg-muted hover:text-foreground',
                        sidebarView === 'source' ? 'bg-muted text-foreground' : '',
                      ]"
                      @click="sidebarView = 'source'"
                    >
                      <NIcon :component="GitBranchOutline" :size="16" />
                    </button>
                  </nav>
                  <div class="min-w-0 flex-1">
                    <FileExplorer
                      v-if="sidebarView === 'explorer'"
                      :root-path="workspaceRoot"
                      @open-file="openFileTab"
                      @open-markdown-preview="openMarkdownPreview"
                    />
                    <SourceControlPanel
                      v-else
                      :root-path="workspaceRoot"
                      @open-diff="openSourceDiff"
                      @open-history="openSourceHistory"
                    />
                  </div>
                </div>
              </aside>

              <section class="relative min-w-0 flex-1 bg-background">
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
          </div>
        </NNotificationProvider>
      </NMessageProvider>
    </NDialogProvider>
  </NConfigProvider>
</template>
