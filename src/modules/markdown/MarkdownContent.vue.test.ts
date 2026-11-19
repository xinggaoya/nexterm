// @vitest-environment jsdom
import { mount } from "@vue/test-utils";
import { beforeEach, describe, expect, it, vi } from "vitest";
import MarkdownContent from "./MarkdownContent.vue";
import { writeClipboardText } from "@/lib/clipboard";
import { openExternalUrl } from "@/lib/openExternal";

vi.mock("@/lib/clipboard", () => ({
  writeClipboardText: vi.fn(async () => {}),
}));

vi.mock("@/lib/openExternal", () => ({
  openExternalUrl: vi.fn(async () => {}),
}));

describe("MarkdownContent.vue", () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it("renders markdown content", () => {
    const wrapper = mount(MarkdownContent, {
      props: { content: "# Readme\n\nUse `pnpm test`." },
    });

    expect(wrapper.find("h1").text()).toContain("Readme");
    expect(wrapper.find("code").text()).toBe("pnpm test");
  });

  it("passes fallthrough attributes to the rendered article", () => {
    const wrapper = mount(MarkdownContent, {
      props: { content: "# Readme" },
      attrs: { "data-markdown-preview": "" },
    });

    expect(wrapper.find("[data-markdown-preview]").exists()).toBe(true);
  });

  it("copies the code block content when the copy control is clicked", async () => {
    const wrapper = mount(MarkdownContent, {
      props: { content: "```ts\nconst value = 1;\n```" },
    });

    await wrapper.find("[data-md-copy]").trigger("click");

    expect(writeClipboardText).toHaveBeenCalledTimes(1);
    expect(vi.mocked(writeClipboardText).mock.calls[0][0]).toContain("const");
  });

  it("opens external links in the system browser instead of navigating the webview", async () => {
    const wrapper = mount(MarkdownContent, {
      props: { content: "[docs](https://example.com)" },
    });

    const event = new MouseEvent("click", { bubbles: true, cancelable: true });
    wrapper.find("a").element.dispatchEvent(event);

    expect(openExternalUrl).toHaveBeenCalledWith("https://example.com");
    expect(event.defaultPrevented).toBe(true);
  });

  it("does not hand relative links to the system browser", async () => {
    const wrapper = mount(MarkdownContent, {
      props: { content: "[guide](./docs/guide.md)" },
    });

    const event = new MouseEvent("click", { bubbles: true, cancelable: true });
    wrapper.find("a").element.dispatchEvent(event);

    expect(openExternalUrl).not.toHaveBeenCalled();
    // 预览里的链接一律不接管 webview 导航。
    expect(event.defaultPrevented).toBe(true);
  });
});
