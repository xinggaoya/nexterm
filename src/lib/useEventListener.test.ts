// @vitest-environment jsdom
import { describe, expect, it, vi } from "vitest";
import { defineComponent, h, nextTick } from "vue";
import { mount } from "@vue/test-utils";
import { useEventListener } from "./useEventListener";

describe("useEventListener", () => {
  it("subscribes to window events and removes the listener on unmount", async () => {
    const handler = vi.fn();
    const spy = vi.spyOn(window, "addEventListener");
    const removeSpy = vi.spyOn(window, "removeEventListener");

    const Probe = defineComponent({
      setup() {
        useEventListener(window, "resize", handler);
        return () => h("div");
      },
    });

    const wrapper = mount(Probe);
    await nextTick();

    expect(spy).toHaveBeenCalledWith("resize", handler, undefined);
    window.dispatchEvent(new Event("resize"));
    expect(handler).toHaveBeenCalledTimes(1);

    wrapper.unmount();
    expect(removeSpy).toHaveBeenCalledWith("resize", handler, undefined);
  });
});
