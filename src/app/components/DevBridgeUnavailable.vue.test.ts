// @vitest-environment jsdom
import { mount } from "@vue/test-utils";
import { beforeEach, describe, expect, it, vi } from "vitest";

const probeMock = vi.hoisted(() => vi.fn(async () => false));
vi.mock("@/lib/devBridge", () => ({ probeDevBridge: probeMock }));

import DevBridgeUnavailable from "./DevBridgeUnavailable.vue";

describe("DevBridgeUnavailable", () => {
  beforeEach(() => {
    probeMock.mockReset();
    probeMock.mockResolvedValue(false);
  });

  it("展示调试桥未就绪的说明与启动命令", () => {
    const wrapper = mount(DevBridgeUnavailable);

    expect(wrapper.text()).toContain("调试桥未就绪");
    expect(wrapper.text()).toContain("pnpm tauri dev -- --features web-dev-bridge");
  });

  it("提示必须用 localhost 打开页面（CORS 白名单只认它）", () => {
    const wrapper = mount(DevBridgeUnavailable);

    expect(wrapper.text()).toContain("http://localhost:3180");
    expect(wrapper.text()).toContain("http://127.0.0.1:3180");
  });

  it("点击重新检测：桥仍未就绪时保持提示状态且不刷新", async () => {
    const reload = vi.fn();
    const wrapper = mount(DevBridgeUnavailable, { props: { reload } });

    await wrapper.get("button").trigger("click");

    expect(probeMock).toHaveBeenCalledTimes(1);
    expect(reload).not.toHaveBeenCalled();
    expect(wrapper.text()).toContain("调试桥未就绪");
  });

  it("点击重新检测：桥就绪时刷新页面", async () => {
    probeMock.mockResolvedValue(true);
    const reload = vi.fn();
    const wrapper = mount(DevBridgeUnavailable, { props: { reload } });

    await wrapper.get("button").trigger("click");

    expect(probeMock).toHaveBeenCalledTimes(1);
    expect(reload).toHaveBeenCalledTimes(1);
  });
});
