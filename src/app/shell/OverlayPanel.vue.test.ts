// @vitest-environment jsdom
import { mount } from "@vue/test-utils";
import { describe, expect, it } from "vitest";

import OverlayPanel from "./OverlayPanel.vue";

describe("OverlayPanel.vue", () => {
  it("左列浮层:标题、玻璃容器与右缘调宽手柄,关闭按钮发出 close", async () => {
    const wrapper = mount(OverlayPanel, {
      props: { title: "文件树", placement: "left", width: 340 },
    });

    const panel = wrapper.find("[data-overlay-placement='left']");
    expect(panel.exists()).toBe(true);
    expect(panel.classes()).toContain("v2-glass");
    expect(wrapper.find("[data-overlay-resizer]").exists()).toBe(true);

    await wrapper.find("[data-overlay-close]").trigger("click");
    expect(wrapper.emitted("close")).toHaveLength(1);
  });

  it("底部浮层可隐藏头部(任务控制台自带工具栏)", () => {
    const wrapper = mount(OverlayPanel, {
      props: { title: "任务", placement: "bottom", showHeader: false },
    });

    expect(wrapper.find("[data-overlay-placement='bottom']").exists()).toBe(true);
    expect(wrapper.find("[data-overlay-close]").exists()).toBe(false);
    expect(wrapper.find("[data-overlay-resizer]").exists()).toBe(false);
  });

  it("拖拽右缘手柄调宽:向左拖加宽并发出 resize-width", async () => {
    const wrapper = mount(OverlayPanel, {
      props: { title: "文件树", placement: "left", width: 340 },
      attachTo: document.body,
    });

    const resizer = wrapper.find("[data-overlay-resizer]");
    // jsdom 的 MouseEvent 属性只读,trigger 不能带 clientX;改用构造器注入。
    resizer.element.dispatchEvent(
      new MouseEvent("pointerdown", { clientX: 500, button: 0, bubbles: true }),
    );
    window.dispatchEvent(
      new MouseEvent("pointermove", { clientX: 460, bubbles: true }),
    );
    window.dispatchEvent(
      new MouseEvent("pointerup", { clientX: 460, bubbles: true }),
    );

    expect(wrapper.emitted("resize-width")).toEqual([[380]]);
    wrapper.unmount();
  });
});
