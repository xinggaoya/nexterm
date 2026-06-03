// @vitest-environment jsdom
import { createPinia, setActivePinia } from "pinia";
import { beforeEach, describe, expect, it } from "vitest";
import {
  isTouchDevice,
  resetTouchDeviceCache,
  useTouchDevicePreference,
} from "./touchDevice";
import { usePreferencesPiniaStore } from "@/modules/settings/preferencesPinia";

function setMaxTouchPoints(value: number): void {
  Object.defineProperty(navigator, "maxTouchPoints", {
    configurable: true,
    value,
  });
}

function setOnTouchStart(value: boolean): void {
  if (value) {
    (window as unknown as Record<string, unknown>).ontouchstart = null;
  } else {
    delete (window as unknown as Record<string, unknown>).ontouchstart;
  }
}

describe("touchDevice", () => {
  beforeEach(() => {
    setActivePinia(createPinia());
    setOnTouchStart(false);
    setMaxTouchPoints(0);
    resetTouchDeviceCache();
  });

  it("reports non-touch in a default jsdom environment", () => {
    expect(isTouchDevice()).toBe(false);
  });

  it("detects touch when navigator.maxTouchPoints is positive", () => {
    setMaxTouchPoints(2);
    expect(isTouchDevice()).toBe(true);
  });

  it("detects touch when window provides ontouchstart", () => {
    setOnTouchStart(true);
    expect(isTouchDevice()).toBe(true);
  });

  it("caches the detection result across calls", () => {
    expect(isTouchDevice()).toBe(false);
    setMaxTouchPoints(5);
    expect(isTouchDevice()).toBe(false);
    resetTouchDeviceCache();
    expect(isTouchDevice()).toBe(true);
  });

  it("derives effectiveTouch from auto preference and detection", () => {
    const prefs = usePreferencesPiniaStore();
    prefs.touchOptimizations = "auto";
    setMaxTouchPoints(0);
    setOnTouchStart(false);
    resetTouchDeviceCache();
    expect(useTouchDevicePreference().effectiveTouch.value).toBe(false);

    resetTouchDeviceCache();
    setMaxTouchPoints(3);
    expect(useTouchDevicePreference().effectiveTouch.value).toBe(true);
  });

  it("forces effectiveTouch on when the preference is on", () => {
    const prefs = usePreferencesPiniaStore();
    prefs.touchOptimizations = "on";
    expect(useTouchDevicePreference().effectiveTouch.value).toBe(true);
    expect(useTouchDevicePreference().touchMode.value).toBe("on");
  });

  it("forces effectiveTouch off when the preference is off", () => {
    const prefs = usePreferencesPiniaStore();
    prefs.touchOptimizations = "off";
    setMaxTouchPoints(3);
    expect(useTouchDevicePreference().effectiveTouch.value).toBe(false);
    expect(useTouchDevicePreference().touchMode.value).toBe("off");
  });
});
