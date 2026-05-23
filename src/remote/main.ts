import "@fontsource/jetbrains-mono/latin-400.css";
import "@fontsource/jetbrains-mono/latin-700.css";
import "@xterm/xterm/css/xterm.css";
import "@/styles/globals.css";
import "./remote.css";

import { createApp } from "vue";
import RemoteApp from "./RemoteApp.vue";

createApp(RemoteApp).mount("#remote-root");
