// @vitest-environment jsdom
import { mount } from "@vue/test-utils";
import { nextTick } from "vue";
import { beforeEach, describe, expect, it, vi } from "vitest";
import FilePreviewPane from "./FilePreviewPane.vue";
import { readFilePreview } from "./lib/filePreviewDocumentService";

// 多工作区重构后，FilePreviewPane 通过 useWorkspaceContext() 获取 wsNative。
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

vi.mock("./lib/filePreviewDocumentService", () => ({
  readFilePreview: vi.fn(),
}));

async function flush() {
  await Promise.resolve();
  await nextTick();
}

describe("FilePreviewPane.vue", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    vi.mocked(readFilePreview).mockResolvedValue({
      status: "ready",
      src: "data:image/png;base64,aGVsbG8=",
      size: 2048,
    });
  });

  it("loads and renders the image as a data URL", async () => {
    const wrapper = mount(FilePreviewPane, {
      props: {
        path: "/repo/assets/logo.png",
        visible: true,
      },
    });
    await flush();

    expect(readFilePreview).toHaveBeenCalledWith(expect.anything(), "/repo/assets/logo.png");
    const img = wrapper.find("[data-file-preview-image]");
    expect(img.exists()).toBe(true);
    expect(img.attributes("src")).toBe("data:image/png;base64,aGVsbG8=");
    expect(wrapper.text()).toContain("logo.png");
    expect(wrapper.text()).toContain("2.0 KB");
  });

  it("renders the too-large state without an image", async () => {
    vi.mocked(readFilePreview).mockResolvedValueOnce({
      status: "toolarge",
      size: 4096,
      limit: 1024,
    });

    const wrapper = mount(FilePreviewPane, {
      props: {
        path: "/repo/assets/large.png",
        visible: true,
      },
    });
    await flush();

    expect(wrapper.text()).toContain("4.0 KB");
    expect(wrapper.find("[data-file-preview-image]").exists()).toBe(false);
  });

  it("renders the error state without an image", async () => {
    vi.mocked(readFilePreview).mockResolvedValueOnce({
      status: "error",
      message: "boom",
    });

    const wrapper = mount(FilePreviewPane, {
      props: {
        path: "/repo/assets/broken.png",
        visible: true,
      },
    });
    await flush();

    expect(wrapper.find("[data-file-preview-image]").exists()).toBe(false);
    expect(wrapper.text()).toContain("boom");
  });
});
