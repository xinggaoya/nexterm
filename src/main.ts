import "@fontsource/jetbrains-mono/latin-400.css";
import "@fontsource/jetbrains-mono/latin-700.css";
import "@fontsource/jetbrains-mono/latin-400-italic.css";
import "@fontsource/jetbrains-mono/latin-700-italic.css";
import "@fontsource/jetbrains-mono/cyrillic-400.css";
import "@fontsource/jetbrains-mono/cyrillic-700.css";
import "@fontsource-variable/noto-sans-mono";
import "@fontsource/noto-sans-mono";
import "@azurity/pure-nerd-font/pure-nerd-font.css";
import "@xterm/xterm/css/xterm.css";
import "./styles/globals.css";

import { createPinia } from "pinia";
import { createApp } from "vue";
import MainApp from "./app/MainApp.vue";
import { applyLanguagePreference, i18n } from "./modules/i18n";
import { onDeepLinkOpen, type DeepLinkOpenRequest } from "@/lib/native";
import { confirmDeepLinkWorkspace } from "@/lib/confirmDeepLink";
import { USE_CUSTOM_WINDOW_CONTROLS } from "@/lib/platform";
import { installDevtoolsContextMenuRejectionGuard } from "@/lib/devtoolsContextMenuGuard";
import { installDevBridge, resolveDevBridgeBoot } from "@/lib/devBridge";
import { mountDevBridgeUnavailable } from "@/app/devBridgeFallback";
import { hasTauriInternals } from "@/lib/tauriRuntime";
import { usePreferencesPiniaStore } from "@/modules/settings/preferencesPinia";
import { useTabsPiniaStore } from "@/modules/tabs/tabsPinia";
import { perfRecorder } from "@/modules/perf/perfRecorder";
import { bootPerfSession } from "@/modules/perf/perfSession";
import {
  useWorkspaceRootPiniaStore,
  useWorkspacesPiniaStore,
  type WorkspaceEnv,
} from "@/modules/workspace";

// 启动打点：模块求值完成。
perfRecorder.markBoot("module-evaluated");

// Set the borderless chrome flag as the FIRST thing after CSS imports so the
// `html[data-chrome="borderless"]` rules in globals.css (which make html/body
// transparent and give #root its rounded solid background) apply from the very
// first paint. index.html's inline script also pre-sets this for non-mac Tauri
// targets, so this is a belt-and-suspenders match of platform.ts.
// NOTE: `initLaunchDir()` was removed from the boot path — its cache has no
// consumers (deep-link opens via the `nexterm://deep-link-open` event below,
// and backend launch-dir authorization runs independently in Rust setup).
if (USE_CUSTOM_WINDOW_CONTROLS) {
  document.documentElement.dataset.chrome = "borderless";
}

// Keep Nexterm's own right-click menus: the CrabNebula DevTools plugin injects
// a script that pops its native context menu on every `contextmenu` event.
// We deliberately do NOT allow `plugin:devtools-app|show_context_menu`, so the
// native menu can never appear; the plugin script does not catch the rejection,
// so we swallow that one error here.
installDevtoolsContextMenuRejectionGuard();

const pinia = createPinia();
const app = createApp(MainApp);
app.use(pinia);
app.use(i18n);

async function boot(): Promise<void> {
  // 浏览器调试桥：普通浏览器里接管 `__TAURI_INTERNALS__`，把 IPC 转发给
  // 本机正在运行的 nexterm；Tauri 运行时里是空操作。
  //
  // 顺序很重要：先判定启动模式（此刻还没装 shim，`hasTauriInternals()`
  // 反映的是真实运行时），再装 shim —— 装上之后 `hasTauriInternals()`
  // 恒为 true，就再也分不出「跑在桌面里」还是「跑在浏览器里」了。
  //
  // 桥没起来时不能继续往下走：下面的 `prefs.hydrate()` 等会真的发起
  // invoke，而 invoke 会一直重试到超时才 reject，顶层 await 抛错 →
  // 整页白屏。这里改成挂一个说人话的提示页。
  const bootMode = await resolveDevBridgeBoot();
  if (bootMode === "browser-unavailable") {
    mountDevBridgeUnavailable();
    return;
  }
  installDevBridge();

  // Hydrate preferences + bootstrap workspace stores BEFORE mount so the first
  // frame already reflects the persisted theme/accent/language and the open
  // workspace set (no welcome-screen flash for returning users). These read
  // fast (Tauri store only) and are awaited to keep first paint correct.
  const prefs = usePreferencesPiniaStore(pinia);
  if (hasTauriInternals()) {
    await prefs.hydrate();
    // 终端布局快照在偏好 hydrate 之后注入 tabs store：标签恢复发生在
    // WorkspaceHost 挂载早期，那一刻直接读盘会多一次异步往返。
    useTabsPiniaStore().setTerminalLayoutSnapshot(prefs.terminalLayouts);
  }
  await applyLanguagePreference(prefs.language);
  perfRecorder.markBoot("preferences-hydrated");
  await Promise.all([
    useWorkspacesPiniaStore(pinia).bootstrap(),
    useWorkspaceRootPiniaStore(pinia).bootstrap(),
  ]);
  perfRecorder.markBoot("workspaces-hydrated");

  app.mount("#root");
  perfRecorder.markBoot("mounted");

  // 性能录制：仅当后端处于录制态（带 NEXTERM_PERF_DIR / --perf-dir= 启动）时
  // 才会真正开始采集；否则这里只是一次 IPC 探测。放在 mount 之后是为了不
  // 拖慢首屏——探测是异步的，与后续的挂载工作并行。
  void bootPerfSession();

  // Cold-start and runtime deep-link delivery (`nexterm://open?...`) flows
  // through the Rust plugin's setup hook into this `nexterm://deep-link-open`
  // event. A deep link adds the workspace to the multi-workspace set (or
  // focuses it if already open) rather than replacing the current workspace.
  //
  // 深链是**外部输入**：诱导用户点击 `nexterm://open?workspacePath=C:\Users\x\.ssh`
  // 就能把凭据目录变成工作区 —— 也就是一次「授权」，而授权等于后续 fs 读写
  // 的通行证。所以这里必须先弹确认，用户点了才走 addWorkspace。已打开的
  // 工作区不需要确认（只是切焦点，不扩大权限面）。
  if (hasTauriInternals()) {
    const workspacesStore = useWorkspacesPiniaStore(pinia);
    void onDeepLinkOpen((request: DeepLinkOpenRequest) => {
      const env: WorkspaceEnv =
        request.env === "wsl" && request.wslDistro
          ? { kind: "wsl", distro: request.wslDistro }
          : { kind: "local" };
      void (async () => {
        try {
          const confirmed = await confirmDeepLinkWorkspace(request.path);
          if (!confirmed) {
            console.info("deep link workspace rejected by user", request.path);
            return;
          }
          await workspacesStore.addWorkspace(request.path, env);
        } catch (error: unknown) {
          console.warn("Failed to open workspace from deep link", error);
        }
      })();
    });
  }
}

void boot();
