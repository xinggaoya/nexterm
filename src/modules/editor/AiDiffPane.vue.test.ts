// @vitest-environment jsdom
import { mount } from "@vue/test-utils";
import { createPinia } from "pinia";
import { describe, expect, it } from "vitest";
import AiDiffPane from "./AiDiffPane.vue";

describe("AiDiffPane.vue", () => {
  it("renders pending AI diffs with review actions", async () => {
    const wrapper = mount(AiDiffPane, {
      global: { plugins: [createPinia()] },
      props: {
        path: "/repo/src/main.ts",
        originalContent: "const value = 1;\n",
        proposedContent: "const value = 2;\nconst next = true;\n",
        status: "pending",
        isNewFile: false,
      },
    });

    expect(wrapper.text()).toContain("Pending review");
    expect(wrapper.text()).toContain("/repo/src/main.ts");
    expect(wrapper.text()).toContain("+");
    expect(wrapper.find("[data-ai-diff-host]").exists()).toBe(true);

    await wrapper.find("[data-ai-diff-accept]").trigger("click");
    await wrapper.find("[data-ai-diff-reject]").trigger("click");

    expect(wrapper.emitted("accept")).toHaveLength(1);
    expect(wrapper.emitted("reject")).toHaveLength(1);
  });

  it("hides review actions once a diff has been resolved", () => {
    const wrapper = mount(AiDiffPane, {
      global: { plugins: [createPinia()] },
      props: {
        path: "/repo/src/main.ts",
        originalContent: "a\n",
        proposedContent: "b\n",
        status: "approved",
        isNewFile: true,
      },
    });

    expect(wrapper.text()).toContain("Applied");
    expect(wrapper.text()).toContain("New file");
    expect(wrapper.find("[data-ai-diff-accept]").exists()).toBe(false);
    expect(wrapper.find("[data-ai-diff-reject]").exists()).toBe(false);
  });
});
