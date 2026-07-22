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
import { initLaunchDir } from "./lib/launchDir";
import { onDeepLinkOpen, type DeepLinkOpenRequest } from "@/lib/native";
import { USE_CUSTOM_WINDOW_CONTROLS } from "@/lib/platform";
import { hasTauriInternals } from "@/lib/tauriRuntime";
import { usePreferencesPiniaStore } from "@/modules/settings/preferencesPinia";
import {
  useWorkspaceRootPiniaStore,
  useWorkspacesPiniaStore,
  type WorkspaceEnv,
} from "@/modules/workspace";

if (USE_CUSTOM_WINDOW_CONTROLS) {
  document.documentElement.dataset.chrome = "borderless";
}

await initLaunchDir();

const pinia = createPinia();
const app = createApp(MainApp);
app.use(pinia);
app.use(i18n);

const prefs = usePreferencesPiniaStore(pinia);
if (hasTauriInternals()) await prefs.hydrate();
await applyLanguagePreference(prefs.language);
// Bootstrap both stores: workspaces (restores the open-workspace set) and
// the root store (recent history). The launch-dir/deep-link path now adds a
// workspace rather than replacing the single active one.
await Promise.all([
  useWorkspacesPiniaStore(pinia).bootstrap(),
  useWorkspaceRootPiniaStore(pinia).bootstrap(),
]);

app.mount("#root");

const showWindow = () => {
  getCurrentWindow()
    .show()
    .catch((e) => console.error("window.show failed:", e));
};
setTimeout(showWindow, 50);
setTimeout(showWindow, 500);

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
