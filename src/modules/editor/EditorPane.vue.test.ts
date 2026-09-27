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

// 观察推给 LSP server 的通知：didChange（编辑，防抖）/ didSave（保存）。
// 用 partial mock 透传其余导出：editorPaneLsp 依赖 manager 里的
// attach/detach，只留两个通知函数会让那些调用变成 undefined。
const lspSync = vi.hoisted(() => ({
  changed: [] as string[],
  saved: [] as string[],
}));
vi.mock("@/modules/lsp/manager", async () => {
  const actual =
    await vi.importActual<typeof import("@/modules/lsp/manager")>(
      "@/modules/lsp/manager",
    );
  return {
    ...actual,
    notifyLspDocumentChanged: (_view: unknown, text: string) => {
      lspSync.changed.push(text);
    },
    notifyLspDocumentSaved: (_view: unknown, text: string) => {
      lspSync.saved.push(text);
    },
  };
});

// 语言解析走独立测试，这里 mock 成空扩展以隔离真实语言包的加载。
vi.mock("./lib/languageResolver", () => ({
  isMarkdownPath: (path: string) => /\.(md|markdown|mdx)$/i.test(path),
  languageLabelForPath: () => "TypeScript",
  resolveLanguage: async () => null,
  resolveLanguageSync: () => null,
}));

// CodeMirror 6 在 jsdom 中不做真实实例化，统一替换为 tests/ 下的桩模块。
vi.mock("@codemirror/view", async () => await import("../../../tests/codemirror-stubs"));
vi.mock("@codemirror/state", async () => await import("../../../tests/codemirror-stubs"));
vi.mock("@codemirror/commands", async () => await import("../../../tests/codemirror-noop-stubs"));
vi.mock("@codemirror/autocomplete", async () => await import("../../../tests/codemirror-noop-stubs"));
vi.mock("@codemirror/language", async () => await import("../../../tests/codemirror-noop-stubs"));
vi.mock("@codemirror/search", async () => await import("../../../tests/codemirror-noop-stubs"));
vi.mock("@codemirror/lint", async () => await import("../../../tests/codemirror-noop-stubs"));
vi.mock("@replit/codemirror-vim", async () => await import("../../../tests/codemirror-noop-stubs"));
vi.mock("@lezer/highlight", () => ({
  tags: new Proxy({}, { get: () => Symbol("tag") }),
}));

// documentService 函数现在以 wsNative 为首参；断言时忽略该参数。
const WS_NATIVE_MATCHER = expect.anything();

async function flush() {
  await Promise.resolve();
  await nextTick();
}

describe("EditorPane.vue", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    dialogWarningMock.mockReset();
    lspSync.changed.length = 0;
    lspSync.saved.length = 0;
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
    // 拆分预览正文要可选中复制(应用根节点是 select-none,需显式恢复)。
    expect(wrapper.find("[data-editor-markdown-preview-scroll]").classes()).toContain(
      "select-text",
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
  // ── LSP 同步：server 必须看到未保存的内容 ──────────────────────────
  // 回归：此前 didChange 只在保存时发，server 手里的文档停留在上次保存的
  // 文本 —— 补全/悬浮全在旧内容上算，新建未保存文件时 server 更是什么都
  // 不知道。逐击键全量推送又会拖慢分析，所以防抖到停手。

  it("编辑后把新内容防抖推给 LSP（不必等保存）", async () => {
    vi.useFakeTimers();
    const wrapper = mount(EditorPane, {
      global: { plugins: [createPinia()] },
      props: { path: "/repo/src/main.ts" },
    });
    await flush();
    // 首帧未编辑 → 不该有任何推送
    expect(lspSync.changed).toEqual([]);

    wrapper.vm.setContentForTest("const value = 2;");
    await nextTick();
    // 仍在防抖窗口内
    expect(lspSync.changed).toEqual([]);

    vi.advanceTimersByTime(300);
    expect(lspSync.changed).toEqual(["const value = 2;"]);
    vi.useRealTimers();
    wrapper.unmount();
  });

  it("连续编辑合并成最后一次推送", async () => {
    vi.useFakeTimers();
    const wrapper = mount(EditorPane, {
      global: { plugins: [createPinia()] },
      props: { path: "/repo/src/main.ts" },
    });
    await flush();

    wrapper.vm.setContentForTest("a");
    await nextTick();
    vi.advanceTimersByTime(100);
    wrapper.vm.setContentForTest("ab");
    await nextTick();
    vi.advanceTimersByTime(100);
    wrapper.vm.setContentForTest("abc");
    await nextTick();
    vi.advanceTimersByTime(300);

    expect(lspSync.changed).toEqual(["abc"]);
    vi.useRealTimers();
    wrapper.unmount();
  });

  it("保存时 flush 掉挂起的推送并发 didSave（不重复推两次相同内容）", async () => {
    vi.useFakeTimers();
    const wrapper = mount(EditorPane, {
      global: { plugins: [createPinia()] },
      props: { path: "/repo/src/main.ts" },
    });
    await flush();

    wrapper.vm.setContentForTest("const value = 2;");
    await nextTick();
    await wrapper.vm.save();
    // didChange 立刻发出（防抖窗口被 flush），didSave 也发出
    expect(lspSync.changed).toEqual(["const value = 2;"]);
    expect(lspSync.saved).toEqual(["const value = 2;"]);

    // 防抖窗口过后不应再有第二次 didChange
    vi.advanceTimersByTime(300);
    expect(lspSync.changed).toEqual(["const value = 2;"]);
    vi.useRealTimers();
    wrapper.unmount();
  });

  it("没有编辑过就不发 didSave（不制造空通知）", async () => {
    const wrapper = mount(EditorPane, {
      global: { plugins: [createPinia()] },
      props: { path: "/repo/src/main.ts" },
    });
    await flush();
    // 未 dirty → save() 直接返回
    await wrapper.vm.save();
    expect(lspSync.saved).toEqual([]);
    expect(lspSync.changed).toEqual([]);
    wrapper.unmount();
  });
});
