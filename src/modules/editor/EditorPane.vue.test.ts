// @vitest-environment jsdom
import { readFileSync } from "node:fs";
import { join } from "node:path";
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
    expect(wrapper.find("[data-editor-mode-source]").exists()).toBe(false);
  });

  it("configures CodeMirror for horizontal scrolling on long lines", async () => {
    vi.mocked(readEditorDocument).mockResolvedValueOnce({
      status: "ready",
      content: `const value = "${"x".repeat(240)}";`,
      size: 257,
    });

    const wrapper = mount(EditorPane, {
      global: { plugins: [createPinia()] },
      props: { path: "/repo/src/main.ts" },
    });
    await flush();

    expect(wrapper.find("[data-editor-host]").classes()).toContain(
      "nexterm-editor-scrollbar",
    );
    expect(wrapper.find(".cm-scroller").exists()).toBe(true);
    expect(wrapper.find(".cm-content").exists()).toBe(true);
    expect(wrapper.find(".cm-line").exists()).toBe(true);
  });

  it("declares the CodeMirror theme needed for horizontal scrolling", () => {
    const source = readFileSync(
      join(process.cwd(), "src/modules/editor/EditorPane.vue"),
      "utf8",
    );

    expect(source).toContain('overflow: "auto"');
    expect(source).toContain('minWidth: "max-content"');
    expect(source).toContain('whiteSpace: "pre"');
  });

  it("offers source, split, and preview modes for markdown files", async () => {
    vi.mocked(readEditorDocument).mockResolvedValueOnce({
      status: "ready",
      content: "# Draft\n\nUse `pnpm test`.",
      size: 26,
    });

    const wrapper = mount(EditorPane, {
      global: { plugins: [createPinia()] },
      props: { path: "/repo/README.md" },
    });
    await flush();

    expect(wrapper.find("[data-editor-mode-root]").attributes("data-mode")).toBe(
      "split",
    );
    expect(wrapper.find("[data-editor-mode-source]").exists()).toBe(true);
    expect(wrapper.find("[data-editor-mode-split]").exists()).toBe(true);
    expect(wrapper.find("[data-editor-mode-preview]").exists()).toBe(true);
    expect(wrapper.find("[data-editor-markdown-preview]").text()).toContain(
      "Draft",
    );

    wrapper.vm.setContentForTest("# Updated\n\nLive preview");
    await nextTick();

    expect(wrapper.find("[data-editor-markdown-preview]").text()).toContain(
      "Updated",
    );

    await wrapper.find("[data-editor-mode-preview]").trigger("click");
    await nextTick();

    expect(wrapper.find("[data-editor-mode-root]").attributes("data-mode")).toBe(
      "preview",
    );
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

  it("reloads external file changes when the editor is clean", async () => {
    vi.mocked(readEditorDocument)
      .mockResolvedValueOnce({
        status: "ready",
        content: "const value = 1;",
        size: 16,
      })
      .mockResolvedValueOnce({
        status: "ready",
        content: "const value = 2;",
        size: 16,
      });

    const wrapper = mount(EditorPane, {
      global: { plugins: [createPinia()] },
      props: {
        path: "/repo/src/main.ts",
        fsEvent: null,
      },
    });
    await flush();

    await wrapper.setProps({
      fsEvent: {
        rootPath: "/repo",
        paths: ["/repo/src/main.ts"],
        gitRelated: false,
      },
    });
    await flush();

    expect(readEditorDocument).toHaveBeenCalledTimes(2);
    expect(wrapper.find(".cm-content").text()).toContain("const value = 2;");
  });

  it("does not overwrite dirty editor content on external changes", async () => {
    vi.mocked(readEditorDocument).mockResolvedValueOnce({
      status: "ready",
      content: "const value = 1;",
      size: 16,
    });

    const wrapper = mount(EditorPane, {
      global: { plugins: [createPinia()] },
      props: {
        path: "/repo/src/main.ts",
        fsEvent: null,
      },
    });
    await flush();

    wrapper.vm.setContentForTest("const local = true;");
    await nextTick();
    await wrapper.setProps({
      fsEvent: {
        rootPath: "/repo",
        paths: ["/repo/src/main.ts"],
        gitRelated: false,
      },
    });
    await flush();

    expect(readEditorDocument).toHaveBeenCalledTimes(1);
    expect(wrapper.find(".cm-content").text()).toContain("const local = true;");
  });
});
