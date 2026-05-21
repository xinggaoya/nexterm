// @vitest-environment jsdom
import { mount } from "@vue/test-utils";
import { createPinia } from "pinia";
import { nextTick } from "vue";
import { beforeEach, describe, expect, it, vi } from "vitest";
import EditorPane from "./EditorPane.vue";
import { readEditorDocument, writeEditorDocument } from "./lib/documentService";

vi.mock("./lib/documentService", () => ({
  readEditorDocument: vi.fn(),
  writeEditorDocument: vi.fn(),
}));

async function flush() {
  await Promise.resolve();
  await nextTick();
}

describe("EditorPane.vue", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    vi.mocked(readEditorDocument).mockResolvedValue({
      status: "ready",
      content: "const value = 1;",
      size: 16,
    });
  });

  it("loads text documents into a CodeMirror host", async () => {
    const wrapper = mount(EditorPane, {
      global: { plugins: [createPinia()] },
      props: { path: "/repo/src/main.ts" },
    });
    await flush();

    expect(readEditorDocument).toHaveBeenCalledWith("/repo/src/main.ts");
    expect(wrapper.find("[data-editor-host]").exists()).toBe(true);
    expect(wrapper.text()).toContain("main.ts");
  });

  it("renders non-text states without mounting an editor", async () => {
    vi.mocked(readEditorDocument).mockResolvedValueOnce({
      status: "binary",
      size: 2048,
    });

    const wrapper = mount(EditorPane, {
      global: { plugins: [createPinia()] },
      props: { path: "/repo/image.png" },
    });
    await flush();

    expect(wrapper.text()).toContain("Binary file");
    expect(wrapper.text()).toContain("2.0 KB");
    expect(wrapper.find("[data-editor-host]").exists()).toBe(false);
  });

  it("exposes save and dirty state transitions", async () => {
    const wrapper = mount(EditorPane, {
      global: { plugins: [createPinia()] },
      props: { path: "/repo/src/main.ts" },
    });
    await flush();

    wrapper.vm.setContentForTest("const value = 2;");
    await nextTick();
    await wrapper.vm.save();

    expect(wrapper.emitted("dirtyChange")).toEqual([[false], [true], [false]]);
    expect(writeEditorDocument).toHaveBeenCalledWith(
      "/repo/src/main.ts",
      "const value = 2;",
    );
  });
});
