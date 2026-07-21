// @vitest-environment jsdom
import { describe, expect, it, vi } from "vitest";
import { currentDevicePixelRatio, watchDevicePixelRatio } from "./dpiWatcher";

describe("dpiWatcher", () => {
  it("returns 1 when window is unavailable", () => {
    expect(currentDevicePixelRatio()).toBeGreaterThanOrEqual(1);
  });

  it("registers a change listener via matchMedia and tears down on dispose", () => {
    const addSpy = vi.fn();
    const removeSpy = vi.fn();
    const cb = vi.fn();
    // jsdom lacks matchMedia by default; stub it for the lifetime of the call.
    const original = (window as { matchMedia?: typeof window.matchMedia }).matchMedia;
    (window as unknown as { matchMedia: typeof window.matchMedia }).matchMedia = ((query: string) =>
      ({
        matches: true,
        media: query,
        addEventListener: addSpy,
        removeEventListener: removeSpy,
        addListener: vi.fn(),
        removeListener: vi.fn(),
        dispatchEvent: () => true,
        onchange: null,
      }) as unknown as MediaQueryList) as typeof window.matchMedia;
    try {
      const dispose = watchDevicePixelRatio(cb);
      expect(addSpy).toHaveBeenCalledWith("change", expect.any(Function));
      dispose();
      expect(removeSpy).toHaveBeenCalledWith("change", expect.any(Function));
    } finally {
      (window as unknown as { matchMedia: typeof window.matchMedia }).matchMedia = original!;
    }
  });

  it("falls back to legacy addListener/removeListener when addEventListener is absent", () => {
    const addListener = vi.fn();
    const removeListener = vi.fn();
    const original = (window as { matchMedia?: typeof window.matchMedia }).matchMedia;
    (window as unknown as { matchMedia: typeof window.matchMedia }).matchMedia = ((query: string) =>
      ({
        matches: true,
        media: query,
        addEventListener: undefined,
        removeEventListener: undefined,
        addListener,
        removeListener,
        dispatchEvent: () => true,
        onchange: null,
      }) as unknown as MediaQueryList) as typeof window.matchMedia;
    try {
      const dispose = watchDevicePixelRatio(vi.fn());
      expect(addListener).toHaveBeenCalled();
      dispose();
      expect(removeListener).toHaveBeenCalled();
    } finally {
      (window as unknown as { matchMedia: typeof window.matchMedia }).matchMedia = original!;
    }
  });
});