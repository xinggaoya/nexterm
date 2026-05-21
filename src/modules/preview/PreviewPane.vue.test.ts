// @vitest-environment jsdom
import { mount } from "@vue/test-utils";
import { describe, expect, it, vi } from "vitest";
import PreviewPane from "./PreviewPane.vue";

vi.mock("./PreviewAddressBar.vue", () => ({
  default: {
    props: ["url"],
    emits: ["submit", "reload"],
    template:
      '<div data-preview-address-bar>{{ url }}<button data-address-submit @click="$emit(\'submit\', \'http://localhost:5173\')">go</button><button data-address-reload @click="$emit(\'reload\')">reload</button></div>',
  },
}));

describe("PreviewPane.vue", () => {
  it("renders a sandboxed iframe for visible preview URLs", () => {
    const wrapper = mount(PreviewPane, {
      props: {
        url: "http://localhost:5173",
        visible: true,
      },
    });

    const iframe = wrapper.find("iframe");
    expect(iframe.exists()).toBe(true);
    expect(iframe.attributes("src")).toBe("http://localhost:5173");
    expect(iframe.attributes("sandbox")).toContain("allow-scripts");
    expect(iframe.attributes("sandbox")).toContain("allow-same-origin");
    expect(iframe.attributes("sandbox")).not.toContain("allow-top-navigation");
    expect(iframe.attributes("referrerpolicy")).toBe("no-referrer");
    expect(wrapper.text()).not.toContain("Many public sites refuse to embed");
  });

  it("warns for public URLs and emits normalized URL changes", async () => {
    const wrapper = mount(PreviewPane, {
      props: {
        url: "https://example.com",
        visible: true,
      },
    });

    expect(wrapper.text()).toContain("Many public sites refuse to embed");

    await wrapper.find("[data-address-submit]").trigger("click");

    expect(wrapper.emitted("urlChange")).toEqual([["http://localhost:5173"]]);
  });
});
