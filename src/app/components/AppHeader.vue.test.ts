// @vitest-environment jsdom
import { mount } from "@vue/test-utils";
import { describe, expect, it, vi } from "vitest";
import AppHeader from "./AppHeader.vue";
import type { Tab } from "@/modules/tabs/tabsTypes";

vi.mock("@/components/WindowControls.vue", () => ({
  default: { template: "<div data-window-controls />" },
}));

const tabs: Tab[] = [
  {
    id: 1,
    kind: "terminal",
    title: "shell",
    terminalTitle: "OpenAI Codex",
    cwd: "/repo/nexterm",
    paneTree: { kind: "leaf", id: 2 },
    activeLeafId: 2,
  },
  {
    id: 3,
    kind: "terminal",
    title: "private",
    cwd: "C:\\Users\\me\\secret",
    private: true,
    paneTree: { kind: "leaf", id: 4 },
    activeLeafId: 4,
  },
  {
    id: 5,
    kind: "editor",
    title: "main.ts",
    path: "/repo/src/main.ts",
    dirty: true,
    preview: false,
  },
  {
    id: 6,
    kind: "editor",
    title: "preview.ts",
    path: "/repo/src/preview.ts",
    dirty: false,
    preview: true,
  },
  {
    id: 7,
    kind: "markdown",
    title: "README.md",
    path: "/repo/README.md",
  },
  {
    id: 8,
    kind: "preview",
    title: "localhost:3180",
    url: "http://localhost:3180",
  },
  {
    id: 9,
    kind: "git-diff",
    title: "main.ts",
    repoRoot: "/repo",
    path: "src/main.ts",
    mode: "+",
    originalPath: null,
  },
  {
    id: 10,
    kind: "git-history",
    title: "History · main",
    repoRoot: "/repo",
  },
  {
    id: 11,
    kind: "git-commit-file",
    title: "main.ts @ abc123",
    repoRoot: "/repo",
    sha: "abcdef",
    shortSha: "abc123",
    subject: "change",
    path: "src/main.ts",
    originalPath: null,
  },
];

describe("AppHeader.vue", () => {
  it("emits workbench actions from toolbar controls", async () => {
    const wrapper = mount(AppHeader, {
      props: {
        tabs,
        activeId: 1,
        canSplit: true,
        showWindowControls: true,
      },
    });

    await wrapper.find("[data-new-tab]").trigger("click");
    await wrapper.find("[data-new-private-tab]").trigger("click");
    await wrapper.find("[data-split-row]").trigger("click");
    await wrapper.find("[data-split-col]").trigger("click");
    await wrapper.find("[data-open-settings]").trigger("click");
    await wrapper.find("[data-tab-id='3']").trigger("click");
    await wrapper.find("[data-close-tab-id='3']").trigger("click");

    expect(wrapper.emitted("newTab")).toHaveLength(1);
    expect(wrapper.emitted("newPrivateTab")).toHaveLength(1);
    expect(wrapper.emitted("splitPane")).toEqual([[ "row" ], [ "col" ]]);
    expect(wrapper.find("[data-close-active-tab]").exists()).toBe(false);
    expect(wrapper.emitted("closeActiveTab")).toBeUndefined();
    expect(wrapper.emitted("openSettings")).toHaveLength(1);
    expect(wrapper.emitted("selectTab")).toEqual([[3]]);
    expect(wrapper.emitted("closeTab")).toEqual([[3]]);
    expect(wrapper.find("[data-window-controls]").exists()).toBe(true);
  });

  it("emits pinTab only when double clicking an editor preview tab", async () => {
    const wrapper = mount(AppHeader, {
      props: {
        tabs,
        activeId: 6,
        canSplit: true,
        showWindowControls: false,
      },
    });

    await wrapper.find("[data-tab-id='6']").trigger("dblclick");
    await wrapper.find("[data-tab-id='5']").trigger("dblclick");
    await wrapper.find("[data-tab-id='1']").trigger("dblclick");

    expect(wrapper.emitted("pinTab")).toEqual([[6]]);
  });

  it("renders tab icons and terminal labels from the current project directory", () => {
    const wrapper = mount(AppHeader, {
      props: {
        tabs,
        activeId: 1,
        canSplit: true,
        showWindowControls: false,
      },
    });

    expect(wrapper.find("[data-tab-label='1']").text()).toBe("OpenAI Codex");
    expect(wrapper.find("[data-tab-label='3']").text()).toBe("secret");
    expect(wrapper.find("[data-tab-icon='terminal']").exists()).toBe(true);
    expect(wrapper.find("[data-tab-icon='private-terminal']").exists()).toBe(true);
    expect(wrapper.find("[data-tab-icon='editor']").exists()).toBe(true);
    expect(wrapper.find("[data-tab-icon='markdown']").exists()).toBe(true);
    expect(wrapper.find("[data-tab-icon='preview']").exists()).toBe(true);
    expect(wrapper.find("[data-tab-icon='git-diff']").exists()).toBe(true);
    expect(wrapper.find("[data-tab-icon='git-history']").exists()).toBe(true);
    expect(wrapper.find("[data-tab-dirty='5']").exists()).toBe(true);
  });

  it("disables split actions when the active tab cannot split", () => {
    const wrapper = mount(AppHeader, {
      props: {
        tabs,
        activeId: 1,
        canSplit: false,
        showWindowControls: false,
      },
    });

    expect(wrapper.find("[data-split-row]").attributes("disabled")).toBeDefined();
    expect(wrapper.find("[data-split-col]").attributes("disabled")).toBeDefined();
    expect(wrapper.find("[data-window-controls]").exists()).toBe(false);
  });
});
