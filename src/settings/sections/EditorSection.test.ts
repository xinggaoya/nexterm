// @vitest-environment jsdom
import { mount } from "@vue/test-utils";
import { NSelect, NSwitch } from "naive-ui";
import { createPinia, type Pinia } from "pinia";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { i18n, setI18nLanguage } from "@/modules/i18n";
import { usePreferencesPiniaStore } from "@/modules/settings/preferencesPinia";
import EditorSection from "./EditorSection.vue";

vi.mock("@/modules/settings/store", async (importOriginal) => {
  const mod = await importOriginal<typeof import("@/modules/settings/store")>();
  return {
    ...mod,
    setPreference: vi.fn().mockResolvedValue(undefined),
  };
});

describe("EditorSection.vue", () => {
  let pinia: Pinia;
  beforeEach(() => {
    setI18nLanguage("en-US");
    pinia = createPinia();
  });

  it("文件打开行为默认 preview，选项含 preview 与 pinned", () => {
    const wrapper = mount(EditorSection, {
      global: { plugins: [pinia, i18n] },
    });
    const select = wrapper.findComponent(NSelect);
    expect(select.exists()).toBe(true);
    expect(select.props("value")).toBe("preview");
    const options = select.props("options") as Array<{ value: string }>;
    expect(options.map((o) => o.value)).toEqual(["preview", "pinned"]);
  });

  it("Vim 模式默认关闭，切换后乐观更新 store", async () => {
    const wrapper = mount(EditorSection, {
      global: { plugins: [pinia, i18n] },
    });
    const prefs = usePreferencesPiniaStore(pinia);
    expect(prefs.vimMode).toBe(false);
    const vimSwitch = wrapper.findComponent(NSwitch);
    await vimSwitch.vm.$emit("update:value", true);
    expect(prefs.vimMode).toBe(true);
  });

  it("语言服务器诊断开关映射 builtin/lsp 偏好", async () => {
    const wrapper = mount(EditorSection, {
      global: { plugins: [pinia, i18n] },
    });
    const prefs = usePreferencesPiniaStore(pinia);
    expect(prefs.editorLspTypescriptMode).toBe("builtin");
    // 模板次序：switch[0]=Vim，switch[1]=LSP 诊断。
    const switches = wrapper.findAllComponents(NSwitch);
    expect(switches.length).toBe(2);
    await switches[1].vm.$emit("update:value", true);
    expect(prefs.editorLspTypescriptMode).toBe("lsp");
  });
});
