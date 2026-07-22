import { ref } from "vue";
import { describe, expect, it, vi } from "vitest";
import { useLeftSidebar } from "./useLeftSidebar";

describe("useLeftSidebar", () => {
  it("反映 state ref 的派生值", () => {
    const state = ref({
      activity: "sourceControl" as const,
      open: true,
      width: 280,
    });
    const api = useLeftSidebar(state, vi.fn(), vi.fn(), vi.fn());

    expect(api.activity.value).toBe("sourceControl");
    expect(api.isOpen.value).toBe(true);
    expect(api.width.value).toBe(280);
  });

  it("setActivity 转发到回调", () => {
    const state = ref({
      activity: "sourceControl" as const,
      open: true,
      width: 280,
    });
    const setActivity = vi.fn();
    const api = useLeftSidebar(state, setActivity, vi.fn(), vi.fn());
    api.setActivity("workspace");
    expect(setActivity).toHaveBeenCalledWith("workspace");
  });

  it("toggleOpen 转发到回调", () => {
    const state = ref({
      activity: "sourceControl" as const,
      open: true,
      width: 280,
    });
    const toggleOpen = vi.fn();
    const api = useLeftSidebar(state, vi.fn(), toggleOpen, vi.fn());
    api.toggleOpen();
    expect(toggleOpen).toHaveBeenCalled();
  });

  it("setWidth 转发到回调", () => {
    const state = ref({
      activity: "sourceControl" as const,
      open: true,
      width: 280,
    });
    const setWidth = vi.fn();
    const api = useLeftSidebar(state, vi.fn(), vi.fn(), setWidth);
    api.setWidth(360);
    expect(setWidth).toHaveBeenCalledWith(360);
  });
});