// @vitest-environment jsdom
import { mount } from "@vue/test-utils";
import { createPinia } from "pinia";
import { nextTick } from "vue";
import { beforeEach, describe, expect, it, vi } from "vitest";
import EditorPane from "./EditorPane.vue";
import { readEditorDocument, writeEditorDocument } from "./lib/documentService";

const dialogWarningMock = vi.hoisted(() => vi.fn());

// 多工作区重构后，EditorPane 通过 useWorkspaceContext() 获取 wsNative。
// 测试不挂载 WorkspaceHost，因此直接 mock 该 composable 返回固定值。
// documentService 函数本身已被单独 mock，不会真正调用 wsNative 的方法。
const mockWsNative = {};
vi.mock("@/app/workspaceContext", () => ({
  useWorkspaceContext: () => ({
    workspace: {
      id: "local:/repo",
      rootPath: "/repo",
      env: { kind: "local" },
      name: "repo",
      openedAt: 0,
    },
    wsNative: mockWsNative,
  }),
}));

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

// documentService 函数现在以 wsNative 为首参；断言时忽略该参数。
const WS_NATIVE_MATCHER = expect.anything();

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

const fakeModel: any = { dispose: () => undefined };

const fakeDiffEditor: any = {
  setModel: () => undefined,
  dispose: () => undefined,
  onDidUpdateDiff: () => noopDisposable,
  getLineChanges: () => null,
  getModel: () => ({ original: fakeModel, modified: fakeModel }),
};

vi.mock("monaco-editor", () => ({
  editor: {
    create: () => fakeEditor,
    createDiffEditor: () => fakeDiffEditor,
    createModel: () => fakeModel,
    setTheme: () => undefined,
    defineTheme: () => undefined,
  },
  languages: {
    register: () => undefined,
  },
}));

async function flush() {
  await Promise.resolve();
  await nextTick();
}

describe("EditorPane.vue", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    dialogWarningMock.mockReset();
    fakeEditor._value = "const value = 1;";
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
    expect(readEditorDocument).toHaveBeenCalledWith(
      WS_NATIVE_MATCHER,
      "/repo/src/main.ts",
    );
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
      WS_NATIVE_MATCHER,
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
      WS_NATIVE_MATCHER,
      "/repo/src/main.ts",
      "const local = true;",
    );
  });
});
