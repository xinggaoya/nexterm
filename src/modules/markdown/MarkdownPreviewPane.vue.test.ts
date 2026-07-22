// @vitest-environment jsdom
import { mount } from "@vue/test-utils";
import { nextTick } from "vue";
import { beforeEach, describe, expect, it, vi } from "vitest";
import MarkdownPreviewPane from "./MarkdownPreviewPane.vue";
import { readMarkdownDocument } from "./lib/markdownDocumentService";

// 多工作区重构后，MarkdownPreviewPane 通过 useWorkspaceContext() 获取 wsNative。
// 测试不挂载 WorkspaceHost，因此 mock 该 composable 返回固定值。
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

vi.mock("./lib/markdownDocumentService", () => ({
  readMarkdownDocument: vi.fn(),
}));

// readMarkdownDocument 现在以 wsNative 为首参；断言时忽略该参数。
const WS_NATIVE_MATCHER = expect.anything();

async function flush() {
  await Promise.resolve();
  await nextTick();
}

describe("MarkdownPreviewPane.vue", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    vi.mocked(readMarkdownDocument).mockResolvedValue({
      status: "ready",
      content: "# Readme\n\nUse `pnpm test`.",
      size: 27,
    });
  });

  it("loads and renders markdown documents", async () => {
    const wrapper = mount(MarkdownPreviewPane, {
      props: {
        path: "/repo/README.md",
        visible: true,
      },
    });
    await flush();

    expect(readMarkdownDocument).toHaveBeenCalledWith(
      WS_NATIVE_MATCHER,
      "/repo/README.md",
    );
    expect(wrapper.find("[data-markdown-preview]").html()).toContain("<h1");
    expect(wrapper.text()).toContain("Readme");
    expect(wrapper.text()).toContain("README.md");
  });

  it("renders non-text document states", async () => {
    vi.mocked(readMarkdownDocument).mockResolvedValueOnce({
      status: "toolarge",
      size: 4096,
      limit: 1024,
    });

    const wrapper = mount(MarkdownPreviewPane, {
      props: {
        path: "/repo/LARGE.md",
        visible: true,
      },
    });
    await flush();

    expect(wrapper.text()).toContain("File is 4.0 KB");
    expect(wrapper.text()).toContain("limit 1.0 KB");
    expect(wrapper.find("[data-markdown-preview]").exists()).toBe(false);
  });
});
