// @vitest-environment jsdom
import { mount } from "@vue/test-utils";
import { createPinia } from "pinia";
import { nextTick } from "vue";
import { beforeEach, describe, expect, it, vi } from "vitest";
import EditorPane from "./EditorPane.vue";
import { readEditorDocument, writeEditorDocument } from "./lib/documentService";

const dialogWarningMock = vi.hoisted(() => vi.fn());

vi.mock("naive-ui", async () => {
  const actual = await vi.importActual<typeof import("naive-ui")>("naive-ui");
  return {
    ...actual,
    useDialog: () => ({ warning: dialogWarningMock }),
  };
});

vi.mock("./lib/documentService", () => ({
  readEditorDocument: vi.fn(),
  writeEditorDocument: vi.fn(),
}));

vi.mock("monaco-editor", () => {
  const noopDisposable = { dispose: () => undefined };
  const fakeEditor: any = {
    _value: "const value = 1;",
    _onDidChangeContent: null as null | (() => void),
    getValue() {
      return this._value;
    },
    setValue(v: string) {
      this._value = v;
      this._onDidChangeContent?.();
    },
    getModel() {
      return {
        getValue: () => this._value,
        getValueLengthInRange: () => 0,
        getLineCount: () => 1,
        getFullModelRange: () => ({
          startLineNumber: 1,
          endLineNumber: 1,
          startColumn: 1,
          endColumn: 1,
        }),
        dispose: () => undefined,
      };
    },
    getSelection: () => ({ isEmpty: () => true }),
    onDidChangeModelContent(cb: () => void) {
      this._onDidChangeContent = cb;
      return noopDisposable;
    },
    onDidChangeCursorPosition: () => noopDisposable,
    trigger: () => undefined,
    focus: () => undefined,
    layout: () => undefined,
    setPosition: () => undefined,
    revealLine: () => undefined,
    executeEdits(_source: string, edits: Array<{ text: string }>) {
      const next = edits.map((e) => e.text).join("");
      this._value = next;
      this._onDidChangeContent?.();
    },
  };
  return {
    editor: {
      create: () => fakeEditor,
      createDiffEditor: () => ({}),
      createModel: () => ({}),
      setTheme: () => undefined,
      defineTheme: () => undefined,
    },
    languages: {
      register: () => undefined,
    },
  };
});

async function flush() {
  await Promise.resolve();
  await nextTick();
}

describe("EditorPane.vue", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    dialogWarningMock.mockReset();
    vi.mocked(readEditorDocument).mockResolvedValue({
      status: "ready",
      content: "const value = 1;",
      size: 16,
    });
  });

  it("loads text documents into a Monaco host", async () => {
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

  it("offers source, split and preview modes for markdown files", async () => {
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

  it("confirms before saving over an external disk change", async () => {
    vi.mocked(readEditorDocument).mockResolvedValueOnce({
      status: "ready",
      content: "const value = 1;",
      size: 16,
    });
    dialogWarningMock.mockImplementation((options) => {
      void options.onPositiveClick();
    });
    const wrapper = mount(EditorPane, {
      global: { plugins: [createPinia()] },
      props: { path: "/repo/src/main.ts", fsEvent: null },
    });
    await flush();
    wrapper.vm.setContentForTest("const local = true;");
    await nextTick();
    await wrapper.setProps({
      fsEvent: { rootPath: "/repo", paths: ["/repo/src/main.ts"], gitRelated: false },
    });
    await flush();
    await wrapper.vm.save();
    await flush();
    expect(dialogWarningMock).toHaveBeenCalledWith(
      expect.objectContaining({
        title: "Overwrite disk changes?",
        positiveText: "Save",
      }),
    );
    expect(writeEditorDocument).toHaveBeenCalledWith(
      "/repo/src/main.ts",
      "const local = true;",
    );
  });
});
