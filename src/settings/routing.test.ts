import { describe, expect, it } from "vitest";
import {
  SETTINGS_DEFAULT_ROUTE,
  normalizeSettingsRoute,
  settingsRouteFromLegacyTab,
} from "./routing";

describe("settings routing", () => {
  it("maps known legacy tab query values to hash routes", () => {
    expect(settingsRouteFromLegacyTab("general")).toBe("/general");
    expect(settingsRouteFromLegacyTab("about")).toBe("/about");
  });

  it("falls back for removed AI and shortcut settings tabs", () => {
    for (const tab of ["ai", "connections", "models", "agents", "shortcuts"]) {
      expect(settingsRouteFromLegacyTab(tab)).toBe(SETTINGS_DEFAULT_ROUTE);
    }
  });

  it("falls back to the default route for unknown or empty tab values", () => {
    expect(settingsRouteFromLegacyTab(null)).toBe(SETTINGS_DEFAULT_ROUTE);
    expect(settingsRouteFromLegacyTab("")).toBe(SETTINGS_DEFAULT_ROUTE);
    expect(settingsRouteFromLegacyTab("missing")).toBe(SETTINGS_DEFAULT_ROUTE);
  });

  it("normalizes router paths without allowing unknown settings pages", () => {
    expect(normalizeSettingsRoute("/")).toBe(SETTINGS_DEFAULT_ROUTE);
    expect(normalizeSettingsRoute("/models")).toBe(SETTINGS_DEFAULT_ROUTE);
    expect(normalizeSettingsRoute("models")).toBe(SETTINGS_DEFAULT_ROUTE);
    expect(normalizeSettingsRoute("/shortcuts")).toBe(SETTINGS_DEFAULT_ROUTE);
    expect(normalizeSettingsRoute("/agents")).toBe(SETTINGS_DEFAULT_ROUTE);
    expect(normalizeSettingsRoute("/missing")).toBe(SETTINGS_DEFAULT_ROUTE);
  });
});
