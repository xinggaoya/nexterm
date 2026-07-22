// @vitest-environment jsdom
import { mount } from "@vue/test-utils";
import { describe, expect, it } from "vitest";
import ActivityIcons from "./ActivityIcons.vue";

describe("ActivityIcons", () => {
  it("renders add and new-window buttons", () => {
    const wrapper = mount(ActivityIcons, {
      props: { activity: "sourceControl" },
    });
    expect(wrapper.find("[data-add-workspace]").exists()).toBe(true);
    expect(wrapper.find("[data-open-in-new-window]").exists()).toBe(true);
  });

  it("emits add-workspace on + click", async () => {
    const wrapper = mount(ActivityIcons, {
      props: { activity: "sourceControl" },
    });
    await wrapper.find("[data-add-workspace]").trigger("click");
    expect(wrapper.emitted("add-workspace")).toBeTruthy();
  });

  it("emits open-in-new-window on ↗ click", async () => {
    const wrapper = mount(ActivityIcons, {
      props: { activity: "sourceControl" },
    });
    await wrapper.find("[data-open-in-new-window]").trigger("click");
    expect(wrapper.emitted("open-in-new-window")).toBeTruthy();
  });

  it("emits select-activity on activity click", async () => {
    const wrapper = mount(ActivityIcons, {
      props: { activity: "sourceControl" },
    });
    await wrapper.find('[data-activity="workspace"]').trigger("click");
    expect(wrapper.emitted("select-activity")?.[0]).toEqual(["workspace"]);
  });

  it("highlights current activity", () => {
    const wrapper = mount(ActivityIcons, {
      props: { activity: "workspace" },
    });
    const btn = wrapper.find('[data-activity="workspace"]');
    expect(btn.attributes("aria-pressed")).toBe("true");
  });
});