// @vitest-environment jsdom
import { mount } from "@vue/test-utils";
import { describe, expect, it } from "vitest";
import PanelControlCluster from "./PanelControlCluster.vue";

function mountCluster(
  props: Partial<InstanceType<typeof PanelControlCluster>["$props"]> = {},
) {
  return mount(PanelControlCluster, {
    props: {
      side: "right",
      view: "explorer",
      open: true,
      ...props,
    },
  });
}

describe("PanelControlCluster.vue", () => {
  it("分段控件按当前视图高亮", () => {
    const wrapper = mountCluster({ view: "changes" });

    expect(wrapper.find("[data-panel-tab='changes']").attributes("aria-pressed")).toBe(
      "true",
    );
    expect(wrapper.find("[data-panel-tab='explorer']").attributes("aria-pressed")).toBe(
      "false",
    );
  });

  it("选视图即展开面板", async () => {
    const wrapper = mountCluster({ view: "explorer", open: false });

    await wrapper.find("[data-panel-tab='changes']").trigger("click");

    expect(wrapper.emitted("update:slot")).toEqual([[{ view: "changes", open: true }]]);
  });

  it("折叠按钮切换显隐并保留视图选择", async () => {
    const wrapper = mountCluster({ view: "changes", open: true });

    await wrapper.find("[data-toggle-panel]").trigger("click");

    expect(wrapper.emitted("update:slot")).toEqual([
      [{ view: "changes", open: false }],
    ]);
  });

  it("收起时分段控件仍高亮着当前视图", () => {
    const wrapper = mountCluster({ view: "explorer", open: false });

    expect(wrapper.find("[data-panel-tab='explorer']").attributes("aria-pressed")).toBe(
      "true",
    );
    expect(wrapper.find("[data-toggle-panel]").attributes("aria-pressed")).toBe(
      "false",
    );
  });

  it("折叠箭头朝向随停靠侧镜像", () => {
    const icon = (side: "left" | "right", open: boolean) =>
      mountCluster({ side, open }).find("[data-toggle-panel] svg").html();

    const rightOpen = icon("right", true);
    const rightClosed = icon("right", false);
    const leftOpen = icon("left", true);
    const leftClosed = icon("left", false);

    // 两侧展开时箭头方向相反；同一侧开合时方向也相反。
    expect(rightOpen).not.toBe(leftOpen);
    expect(rightOpen).not.toBe(rightClosed);
    expect(leftOpen).not.toBe(leftClosed);
    // 镜像关系：右侧展开 == 左侧收起。
    expect(rightOpen).toBe(leftClosed);
    expect(rightClosed).toBe(leftOpen);
  });
});
