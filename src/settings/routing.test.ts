import { describe, expect, it } from "vitest";
import {
  SETTINGS_DEFAULT_ROUTE,
  normalizeSettingsRoute,
  settingsRouteFromLegacyTab,
} from "./routing";

describe("settings routing", () => {
  it("maps known legacy tab query values to hash routes", () => {
    expect(settingsRouteFromLegacyTab("general")).toBe("/general");
    expect(settingsRouteFromLegacyTab("shortcuts")).toBe("/shortcuts");
    expect(settingsRouteFromLegacyTab("models")).toBe("/models");
    expect(settingsRouteFromLegacyTab("agents")).toBe("/agents");
    expect(settingsRouteFromLegacyTab("about")).toBe("/about");
  });

  it("keeps backward compatibility for legacy ai and connections tabs", () => {
    expect(settingsRouteFromLegacyTab("ai")).toBe("/models");
    expect(settingsRouteFromLegacyTab("connections")).toBe("/models");
  });

  it("falls back to the default route for unknown or empty tab values", () => {
    expect(settingsRouteFromLegacyTab(null)).toBe(SETTINGS_DEFAULT_ROUTE);
    expect(settingsRouteFromLegacyTab("")).toBe(SETTINGS_DEFAULT_ROUTE);
    expect(settingsRouteFromLegacyTab("missing")).toBe(SETTINGS_DEFAULT_ROUTE);
  });

  it("normalizes router paths without allowing unknown settings pages", () => {
    expect(normalizeSettingsRoute("/")).toBe(SETTINGS_DEFAULT_ROUTE);
    expect(normalizeSettingsRoute("/models")).toBe("/models");
    expect(normalizeSettingsRoute("models")).toBe("/models");
    expect(normalizeSettingsRoute("/missing")).toBe(SETTINGS_DEFAULT_ROUTE);
  });
});
