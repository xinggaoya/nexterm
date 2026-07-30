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

import { getCurrentWindow } from "@tauri-apps/api/window";
import { createPinia } from "pinia";
import { createApp } from "vue";
import MainApp from "./app/MainApp.vue";
import { applyLanguagePreference, i18n } from "./modules/i18n";
import { onDeepLinkOpen, type DeepLinkOpenRequest } from "@/lib/native";
import { USE_CUSTOM_WINDOW_CONTROLS } from "@/lib/platform";
import { hasTauriInternals } from "@/lib/tauriRuntime";
import { usePreferencesPiniaStore } from "@/modules/settings/preferencesPinia";
import {
  useWorkspaceRootPiniaStore,
  useWorkspacesPiniaStore,
  type WorkspaceEnv,
} from "@/modules/workspace";

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

const pinia = createPinia();
const app = createApp(MainApp);
app.use(pinia);
app.use(i18n);

// Hydrate preferences + bootstrap workspace stores BEFORE mount so the first
// frame already reflects the persisted theme/accent/language and the open
// workspace set (no welcome-screen flash for returning users). These read
// fast (Tauri store only) and are awaited to keep first paint correct.
const prefs = usePreferencesPiniaStore(pinia);
if (hasTauriInternals()) await prefs.hydrate();
await applyLanguagePreference(prefs.language);
await Promise.all([
  useWorkspacesPiniaStore(pinia).bootstrap(),
  useWorkspaceRootPiniaStore(pinia).bootstrap(),
]);

app.mount("#root");

// Show the window only AFTER the first frame has been composited. Tauri 2
// exposes no "first paint" event, so we use a double requestAnimationFrame:
// the first rAF fires before the frame is committed, the second fires after
// the browser has painted. This guarantees show() never precedes the rendered
// UI, eliminating the transparent/black window flash on Windows & Linux. A
// 1s fallback covers throttled/background rAF (e.g. webview not foreground).
const showWindow = () => {
  getCurrentWindow()
    .show()
    .catch((e) => console.error("window.show failed:", e));
};
requestAnimationFrame(() => requestAnimationFrame(showWindow));
setTimeout(showWindow, 1000);

// Cold-start and runtime deep-link delivery (`nexterm://open?...`) flows
// through the Rust plugin's setup hook into this `nexterm://deep-link-open`
// event. A deep link adds the workspace to the multi-workspace set (or
// focuses it if already open) rather than replacing the current workspace.
if (hasTauriInternals()) {
  const workspacesStore = useWorkspacesPiniaStore(pinia);
  void onDeepLinkOpen((request: DeepLinkOpenRequest) => {
    const env: WorkspaceEnv =
      request.env === "wsl" && request.wslDistro
        ? { kind: "wsl", distro: request.wslDistro }
        : { kind: "local" };
    void workspacesStore.addWorkspace(request.path, env).catch((error: unknown) => {
      console.warn("Failed to open workspace from deep link", error);
    });
  });
}
