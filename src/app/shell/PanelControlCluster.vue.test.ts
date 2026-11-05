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
      view: "changes",
      open: true,
      ...props,
    },
  });
}

describe("PanelControlCluster.vue", () => {
  // 视图切换只在设置页做 —— 顶栏两侧的控制簇只负责展开/收起。
  it("只有折叠按钮，没有视图切换按钮", () => {
    const wrapper = mountCluster();

    expect(wrapper.findAll("button")).toHaveLength(1);
    expect(wrapper.find("[data-toggle-panel]").exists()).toBe(true);
    expect(wrapper.find("[data-panel-tab='explorer']").exists()).toBe(false);
    expect(wrapper.find("[data-panel-tab='changes']").exists()).toBe(false);
  });

  it("视图图标只是只读指示:不可点、不发出任何事件", async () => {
    const wrapper = mountCluster({ view: "explorer" });

    const indicator = wrapper.find("[data-panel-view-indicator]");
    expect(indicator.exists()).toBe(true);
    expect(indicator.attributes("data-panel-view")).toBe("explorer");
    expect(indicator.attributes("aria-label")).toBeTruthy();
    expect(indicator.attributes("aria-hidden")).toBeUndefined();
    // 刻意不是按钮。
    expect(indicator.element.tagName).not.toBe("BUTTON");

    await indicator.trigger("click");
    // 点它什么也不会发生：既不折叠也不换视图。
    expect(wrapper.emitted("toggle")).toBeUndefined();
    expect(wrapper.emitted("update:layout")).toBeUndefined();
  });

  it("折叠按钮发出 toggle", async () => {
    const wrapper = mountCluster({ open: true });

    await wrapper.find("[data-toggle-panel]").trigger("click");

    expect(wrapper.emitted("toggle")).toHaveLength(1);
    expect(wrapper.emitted("update:layout")).toBeUndefined();
  });

  it("折叠按钮的 aria-pressed 反映可见性", () => {
    const wrapper = mountCluster({ open: false });
    expect(wrapper.find("[data-toggle-panel]").attributes("aria-pressed")).toBe(
      "false",
    );
  });

  // 两个折叠按钮的可访问名如果都叫「隐藏侧面板」，屏幕阅读器用户
  // 分不清按的是哪一侧 —— 必须带上侧别。
  it("折叠按钮的可访问名能分辨左右", () => {
    const left = mountCluster({ side: "left" });
    const right = mountCluster({ side: "right" });

    const leftName = left.find("[data-toggle-panel]").attributes("aria-label");
    const rightName = right.find("[data-toggle-panel]").attributes("aria-label");
    expect(leftName).toBeTruthy();
    expect(rightName).toBeTruthy();
    expect(leftName).not.toBe(rightName);
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
