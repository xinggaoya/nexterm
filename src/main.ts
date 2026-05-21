import "@fontsource/jetbrains-mono/latin-400.css";
import "@fontsource/jetbrains-mono/latin-700.css";
import "@fontsource/jetbrains-mono/cyrillic-400.css";
import "@fontsource/jetbrains-mono/cyrillic-700.css";
import "@xterm/xterm/css/xterm.css";
import "./styles/globals.css";

import { getCurrentWindow } from "@tauri-apps/api/window";
import { createPinia } from "pinia";
import { createApp } from "vue";
import MainApp from "./app/MainApp.vue";
import { initLaunchDir, getLaunchDir } from "./lib/launchDir";
import { USE_CUSTOM_WINDOW_CONTROLS } from "./lib/platform";
import { hasTauriInternals } from "./lib/tauriRuntime";
import { usePreferencesPiniaStore } from "./modules/settings/preferencesPinia";
import { useTabsPiniaStore } from "./modules/tabs/tabsPinia";

if (USE_CUSTOM_WINDOW_CONTROLS) {
  document.documentElement.dataset.chrome = "borderless";
}

await initLaunchDir();

const pinia = createPinia();
const app = createApp(MainApp);
app.use(pinia);

const tabs = useTabsPiniaStore(pinia);
tabs.init(getLaunchDir() ?? undefined);
if (hasTauriInternals()) void usePreferencesPiniaStore(pinia).hydrate();

app.mount("#root");

const showWindow = () => {
  getCurrentWindow()
    .show()
    .catch((e) => console.error("window.show failed:", e));
};
setTimeout(showWindow, 50);
setTimeout(showWindow, 500);
