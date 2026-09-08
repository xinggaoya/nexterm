// @vitest-environment jsdom
import { flushPromises, mount } from "@vue/test-utils";
import { NSelect, NSwitch } from "naive-ui";
import { createPinia, type Pinia } from "pinia";
import { beforeEach, describe, expect, it, vi } from "vitest";
import type { ShellProfileInfo } from "@/lib/native";
import { i18n, setI18nLanguage } from "@/modules/i18n";
import { setPreference } from "@/modules/settings/store";
import { usePreferencesPiniaStore } from "@/modules/settings/preferencesPinia";
import TerminalBehaviorSection from "./TerminalBehaviorSection.vue";

vi.mock("@/modules/settings/store", async (importOriginal) => {
  const mod = await importOriginal<typeof import("@/modules/settings/store")>();
  return {
    ...mod,
    setPreference: vi.fn().mockResolvedValue(undefined),
  };
});

// 默认 Shell 下拉仅在 Windows + Tauri 环境渲染；测试里同时打开两个
// 开关，让探测调用走 mock 的 shellListProfiles。默认解析为空列表，
// 避免早于具体用例的 onMounted 拿到 undefined。
const shellListProfilesMock = vi.hoisted(() =>
  vi.fn(async (): Promise<ShellProfileInfo[]> => []),
);
vi.mock("@/lib/platform", async (importOriginal) => {
  const mod = await importOriginal<typeof import("@/lib/platform")>();
  return { ...mod, IS_WINDOWS: true };
});
vi.mock("@/lib/tauriRuntime", async (importOriginal) => {
  const mod = await importOriginal<typeof import("@/lib/tauriRuntime")>();
  return { ...mod, hasTauriInternals: () => true };
});
vi.mock("@/lib/native", async (importOriginal) => {
  const mod = await importOriginal<typeof import("@/lib/native")>();
  return {
    ...mod,
    native: { ...mod.native, shellListProfiles: shellListProfilesMock },
  };
});

describe("TerminalBehaviorSection.vue", () => {
  let pinia: Pinia;
  beforeEach(() => {
    setI18nLanguage("en-US");
    pinia = createPinia();
  });

  it("回滚行数选择器默认 2000 且包含预设档位", () => {
    const wrapper = mount(TerminalBehaviorSection, {
      global: { plugins: [pinia, i18n] },
    });
    const scrollback = wrapper
      .findAllComponents(NSelect)
      .find((s) => s.props("value") === 2000);
    expect(scrollback).toBeTruthy();
    const options = scrollback!.props("options") as Array<{ value: number }>;
    expect(options.map((o) => o.value)).toContain(5000);
    expect(options.map((o) => o.value)).toContain(25_000);
  });

  it("切换回滚档位会乐观更新 store（含 clamp 路径）", async () => {
    const wrapper = mount(TerminalBehaviorSection, {
      global: { plugins: [pinia, i18n] },
    });
    const prefs = usePreferencesPiniaStore(pinia);
    const scrollback = wrapper
      .findAllComponents(NSelect)
      .find((s) => s.props("value") === 2000);
    await scrollback!.vm.$emit("update:value", "10000");
    expect(prefs.terminalScrollback).toBe(10_000);
  });

  it("滚动加速修饰键默认 alt", () => {
    const wrapper = mount(TerminalBehaviorSection, {
      global: { plugins: [pinia, i18n] },
    });
    const modifier = wrapper
      .findAllComponents(NSelect)
      .find((s) => s.props("value") === "alt");
    expect(modifier).toBeTruthy();
  });

  it("终端通知开关默认开启，关闭后走 updateTerminalNotificationEnabled", async () => {
    const wrapper = mount(TerminalBehaviorSection, {
      global: { plugins: [pinia, i18n] },
    });
    const prefs = usePreferencesPiniaStore(pinia);
    expect(prefs.terminalNotificationEnabled).toBe(true);

    // 按表单项标签文本定位（同名值开关太多，不能按 value 查找）。
    const item = wrapper
      .findAll(".n-form-item")
      .find((el) => el.text().includes("Terminal notifications"));
    expect(item).toBeTruthy();
    const notification = item!.findComponent(NSwitch);
    expect(notification).toBeTruthy();
    await notification.vm.$emit("update:value", false);
    expect(prefs.terminalNotificationEnabled).toBe(false);
    // 持久化路径以新 key + 关闭值触达 store 插件。
    expect(vi.mocked(setPreference)).toHaveBeenCalledWith(
      "terminalNotificationEnabled",
      false,
    );
  });

  it("Windows 下默认 Shell 下拉展示探测结果且可切换", async () => {
    shellListProfilesMock.mockResolvedValue([
      {
        id: "pwsh",
        name: "PowerShell 7",
        program: "C:/PF/PowerShell/7/pwsh.exe",
        args: [],
        kind: "powershell",
      },
      {
        id: "git-bash",
        name: "Git Bash",
        program: "C:/PF/Git/bin/bash.exe",
        args: [],
        kind: "bash",
      },
    ]);
    const wrapper = mount(TerminalBehaviorSection, {
      global: { plugins: [pinia, i18n] },
    });
    await flushPromises();
    expect(shellListProfilesMock).toHaveBeenCalled();

    const shellSelect = wrapper
      .findAllComponents(NSelect)
      .find((s) => s.props("value") === "auto");
    expect(shellSelect).toBeTruthy();
    const options = shellSelect!.props("options") as Array<{
      value: string;
    }>;
    expect(options.map((o) => o.value)).toEqual(["auto", "pwsh", "git-bash"]);

    await shellSelect!.vm.$emit("update:value", "git-bash");
    const prefs = usePreferencesPiniaStore(pinia);
    expect(prefs.terminalShellId).toBe("git-bash");
    expect(vi.mocked(setPreference)).toHaveBeenCalledWith(
      "terminalShellId",
      "git-bash",
    );
    // 选中 profile 后提示行展示其真实路径。
    expect(wrapper.text()).toContain("C:/PF/Git/bin/bash.exe");
  });
});
