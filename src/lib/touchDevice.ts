import { computed, type ComputedRef } from "vue";
import { usePreferencesPiniaStore } from "@/modules/settings/preferencesPinia";

type TouchMode = "auto" | "on" | "off";

let cachedDetection: boolean | null = null;

export function isTouchDevice(): boolean {
  if (cachedDetection !== null) return cachedDetection;
  if (typeof window === "undefined") {
    cachedDetection = false;
    return false;
  }
  const hasTouchEvent = "ontouchstart" in window;
  const hasTouchPoints =
    typeof navigator !== "undefined" &&
    typeof navigator.maxTouchPoints === "number" &&
    navigator.maxTouchPoints > 0;
  cachedDetection = hasTouchEvent || hasTouchPoints;
  return cachedDetection;
}

/** Test-only escape hatch: re-runs the touch probe. */
export function resetTouchDeviceCache(): void {
  cachedDetection = null;
}

function readTouchMode(): TouchMode {
  try {
    return usePreferencesPiniaStore().touchOptimizations;
  } catch {
    return "auto";
  }
}

export type TouchDevicePreference = {
  touchMode: ComputedRef<TouchMode>;
  effectiveTouch: ComputedRef<boolean>;
};

export function useTouchDevicePreference(): TouchDevicePreference {
  const touchMode = computed<TouchMode>(() => readTouchMode());
  const effectiveTouch = computed<boolean>(() => {
    const mode = readTouchMode();
    if (mode === "on") return true;
    if (mode === "off") return false;
    return isTouchDevice();
  });
  return { touchMode, effectiveTouch };
}
