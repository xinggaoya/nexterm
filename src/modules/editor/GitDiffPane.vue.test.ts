// @vitest-environment jsdom
import { flushPromises, mount } from "@vue/test-utils";
import { createPinia } from "pinia";
import { nextTick } from "vue";
import { beforeEach, describe, expect, it, vi } from "vitest";
import GitDiffPane from "./GitDiffPane.vue";
import { fetchWorkingDiff } from "./lib/diffCache";

// 多工作区重构后，GitDiffPane 通过 useWorkspaceContext() 获取 wsNative 和 workspace.env。
// 测试不挂载 WorkspaceHost，因此直接 mock 该 composable 返回固定值。
const mockWsNative = {};
const mockEnv = { kind: "local" as const };
vi.mock("@/app/workspaceContext", () => ({
  useWorkspaceContext: () => ({
    workspace: {
      id: "local:/repo",
      rootPath: "/repo",
      env: mockEnv,
      name: "repo",
      openedAt: 0,
    },
    wsNative: mockWsNative,
  }),
}));

vi.mock("./lib/diffCache", async (importOriginal) => {
  const actual = await importOriginal<typeof import("./lib/diffCache")>();
  return {
    ...actual,
    fetchWorkingDiff: vi.fn(),
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
vi.mock("@codemirror/merge", async () => await import("../../../tests/codemirror-noop-stubs"));
vi.mock("@replit/codemirror-vim", async () => await import("../../../tests/codemirror-noop-stubs"));
vi.mock("@lezer/highlight", () => ({
  tags: new Proxy({}, { get: () => Symbol("tag") }),
}));

// diffCache 函数现在以 wsNative + env 为前两个参数；断言时用匹配器忽略它们。
const WS_NATIVE_MATCHER = expect.anything();
const ENV_MATCHER = expect.anything();

async function flush() {
  await Promise.resolve();
  await nextTick();
  // DiffCodeMirror 是 defineAsyncComponent，动态 import() 需要额外的
  // promise 轮次才能解析并渲染出 [data-git-diff-host]。
  await flushPromises();
  await vi.dynamicImportSettled();
  await nextTick();
}

describe("GitDiffPane.vue", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    vi.mocked(fetchWorkingDiff).mockResolvedValue({
      originalContent: "const value = 1;\n",
      modifiedContent: "const value = 2;\n",
      isBinary: false,
      fallbackPatch: "",
      truncated: false,
    });
  });

  it("loads a working tree diff and mounts a readonly diff editor", async () => {
    const wrapper = mount(GitDiffPane, {
      global: { plugins: [createPinia()] },
      props: {
        active: true,
        source: {
          kind: "working",
          repoRoot: "/repo",
          path: "src/main.ts",
          mode: "+",
          originalPath: null,
        },
      },
    });
    await flush();

    expect(fetchWorkingDiff).toHaveBeenCalledWith(
      WS_NATIVE_MATCHER,
      ENV_MATCHER,
      "/repo",
      "src/main.ts",
      "+",
      null,
    );
    expect(wrapper.text()).toContain("src/main.ts");
    expect(wrapper.text()).toContain("/repo");
    expect(wrapper.find("[data-git-diff-host]").exists()).toBe(true);
  });

  it("renders fallback patch content for binary diffs", async () => {
    vi.mocked(fetchWorkingDiff).mockResolvedValueOnce({
      originalContent: "",
      modifiedContent: "",
      isBinary: true,
      fallbackPatch: "diff --git a/logo.png b/logo.png\n+binary",
      truncated: false,
    });

    const wrapper = mount(GitDiffPane, {
      global: { plugins: [createPinia()] },
      props: {
        active: true,
        source: {
          kind: "working",
          repoRoot: "/repo",
          path: "logo.png",
          mode: "+",
          originalPath: null,
        },
      },
    });
    await flush();

    expect(wrapper.text()).toContain("Binary / patch fallback");
    expect(wrapper.text()).toContain("diff --git");
    expect(wrapper.find("[data-git-diff-host]").exists()).toBe(false);
  });
});
