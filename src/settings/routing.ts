import { SETTINGS_TABS } from "@/modules/settings/tabs";
export type { SettingsTab } from "@/modules/settings/tabs";
export { SETTINGS_TABS } from "@/modules/settings/tabs";

export const SETTINGS_DEFAULT_ROUTE = "/general";

const SETTINGS_ROUTE_SET = new Set<string>(
  SETTINGS_TABS.map((tab) => `/${tab}`),
);

export function settingsRouteFromLegacyTab(tab: string | null): string {
  if (tab === "ai" || tab === "connections") return "/models";
  if (!tab) return SETTINGS_DEFAULT_ROUTE;
  return normalizeSettingsRoute(`/${tab}`);
}

export function normalizeSettingsRoute(path: string): string {
  const normalized = path.startsWith("/") ? path : `/${path}`;
  if (normalized === "/") return SETTINGS_DEFAULT_ROUTE;
  return SETTINGS_ROUTE_SET.has(normalized)
    ? normalized
    : SETTINGS_DEFAULT_ROUTE;
}
