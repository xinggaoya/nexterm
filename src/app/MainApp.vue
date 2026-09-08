<script setup lang="ts">
import {
  NConfigProvider,
  NDialogProvider,
  NDrawer,
  NDrawerContent,
  NMessageProvider,
  NNotificationProvider,
} from "naive-ui";
import { computed, nextTick, onMounted, onUnmounted, ref, watch } from "vue";
import TitleBar from "./shell/TitleBar.vue";
import StatusBar from "./shell/StatusBar.vue";
import WorkspaceHost from "./shell/WorkspaceHost.vue";
import CommandPalette from "@/modules/commands/CommandPalette.vue";
import AIPanel from "@/app/components/AIPanel.vue";
import { applyLanguagePreference } from "@/modules/i18n";
import { t } from "@/modules/i18n/translate";
import { getNaiveLocaleConfig } from "@/modules/i18n/naive";
import { resolveAppLocale } from "@/modules/i18n/types";
import { USE_CUSTOM_WINDOW_CONTROLS } from "@/lib/platform";
import { hasTauriInternals } from "@/lib/tauriRuntime";
import { useEventListener } from "@/lib/useEventListener";
import { getCurrentWindow } from "@tauri-apps/api/window";
import {
  SETTINGS_DEFAULT_TAB,
  type SettingsTab,
} from "@/modules/settings/tabs";
import { usePreferencesPiniaStore } from "@/modules/settings/preferencesPinia";
import { useTabsPiniaStore } from "@/modules/tabs/tabsPinia";
import NotificationBridge from "@/modules/notifications/NotificationBridge.vue";
import {
  useWorkspacesPiniaStore,
  useWorkspaceRootPiniaStore,
  useWorkspaceEnvPiniaStore,
  type WorkspaceEnv,
  type WorkspaceSelection,
} from "@/modules/workspace";
import WorkspaceWelcome from "./components/WorkspaceWelcome.vue";
import UnsavedCloseGuard from "./components/UnsavedCloseGuard.vue";
import RenameTerminalDialog from "./components/RenameTerminalDialog.vue";
import { applyTerminalSessionTheme } from "@/modules/terminal";
import { configureTerminalSessionDisposer } from "@/modules/tabs/terminalDisposal";
import {
  disposeAllSessions,
  disposeSession,
} from "@/modules/terminal/lib/sessions";
import { buildNaiveThemeOverrides, getNaiveTheme } from "@/modules/theme/naiveTheme";
import { notifyError } from "@/modules/notifications/notificationCenter";
import { FALLBACK_APP_TOKENS, readAppTokens } from "@/styles/tokens";
import SettingsPanel from "@/settings/SettingsPanel.vue";
import { useWorkbenchLayout } from "./useWorkbenchLayout";
import { useWindowChromeState } from "./useWindowChromeState";
import {
  disposeAppUpdaterSingleton,
  useAppUpdater,
} from "./useAppUpdater";

const prefs = usePreferencesPiniaStore();
const tabs = useTabsPiniaStore();
const workspaces = useWorkspacesPiniaStore();
const workspaceRootStore = useWorkspaceRootPiniaStore();
const workspaceEnv = useWorkspaceEnvPiniaStore();

const settingsOpen = ref(false);
const activeSettingsTab = ref<SettingsTab>(SETTINGS_DEFAULT_TAB);
const SETTINGS_DRAWER_WIDTH = "min(720px, calc(100vw - 32px))";

// v2 — AI assistant panel placeholder toggle. The panel itself lands in
// phase 5; for now this only opens/closes a reserved surface so the
// title-bar affordance is wired end-to-end.
const aiPanelOpen = ref(false);
// closeGuard is wired via template ref on UnsavedCloseGuard; the guard emits
// close-tab events handled directly in the template.

// ── Window-close PTY teardown listener. WorkspaceHost.onBeforeUnmount already
// reclaims sessions when a workspace is removed, and a normal close unmounts
// every host — but we register an additional best-effort `disposeAllSessions`
// on CloseRequested so backend PTY processes are killed even if a host fails
// to unmount cleanly (crash, hot-reload residue). Multiple onCloseRequested
// listeners coexist; this one never calls preventDefault.
// Typed loosely to avoid importing UnlistenFn from the Tauri event module
// (kept out of MainApp by the event-boundary rule; see eventBoundary.test.ts).
let windowCloseUnlisten: (() => void) | null = null;

