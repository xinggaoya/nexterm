// @vitest-environment jsdom
import { describe, expect, it } from "vitest";
import {
  PANEL_MAX_RATIO,
  PANEL_MIN_WIDTH,
  PANEL_OVERLAY_GUTTER,
  RESPONSIVE_BREAKPOINTS,
  resolveResponsivePanelWidth,
} from "./useResponsiveLayout";

/**
 * 响应式断点的边界。
 *
 * 这些数字直接决定「画布还剩多少像素」，所以要钉死：窗口缩到默认的
 * 800×600 时，侧栏必须让位（否则画布只剩 200 多像素），顶栏的动作按钮
 * 必须留在可视区内。
 */
describe("useResponsiveLayout breakpoints", () => {
  it("keeps the sidebar expanded on wide windows and rails it on narrow ones", () => {
    expect(RESPONSIVE_BREAKPOINTS.compact).toBe(900);
    // 800×600 是应用的默认窗口尺寸 —— 必须落在 compact 区间里。
    expect(800).toBeLessThan(RESPONSIVE_BREAKPOINTS.compact);
    expect(1024).toBeGreaterThan(RESPONSIVE_BREAKPOINTS.compact);
  });

  it("caps the side panel so the canvas always keeps a usable share", () => {
    const requested = 328;
    // 宽窗口：用户拖出来的宽度原样生效。
    expect(
      resolveResponsivePanelWidth(requested, 1192, false),
    ).toBe(requested);
    // 窄窗口：按可用宽度的比例收窄，但不能超过用户请求值。
    const capped = resolveResponsivePanelWidth(requested, 700, false);
    expect(capped).toBeLessThanOrEqual(requested);
    expect(capped).toBe(Math.floor(700 * PANEL_MAX_RATIO));
  });

  it("never lets the panel squeeze the canvas below the minimum", () => {
    // 可用空间极少时给一个下限，而不是把面板压成 0。
    expect(resolveResponsivePanelWidth(328, 100, false)).toBe(
      PANEL_MIN_WIDTH,
    );
  });

  it("keeps the requested width in overlay mode but leaves a gutter for the canvas", () => {
    // 覆盖层模式下面板不占布局宽度，只按容器宽度收（要给画布留余量）。
    expect(resolveResponsivePanelWidth(328, 800, true)).toBe(328);
    expect(resolveResponsivePanelWidth(328, 300, true)).toBe(
      300 - PANEL_OVERLAY_GUTTER,
    );
  });
});
