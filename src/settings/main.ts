import "@fontsource/jetbrains-mono/latin-400.css";
import "@fontsource/jetbrains-mono/latin-700.css";
import "@fontsource/jetbrains-mono/cyrillic-400.css";
import "@fontsource/jetbrains-mono/cyrillic-700.css";
import "../styles/globals.css";

import { getCurrentWindow } from "@tauri-apps/api/window";
import { getCurrentWebviewWindow } from "@tauri-apps/api/webviewWindow";
import { createPinia } from "pinia";
import { createApp } from "vue";
import { USE_CUSTOM_WINDOW_CONTROLS } from "@/lib/platform";
import SettingsApp from "./SettingsApp.vue";
import { settingsRouteFromLegacyTab } from "./routing";
import { settingsRouter } from "./router";

if (USE_CUSTOM_WINDOW_CONTROLS) {
  document.documentElement.dataset.chrome = "borderless";
}

const legacyTab = new URL(window.location.href).searchParams.get("tab");
if (legacyTab) {
  void settingsRouter.replace(settingsRouteFromLegacyTab(legacyTab));
}

void getCurrentWebviewWindow().listen<string>("nexterm:settings-tab", (event) => {
  void settingsRouter.replace(settingsRouteFromLegacyTab(event.payload));
});

createApp(SettingsApp)
  .use(createPinia())
  .use(settingsRouter)
  .mount("#settings-root");

const showWindow = () => {
  getCurrentWindow()
    .show()
    .catch((e) => console.error("settings show failed:", e));
};
setTimeout(showWindow, 50);
setTimeout(showWindow, 500);
