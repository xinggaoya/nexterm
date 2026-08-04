// @vitest-environment jsdom
import { mount, type VueWrapper } from "@vue/test-utils";
import { afterEach, describe, expect, it, vi } from "vitest";
import { defineComponent, h } from "vue";
import TabContextMenu from "./TabContextMenu.vue";
import type { Tab } from "@/modules/tabs/tabsTypes";
import { WORKSPACE_CONTEXT_KEY } from "@/app/workspaceContext";

type MenuOption = {
  key: string;
  label?: string;
  disabled?: boolean;
  type?: string;
  render?: (...args: unknown[]) => unknown;
};

type MockNode = ReturnType<typeof h>;

vi.mock("naive-ui", async () => {
  const actual = await vi.importActual<typeof import("naive-ui")>("naive-ui");
  return {
    ...actual,
    NDropdown: defineComponent({
      props: ["options", "show", "trigger", "placement", "x", "y"],
      emits: ["select", "clickoutside"],
      setup(props, { emit, slots }) {
        return () => {
          const options = (props.options as MenuOption[] | undefined) ?? [];
          return h(
            "div",
            {
              "data-dropdown-mock": "",
              "data-dropdown-x": String(props.x),
              "data-dropdown-y": String(props.y),
              "data-dropdown-show": String(props.show),
              "data-dropdown-trigger": String(props.trigger),
              "data-dropdown-placement": String(props.placement),
              onClickoutside: () => emit("clickoutside"),
            },
            [
              slots.default?.(),
              ...options.map((option) =>
                option.type === "divider"
                  ? h("div", {
                      "data-menu-divider": option.key,
                    })
                  : h(
                      "div",
                      {
                        "data-menu-action": option.key,
                        onClick: () => emit("select", option.key),
                      },
                      option.render
                        ? [option.render(option, { node: option } as unknown, 0) as MockNode]
                        : option.label,
                    ),
              ),
            ],
          );
        };
      },
    }),
  };
});

const baseTarget = { x: 10, y: 20, index: 0, total: 2 };
const terminalTab: Tab = {
  id: 1,
  workspaceId: "test-ws",
  kind: "terminal",
  title: "shell",
  cwd: "/repo/src",
  paneTree: { kind: "leaf", id: 2 },
  activeLeafId: 2,
};
const terminalWithoutCwd: Tab = {
  id: 5,
  workspaceId: "test-ws",
  kind: "terminal",
  title: "shell without cwd",
  paneTree: { kind: "leaf", id: 6 },
  activeLeafId: 6,
};
const editorTab: Tab = {
  id: 2,
  workspaceId: "test-ws",
  kind: "editor",
  title: "README.md",
  path: "/repo/README.md",
  dirty: false,
  preview: true,
};
const markdownTab: Tab = {
  id: 3,
  workspaceId: "test-ws",
  kind: "markdown",
  title: "guide.md",
  path: "/other/guide.md",
};
const previewTab: Tab = {
  id: 4,
  workspaceId: "test-ws",
  kind: "preview",
  title: "Preview",
  url: "https://example.test/preview.html",
};

function workspace(rootPath: string | null) {
  return { workspace: { rootPath } };
}

function mountMenu(
  tab: Tab,
  rootPath: string | null = "/repo",
  overrides: Record<string, unknown> = {},
) {
  return mount(TabContextMenu, {
    props: { target: { ...baseTarget, tab, ...overrides } },
    global: {
      provide: {
        [WORKSPACE_CONTEXT_KEY as symbol]: workspace(rootPath),
      },
    },
    attachTo: document.body,
  });
}

function action(wrapper: VueWrapper, key: string) {
  return wrapper.get(`[data-menu-action='${key}']`);
}

