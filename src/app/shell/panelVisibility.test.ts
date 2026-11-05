import { describe, expect, it } from "vitest";
import type { PanelLayoutPref } from "@/modules/settings/store";
import {
  assignPanelView,
  MIN_CANVAS_WIDTH,
  PANEL_MAX_RATIO,
  resolvePanelViewToggle,
  resolvePanelWidths,
} from "./panelVisibility";

describe("resolvePanelWidths", () => {
  it("两侧都展开时按请求宽度分配", () => {
    const widths = resolvePanelWidths(
      1920,
      { requested: 320, open: true },
      { requested: 320, open: true },
    );
    expect(widths).toEqual({ left: 320, right: 320 });
  });

  it("收起的一侧不占宽度", () => {
    const widths = resolvePanelWidths(
      1920,
      { requested: 320, open: false },
      { requested: 320, open: true },
    );
    expect(widths).toEqual({ left: 0, right: 320 });
  });

  it("单侧不超过容器宽度的 45%", () => {
    const widths = resolvePanelWidths(
      1000,
      { requested: 900, open: true },
      { requested: 320, open: false },
    );
    expect(widths.left).toBe(Math.floor(1000 * PANEL_MAX_RATIO));
  });

  it("两侧加起来不能把画布挤到最小宽以下（超预算等比压缩）", () => {
    const widths = resolvePanelWidths(
      800,
      { requested: 320, open: true },
      { requested: 320, open: true },
    );
    expect(widths.left + widths.right).toBeLessThanOrEqual(
      800 - MIN_CANVAS_WIDTH,
    );
    // 压缩后画布仍有余量。
    expect(800 - widths.left - widths.right).toBeGreaterThanOrEqual(MIN_CANVAS_WIDTH);
  });
});

describe("assignPanelView", () => {
  it("把视图放到另一侧已占用的视图上 → 两侧对调", () => {
    // 右侧已是文件树，把文件树放到左侧 → 左侧换成右侧原来的视图。
    const layout = assignPanelView(
      { left: "changes", right: "explorer" },
      "left",
      "explorer",
    );
    expect(layout).toEqual({ left: "explorer", right: "changes" });
    expect(layout.left).not.toBe(layout.right);
  });

  it("把视图放到本侧已经占着的视图上 → 不变", () => {
    const layout = assignPanelView(
      { left: "explorer", right: "changes" },
      "left",
      "explorer",
    );
    expect(layout).toEqual({ left: "explorer", right: "changes" });
  });

  it("无论怎么分配,左右始终是两个不同的视图", () => {
    let layout: PanelLayoutPref = { left: "explorer", right: "changes" };
    layout = assignPanelView(layout, "right", "explorer");
    expect(layout).toEqual({ left: "changes", right: "explorer" });
    layout = assignPanelView(layout, "right", "changes");
    expect(layout).toEqual({ left: "explorer", right: "changes" });
    expect(layout.left).not.toBe(layout.right);
  });
});

describe("resolvePanelViewToggle", () => {
  it("视图在哪一侧就切换那一侧的显隐", () => {
    const toggled = resolvePanelViewToggle(
      { left: "explorer", right: "changes" },
      { left: true, right: true },
      "explorer",
    );
    expect(toggled).toEqual({ side: "left", open: false });

    const reopened = resolvePanelViewToggle(
      { left: "explorer", right: "changes" },
      { left: false, right: true },
      "changes",
    );
    expect(reopened).toEqual({ side: "right", open: false });
  });
});