// ── Terminal disposal wiring ────────────────────────────────────────────
// The tabs store calls `disposeTerminalSession(leafId)` when closing tabs.
// Leaf ids are workspace-local numbers, so the owning workspace is unknown
// here; we try every workspace bucket — disposeSession is a no-op when the
// leaf isn't found, so this is safe (and only runs on close).
configureTerminalSessionDisposer((leafId) => {
  const raw = String(leafId);
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
const themeOverrides = ref(buildNaiveThemeOverrides(FALLBACK_APP_TOKENS));
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
// 每个 workspace 的源控面板上抛当前分支（WorkspaceHost 转发），状态栏读
// 活动工作区的那一份。无 repo / 无数据时为 null，显示占位符。
const branchByWorkspace = ref<Record<string, string | null>>({});
const activeGitBranch = computed(
  () => branchByWorkspace.value[workspaces.activeWorkspaceId ?? ""] ?? null,
);
function onWorkspaceBranchChange(workspaceId: string, branch: string | null): void {
  branchByWorkspace.value[workspaceId] = branch;
}
// 工作区关闭时清掉对应分支记录，避免残留键值。
watch(
  () => workspaces.workspaces.map((ws) => ws.id),
  (ids) => {
    for (const key of Object.keys(branchByWorkspace.value)) {
      if (!ids.includes(key)) delete branchByWorkspace.value[key];
    }
  },
);

const workbenchLayout = useWorkbenchLayout({ prefs });
useWindowChromeState();
const { startLayoutObservers, stopLayoutObservers, togglePanel } =
  workbenchLayout;

// 底部栏面板切换的总入口：explorer/sourceControl/workspace 走 layout 的
// togglePanel（已联动对应面板），taskConsole 单独驱动活动工作区的控制器
// （因为 taskConsole 状态是 per-workspace 的）。
function handleTogglePanel(key: Parameters<typeof togglePanel>[0]): void {
  if (key !== "taskConsole") {
    togglePanel(key);
    return;
  }
  const taskConsole = activeHost.value?.taskConsole;
  if (!taskConsole) return;
  if (taskConsole.isOpen?.value) {
    taskConsole.close();
    workbenchLayout.panelVisibility.value.taskConsole = false;
  } else {
    void taskConsole.open();
    workbenchLayout.panelVisibility.value.taskConsole = true;
  }
}

function syncDocumentTheme() {
  const root = document.documentElement;
  root.classList.remove("light", "dark");
  root.classList.add(resolvedTheme.value);
  // Accent palette — pinned on <html> so the [data-accent="<id>"] rules
  // in globals.css override the light/dark defaults for hue-bearing
  // tokens. The matching --nexterm-accent inline property also lives on
  // <html>'s `style` attribute so xterm's MutationObserver (which only
  // listens to class/style mutations) re-reads --term-* on switch.
  root.dataset.accent = prefs.accent;
  root.style.setProperty("--nexterm-accent", prefs.accent);
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
async function startAddWorkspace(env: WorkspaceEnv) {
  try {
    const selection = await workspaceRootStore.pickWorkspaceDirectory(env);
    if (!selection) return;
    await workspaces.addWorkspace(selection.path, selection.env);
  } catch (error) {
    notifyError(t("app.workspace.addFailed"), error);
  }
}

async function openWorkspaceInNewWindow(env: WorkspaceEnv = workspaceEnv.pendingEnv) {
  try {
    const selection = await workspaceRootStore.pickWorkspaceDirectory(env);
    if (!selection) return;
    const { openWorkspaceInNewWindow } = await import(
      "@/modules/workspace/workspaceWindow"
    );
    const webview = await openWorkspaceInNewWindow(selection);
    void webview.once("tauri://error", (event) => {
      notifyError(t("app.workspace.openWindowFailed"), event.payload);
    });
  } catch (error) {
    notifyError(t("app.workspace.openWindowFailed"), error);
  }
}

// ── Welcome screen actions (no workspace open) ──────────────────────────
async function chooseWorkspaceFromWelcome(env: WorkspaceEnv) {
  await startAddWorkspace(env);
}

async function openRecentWorkspace(record: WorkspaceSelection & { openedAt?: number }) {
  try {
    await workspaces.addWorkspace(record.path, record.env);
  } catch (error) {
    notifyError(t("app.workspace.addFailed"), error);
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
// 单一事实源：有活动 host 时直接读写 host 的 commandPaletteOpen；
// 没有 host（无工作区）时回落到本地 ref。不再用两个 watch 互相同步。
const localPaletteOpen = ref(false);
const commandPaletteOpen = computed<boolean>({
  get: () =>
    activeCommandApi.value?.commandPaletteOpen.value ?? localPaletteOpen.value,
  set: (open) => {
    if (activeCommandApi.value) {
      activeCommandApi.value.commandPaletteOpen.value = open;
    } else {
      localPaletteOpen.value = open;
    }
  },
});

// WorkspaceHost instance refs, keyed by workspace id. The *active* host's
// `commandApi` drives the global command palette + keybindings.
const workspaceHostRefs = ref<Record<string, InstanceType<typeof WorkspaceHost> | null>>({});
function setWorkspaceHostRef(id: string, el: InstanceType<typeof WorkspaceHost> | null) {
  workspaceHostRefs.value[id] = el;
}
const activeHost = computed(
  () =>
    (workspaces.activeWorkspaceId
      ? workspaceHostRefs.value[workspaces.activeWorkspaceId]
      : null) ?? null,
);
const activeCommandApi = computed(() => activeHost.value?.commandApi ?? null);

// 活动工作区的 TaskConsole 开关状态。底部栏 taskConsole 按钮据此亮起，
// 并通过 handleTogglePanel 驱动活动工作区的 taskConsole 控制器。
const activeTaskConsoleOpen = computed(
  () => activeHost.value?.taskConsole?.isOpen?.value ?? false,
);

// Derive the palette's reactive inputs from the active host's command api.
// When no workspace is open these resolve to safe empties.
const paletteCommands = computed(() => activeCommandApi.value?.commandDefinitions.value ?? []);
const paletteKeybindings = computed(
  () => activeCommandApi.value?.resolvedCommandKeybindings.value ?? {},
);
const paletteContext = computed(() =>
  activeCommandApi.value
    ? activeCommandApi.value.commandContext.value
    : { workspaceReady: false },
);
const commandPaletteMode = computed({
  get: () => activeCommandApi.value?.commandPaletteMode.value ?? "commands",
  set: (v) => {
    if (activeCommandApi.value) activeCommandApi.value.commandPaletteMode.value = v;
  },
});
function openCommandPalette(mode?: "commands" | "files") {
  if (activeCommandApi.value) activeCommandApi.value.openCommandPalette(mode);
  else commandPaletteOpen.value = true;
}

function executeCommandFromPalette(id: Parameters<NonNullable<InstanceType<typeof WorkspaceHost>["commandApi"]>["executeCommandFromPalette"]>[0]) {
  void activeCommandApi.value?.executeCommandFromPalette(id);
}
function openFileFromCommandPalette(path: string) {
  activeCommandApi.value?.openFileFromCommandPalette(path);
}

function handleGlobalCommandKeydown(event: KeyboardEvent) {
  activeCommandApi.value?.handleGlobalCommandKeydown(event);
}

onMounted(() => {
  if (hasTauriInternals()) void prefs.hydrate();
  startLayoutObservers();
  window.addEventListener("keydown", handleGlobalCommandKeydown, true);
  // 自动更新检查（启动延迟 30s + 每 8 小时复查）；每次触发时实时读
  // "自动检查更新"偏好，关闭开关后后续轮次自动跳过。
  useAppUpdater().startAutoUpdateChecks(() => prefs.autoCheckUpdates);
  // Best-effort PTY teardown on window close (see windowCloseUnlisten comment).
  if (hasTauriInternals()) {
    getCurrentWindow()
      .onCloseRequested(() => {
        disposeAllSessions();
      })
      .then((unlisten) => {
        windowCloseUnlisten = unlisten;
      })
      .catch((error) => {
        console.warn("window close PTY teardown unavailable:", error);
      });
  }
});

if (colorSchemeQuery) {
  useEventListener(colorSchemeQuery, "change", colorSchemeListener);
}
useEventListener(window, "languagechange", syncLanguage);
useEventListener(window, "contextmenu", preventNativeContextMenu);

onUnmounted(() => {
  stopLayoutObservers();
  window.removeEventListener("keydown", handleGlobalCommandKeydown, true);
  windowCloseUnlisten?.();
  windowCloseUnlisten = null;
  disposeAppUpdaterSingleton();
});

watch(resolvedTheme, syncDocumentTheme, { immediate: true });
watch(() => prefs.accent, syncDocumentTheme);
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
              :show-window-controls="USE_CUSTOM_WINDOW_CONTROLS"
              @open-command-palette="openCommandPalette('commands')"
              @open-settings="openSettings"
              @open-ai-assistant="aiPanelOpen = !aiPanelOpen"
              @select-workspace="(id) => workspaces.setActive(id)"
              @close-workspace="(id) => workspaces.removeWorkspace(id)"
              @add-workspace="(env) => startAddWorkspace(env)"
              @open-in-new-window="() => openWorkspaceInNewWindow()"
            />
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
                :ref="(el) => setWorkspaceHostRef(ws.id, el as InstanceType<typeof WorkspaceHost> | null)"
                v-show="ws.id === workspaces.activeWorkspaceId"
                :workspace="ws"
                @add-workspace="(env) => startAddWorkspace(env)"
                @open-in-new-window="() => openWorkspaceInNewWindow()"
                @request-settings="(tab) => openSettings(tab)"
                @request-command-palette="(mode) => openCommandPalette(mode)"
                @request-rename="(payload) => (renameDialogState = payload)"
                @branch-change="onWorkspaceBranchChange"
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
              :workspace-name="activeWorkspace?.name ?? null"
              :git-branch="activeGitBranch"
              :panel-states="{
                workspace:
                  workbenchLayout.leftSidebar.value.open &&
                  workbenchLayout.leftSidebar.value.activity === 'workspace',
                sourceControl:
                  workbenchLayout.leftSidebar.value.open &&
                  workbenchLayout.leftSidebar.value.activity ===
                    'sourceControl',
                explorer: workbenchLayout.panelVisibility.value.explorer,
                taskConsole: activeTaskConsoleOpen,
              }"
              @toggle-panel="handleTogglePanel"
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

            <RenameTerminalDialog
              :show="renameDialogState !== null"
              :current-title="renameDialogState?.currentTitle ?? ''"
              @submit="commitRename"
              @cancel="cancelRename"
            />

            <!-- AI assistant drawer (v2 placeholder; implementation in AIPanel.vue). -->
            <NDrawer
              v-model:show="aiPanelOpen"
              placement="right"
              :width="380"
              :auto-focus="false"
            >
              <NDrawerContent body-content-style="height: 100%; padding: 0;">
                <AIPanel @close="aiPanelOpen = false" />
              </NDrawerContent>
            </NDrawer>

            <!-- Command palette overlay — driven by the active workspace's
                 command api. Rendered globally so it floats above everything. -->
            <CommandPalette
              v-if="activeCommandApi"
              :show="commandPaletteOpen"
              :mode="commandPaletteMode"
              :commands="paletteCommands"
              :keybindings="paletteKeybindings"
              :context="paletteContext"
              :workspace-root="workspaceRoot"
              :show-hidden="prefs.showHidden"
              @close="commandPaletteOpen = false"
              @execute-command="executeCommandFromPalette"
              @open-file="openFileFromCommandPalette"
            />
          </div>
        </NNotificationProvider>
      </NMessageProvider>
    </NDialogProvider>
  </NConfigProvider>
</template>
