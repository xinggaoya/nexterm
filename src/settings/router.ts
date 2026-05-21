import { createRouter, createWebHashHistory } from "vue-router";
import {
  SETTINGS_DEFAULT_ROUTE,
  SETTINGS_TABS,
  normalizeSettingsRoute,
} from "./routing";
import AboutSection from "./sections/AboutSection.vue";
import AgentsSection from "./sections/AgentsSection.vue";
import GeneralSection from "./sections/GeneralSection.vue";
import ModelsSection from "./sections/ModelsSection.vue";
import ShortcutsSection from "./sections/ShortcutsSection.vue";

const componentByTab = {
  general: GeneralSection,
  shortcuts: ShortcutsSection,
  models: ModelsSection,
  agents: AgentsSection,
  about: AboutSection,
} as const;

export const settingsRouter = createRouter({
  history: createWebHashHistory(),
  routes: [
    { path: "/", redirect: SETTINGS_DEFAULT_ROUTE },
    ...SETTINGS_TABS.map((tab) => ({
      path: `/${tab}`,
      name: tab,
      component: componentByTab[tab],
    })),
    { path: "/:pathMatch(.*)*", redirect: SETTINGS_DEFAULT_ROUTE },
  ],
});

settingsRouter.beforeEach((to) => {
  const normalized = normalizeSettingsRoute(to.path);
  if (normalized !== to.path) return normalized;
  return true;
});