describe("TabContextMenu", () => {
  const wrappers: VueWrapper[] = [];

  afterEach(() => {
    for (const wrapper of wrappers.splice(0)) wrapper.unmount();
    document.body.innerHTML = "";
  });

  it("renders coordinates and preserves option order and dividers", () => {
    const wrapper = mountMenu(editorTab);
    wrappers.push(wrapper);
    const dropdown = wrapper.get("[data-dropdown-mock]");
    expect(dropdown.attributes("data-dropdown-x")).toBe("10");
    expect(dropdown.attributes("data-dropdown-y")).toBe("20");
    expect(dropdown.attributes("data-dropdown-show")).toBe("true");
    expect(dropdown.attributes("data-dropdown-trigger")).toBe("manual");
    expect(dropdown.attributes("data-dropdown-placement")).toBe("bottom-start");
    expect(wrapper.find(".nexterm-overlay").exists()).toBe(false);

    const options = dropdown.findAll(":scope > div");
    expect(options.map((node) => node.attributes("data-menu-action") ?? node.attributes("data-menu-divider"))).toEqual([
      "close",
      "close-others",
      "close-right",
      "close-all",
      "type-divider",
      "pin",
      "move-to-new-window",
      "path-divider",
      "copy-path",
      "copy-relative-path",
    ]);
    expect(options[0].find(".nexterm-dropdown-option").exists()).toBe(true);
  });

  it("hides right-side and multi-tab close actions when not applicable", () => {
    const singleWrapper = mountMenu(editorTab, "/repo", { total: 1 });
    wrappers.push(singleWrapper);
    expect(singleWrapper.find("[data-menu-action='close-others']").exists()).toBe(false);
    expect(singleWrapper.find("[data-menu-action='close-right']").exists()).toBe(false);
    expect(singleWrapper.find("[data-menu-action='close-all']").exists()).toBe(false);

    const lastWrapper = mountMenu(editorTab, "/repo", { index: 1, total: 2 });
    wrappers.push(lastWrapper);
    expect(lastWrapper.find("[data-menu-action='close-others']").exists()).toBe(true);
    expect(lastWrapper.find("[data-menu-action='close-right']").exists()).toBe(false);
    expect(lastWrapper.find("[data-menu-action='close-all']").exists()).toBe(true);
  });
  it("emits every close action and closes after each selection", async () => {
    const cases = [
      ["close", "closeTab", [2]],
      ["close-others", "closeOthers", [2]],
      ["close-right", "closeToRight", [2]],
      ["close-all", "closeAll", []],
    ] as const;
    for (const [key, event, payload] of cases) {
      const wrapper = mountMenu(editorTab);
      wrappers.push(wrapper);
      await action(wrapper, key).trigger("click");
      expect(wrapper.emitted(event)).toEqual([payload]);
      expect(wrapper.emitted("close")).toEqual([[]]);
      wrapper.unmount();
      wrappers.splice(wrappers.indexOf(wrapper), 1);
    }
  });

  it("emits terminal actions and closes after each selection", async () => {
    const duplicateWrapper = mountMenu(terminalTab);
    wrappers.push(duplicateWrapper);
    await action(duplicateWrapper, "duplicate").trigger("click");
    expect(duplicateWrapper.emitted("duplicateTerminal")).toEqual([[1]]);
    expect(duplicateWrapper.emitted("close")).toEqual([[]]);

    const renameWrapper = mountMenu(terminalTab);
    wrappers.push(renameWrapper);
    await action(renameWrapper, "rename").trigger("click");
    expect(renameWrapper.emitted("requestRename")).toEqual([[1]]);
    expect(renameWrapper.emitted("close")).toEqual([[]]);
  });

  it("emits pin and move actions for editor, markdown, and preview tabs", async () => {
    const editorWrapper = mountMenu(editorTab);
    wrappers.push(editorWrapper);
    expect(action(editorWrapper, "pin").element).toBeTruthy();
    await action(editorWrapper, "pin").trigger("click");
    expect(editorWrapper.emitted("pinEditor")).toEqual([[2]]);
    expect(editorWrapper.emitted("close")).toEqual([[]]);

    const moveWrapper = mountMenu(editorTab);
    wrappers.push(moveWrapper);
    await action(moveWrapper, "move-to-new-window").trigger("click");
    expect(moveWrapper.emitted("moveToNewWindow")).toEqual([[2]]);
    expect(moveWrapper.emitted("close")).toEqual([[]]);

    for (const tab of [markdownTab, previewTab]) {
      const wrapper = mountMenu(tab);
      wrappers.push(wrapper);
      await action(wrapper, "move-to-new-window").trigger("click");
      expect(wrapper.emitted("moveToNewWindow")).toEqual([[tab.id]]);
      expect(wrapper.emitted("close")).toEqual([[]]);
      expect(wrapper.find("[data-menu-action='pin']").exists()).toBe(false);
    }
  });

  it("emits absolute and relative path actions only when paths permit them", async () => {
    const wrapper = mountMenu(editorTab);
    wrappers.push(wrapper);
    await action(wrapper, "copy-path").trigger("click");
    expect(wrapper.emitted("copyPath")).toEqual([["/repo/README.md"]]);
    expect(wrapper.emitted("close")).toEqual([[]]);

    const relativeWrapper = mountMenu(editorTab);
    wrappers.push(relativeWrapper);
    await action(relativeWrapper, "copy-relative-path").trigger("click");
    expect(relativeWrapper.emitted("copyRelativePath")).toEqual([["/repo", "/repo/README.md"]]);
    expect(relativeWrapper.emitted("close")).toEqual([[]]);

    const terminalWrapper = mountMenu(terminalTab);
    wrappers.push(terminalWrapper);
    await action(terminalWrapper, "copy-path").trigger("click");
    expect(terminalWrapper.emitted("copyPath")).toEqual([["/repo/src"]]);
    expect(terminalWrapper.emitted("close")).toEqual([[]]);
    await action(terminalWrapper, "copy-relative-path").trigger("click");
    expect(terminalWrapper.emitted("copyRelativePath")).toEqual([["/repo", "/repo/src"]]);
    expect(terminalWrapper.emitted("close")).toHaveLength(2);

    const outsideWrapper = mountMenu(markdownTab);
    wrappers.push(outsideWrapper);
    expect(outsideWrapper.find("[data-menu-action='copy-path']").element).toBeTruthy();
    expect(outsideWrapper.findAll("[data-menu-action='copy-relative-path']")).toHaveLength(0);

    const noRootWrapper = mountMenu(editorTab, null);
    wrappers.push(noRootWrapper);
    expect(noRootWrapper.find("[data-menu-action='copy-path']").element).toBeTruthy();
    expect(noRootWrapper.findAll("[data-menu-action='copy-relative-path']")).toHaveLength(0);
  });

  it("has no path group or empty divider when the tab has no path", () => {
    const wrapper = mountMenu(terminalWithoutCwd);
    wrappers.push(wrapper);
    expect(wrapper.find("[data-menu-action='copy-path']").exists()).toBe(false);
    expect(wrapper.find("[data-menu-action='copy-relative-path']").exists()).toBe(false);
    expect(wrapper.findAll("[data-menu-divider='path-divider']")).toHaveLength(0);
  });

  it("emits close when dropdown reports clickoutside", async () => {
    const wrapper = mountMenu(terminalTab);
    wrappers.push(wrapper);
    await wrapper.get("[data-dropdown-mock]").trigger("clickoutside");
    expect(wrapper.emitted("close")).toEqual([[]]);
  });
});
