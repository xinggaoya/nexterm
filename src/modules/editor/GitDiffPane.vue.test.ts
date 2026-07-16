// @vitest-environment jsdom
import { mount } from "@vue/test-utils";
import { createPinia } from "pinia";
import { nextTick } from "vue";
import { beforeEach, describe, expect, it, vi } from "vitest";
import GitDiffPane from "./GitDiffPane.vue";
import { fetchWorkingDiff } from "./lib/diffCache";

vi.mock("./lib/diffCache", async (importOriginal) => {
  const actual = await importOriginal<typeof import("./lib/diffCache")>();
  return {
    ...actual,
    fetchWorkingDiff: vi.fn(),
  };
});

vi.mock("monaco-editor", () => ({
  editor: {
    create: () => ({
      getValue: () => "",
      setValue: () => undefined,
      getModel: () => ({ dispose: () => undefined, getLineCount: () => 1 }),
      getSelection: () => ({ isEmpty: () => true }),
      onDidChangeModelContent: () => ({ dispose: () => undefined }),
      onDidChangeCursorPosition: () => ({ dispose: () => undefined }),
      trigger: () => undefined,
      focus: () => undefined,
      layout: () => undefined,
      setPosition: () => undefined,
      revealLine: () => undefined,
      executeEdits: () => undefined,
    }),
    createDiffEditor: () => ({
      setModel: () => undefined,
      dispose: () => undefined,
      onDidUpdateDiff: () => ({ dispose: () => undefined }),
      getLineChanges: () => null,
      getModel: () => ({
        original: { dispose: () => undefined },
        modified: { dispose: () => undefined },
      }),
    }),
    createModel: () => ({ dispose: () => undefined }),
    setTheme: () => undefined,
    defineTheme: () => undefined,
  },
  languages: { register: () => undefined },
}));

async function flush() {
  await Promise.resolve();
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
