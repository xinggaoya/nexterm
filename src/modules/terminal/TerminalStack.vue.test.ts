// @vitest-environment jsdom
import { mount } from "@vue/test-utils";
import { createPinia } from "pinia";
import { describe, expect, it, vi } from "vitest";
import TerminalStack from "./TerminalStack.vue";

vi.mock("./TerminalPane.vue", () => ({
  default: {
    name: "TerminalPane",
    props: ["leafId", "visible", "focused", "initialCwd"],
    emits: ["searchReady", "exit", "cwd"],
    template:
      '<div class="terminal-pane" :data-leaf="leafId" @click="$emit(\'cwd\', leafId, `/cwd/${leafId}`)" />',
  },
}));

describe("TerminalStack.vue", () => {
  it("keeps terminal tabs mounted and hides inactive tabs", () => {
    const wrapper = mount(TerminalStack, {
      global: { plugins: [createPinia()] },
      props: {
        tabs: [
          {
            id: 1,
            kind: "terminal",
            title: "one",
            paneTree: { kind: "leaf", id: 10 },
            activeLeafId: 10,
          },
          {
            id: 2,
            kind: "terminal",
            title: "two",
            paneTree: { kind: "leaf", id: 20 },
            activeLeafId: 20,
          },
        ],
        activeId: 2,
      },
    });

    expect(wrapper.findAll(".terminal-pane")).toHaveLength(2);
    const tabHosts = wrapper.findAll("[data-terminal-tab]");
    expect(tabHosts[0].attributes("style")).toContain("visibility: hidden");
    expect(tabHosts[1].attributes("style")).toContain("visibility: visible");
  });

  it("emits the owning tab id when a leaf requests focus", async () => {
    const wrapper = mount(TerminalStack, {
      global: { plugins: [createPinia()] },
      props: {
        tabs: [
          {
            id: 7,
            kind: "terminal",
            title: "shell",
            paneTree: { kind: "leaf", id: 70 },
            activeLeafId: 99,
          },
        ],
        activeId: 7,
      },
    });

    await wrapper.find("[data-pane-leaf='70']").trigger("mousedown");

    expect(wrapper.emitted("focusLeaf")).toEqual([[7, 70]]);
  });
});
