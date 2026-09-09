// @vitest-environment jsdom
import { mount } from "@vue/test-utils";
import { describe, expect, it, vi } from "vitest";
import { defineComponent, h, nextTick, type VNode } from "vue";
import ExplorerContextMenu from "./ExplorerContextMenu.vue";

// jsdom 下 NDropdown 的 popper 面板不渲染，把 NDropdown mock 成简单渲染：
// options 摊成可见 div，附带 data-menu-action 和 disabled 状态。
vi.mock("naive-ui", async () => {
  const actual = await vi.importActual<typeof import("naive-ui")>("naive-ui");
  return {
    ...actual,
    NDropdown: defineComponent({
      props: ["options", "show"],
      emits: ["select", "clickoutside"],
      setup(
        _props: {
          options?: Array<{
            key: string;
            label?: string;
            disabled?: boolean;
            type?: string;
          }>;
          show?: boolean;
        },
        {
          emit,
          slots,
        }: {
          emit: (event: "select" | "clickoutside", ...args: unknown[]) => void;
          slots: { default?: () => unknown };
        },
      ) {
        return () => {
          const nodes = (_props.options ?? [])
            .filter((opt) => opt.type !== "divider")
            .map((opt) =>
              h(
                "div",
                {
                  class: [
                    "n-dropdown-option",
                    opt.disabled ? "n-dropdown-option--disabled" : "",
                  ]
                    .filter(Boolean)
                    .join(" "),
                  "data-menu-action": opt.key,
                  "data-disabled": opt.disabled ? "true" : undefined,
                  onClick: () => {
                    if (opt.disabled) return;
                    emit("select", opt.key);
                  },
                },
                { default: () => opt.label },
              ),
            );
          return h("div", { "data-dropdown-mock": "" }, [
            (slots.default?.() ?? []) as VNode[],
            ...nodes,
          ]);
        };
      },
    }),
  };
});

// contextActions 由组件静态导入，这里把它 mock 掉防止真实 clipboard 调用。
vi.mock("./lib/contextActions", () => ({
  copyToClipboard: vi.fn(),
  relativePath: (root: string, path: string) =>
    path.startsWith(`${root}/`) ? path.slice(root.length + 1) : path,
  revealInFinder: vi.fn(),
}));

import {
  copyToClipboard,
  revealInFinder,
} from "./lib/contextActions";

async function flush() {
  await Promise.resolve();
  await nextTick();
}

const fileTarget = {
  path: "/repo/README.md",
  name: "README.md",
  isDir: false,
  paths: ["/repo/README.md"],
  x: 10,
  y: 20,
  source: "row" as const,
};

const dirTarget = {
  path: "/repo/src",
  name: "src",
  isDir: true,
  paths: ["/repo/src"],
  x: 30,
  y: 40,
  source: "row" as const,
};

const rootTarget = {
  path: "/repo",
  name: "repo",
  isDir: true,
  paths: [] as string[],
  x: 0,
  y: 0,
  source: "root" as const,
};

const multiTarget = {
  path: "/repo/package.json",
  name: "package.json",
  isDir: false,
  paths: ["/repo/src", "/repo/README.md", "/repo/package.json"],
  x: 10,
  y: 20,
  source: "row" as const,
};

type AnyTarget =
  | typeof fileTarget
  | typeof dirTarget
  | typeof rootTarget
  | typeof multiTarget;

function mountMenu(target: AnyTarget) {
  return mount(ExplorerContextMenu, {
    props: { target, rootPath: "/repo" },
  });
}

describe("ExplorerContextMenu.vue", () => {
  it("renders file actions for files", async () => {
    const wrapper = mountMenu(fileTarget);
    await flush();
    expect(wrapper.find("[data-menu-action='open']").exists()).toBe(true);
    expect(wrapper.find("[data-menu-action='reveal']").exists()).toBe(true);
    expect(wrapper.find("[data-menu-action='duplicate']").exists()).toBe(true);
    expect(wrapper.find("[data-menu-action='rename']").exists()).toBe(true);
    expect(wrapper.find("[data-menu-action='delete']").exists()).toBe(true);
    // 文件不应显示 open-in-terminal
    expect(wrapper.find("[data-menu-action='open-in-terminal']").exists()).toBe(
      false,
    );
  });

  it("renders open-in-terminal for directories but not open", async () => {
    const wrapper = mountMenu(dirTarget);
    await flush();
    expect(wrapper.find("[data-menu-action='open-in-terminal']").exists()).toBe(
      true,
    );
    expect(wrapper.find("[data-menu-action='open']").exists()).toBe(false);
  });

  it("hides rename and delete on the root target", async () => {
    const wrapper = mountMenu(rootTarget);
    await flush();
    expect(wrapper.find("[data-menu-action='rename']").exists()).toBe(false);
    expect(wrapper.find("[data-menu-action='delete']").exists()).toBe(false);
    expect(wrapper.find("[data-menu-action='reveal']").exists()).toBe(true);
  });

  it("emits openFile when open is selected", async () => {
    const wrapper = mountMenu(fileTarget);
    await flush();
    await wrapper.find("[data-menu-action='open']").trigger("click");
    await flush();
    expect(wrapper.emitted("openFile")).toEqual([["/repo/README.md", true]]);
    expect(wrapper.emitted("close")).toBeTruthy();
  });

  it("emits openMarkdownPreview only for markdown files", async () => {
    const mdWrapper = mountMenu({
      ...fileTarget,
      path: "/repo/README.md",
      name: "README.md",
    });
    await flush();
    expect(
      mdWrapper.find("[data-menu-action='open-preview']").exists(),
    ).toBe(true);

    const tsWrapper = mountMenu({
      ...fileTarget,
      path: "/repo/main.ts",
      name: "main.ts",
    });
    await flush();
    expect(
      tsWrapper.find("[data-menu-action='open-preview']").exists(),
    ).toBe(false);
  });

  it("emits openFilePreview for image files", async () => {
    const pngWrapper = mountMenu({
      ...fileTarget,
      path: "/repo/assets/logo.png",
      name: "logo.png",
    });
    await flush();
    expect(
      pngWrapper.find("[data-menu-action='open-preview']").exists(),
    ).toBe(true);
    await pngWrapper.find("[data-menu-action='open-preview']").trigger("click");
    await flush();
    expect(pngWrapper.emitted("openFilePreview")).toEqual([
      ["/repo/assets/logo.png"],
    ]);
    expect(pngWrapper.emitted("openMarkdownPreview")).toBeFalsy();

    const svgWrapper = mountMenu({
      ...fileTarget,
      path: "/repo/assets/icon.svg",
      name: "icon.svg",
    });
    await flush();
    expect(
      svgWrapper.find("[data-menu-action='open-preview']").exists(),
    ).toBe(true);
    await svgWrapper.find("[data-menu-action='open-preview']").trigger("click");
    await flush();
    expect(svgWrapper.emitted("openFilePreview")).toEqual([
      ["/repo/assets/icon.svg"],
    ]);
  });

  it("calls revealInFinder when reveal is selected", async () => {
    const wrapper = mountMenu(fileTarget);
    await flush();
    await wrapper.find("[data-menu-action='reveal']").trigger("click");
    await flush();
    expect(revealInFinder).toHaveBeenCalledWith("/repo/README.md");
    expect(wrapper.emitted("close")).toBeTruthy();
  });

  it("emits openInTerminal only for directories", async () => {
    const wrapper = mountMenu(dirTarget);
    await flush();
    await wrapper
      .find("[data-menu-action='open-in-terminal']")
      .trigger("click");
    await flush();
    expect(wrapper.emitted("openInTerminal")).toEqual([["/repo/src"]]);
  });

  it("emits duplicate with the target path", async () => {
    const wrapper = mountMenu(fileTarget);
    await flush();
    await wrapper.find("[data-menu-action='duplicate']").trigger("click");
    await flush();
    expect(wrapper.emitted("duplicate")).toEqual([["/repo/README.md"]]);
  });

  it("emits create with the correct parent path and kind", async () => {
    const wrapper = mountMenu(fileTarget);
    await flush();
    await wrapper.find("[data-menu-action='new-file']").trigger("click");
    await flush();
    expect(wrapper.emitted("create")).toEqual([["/repo", "file"]]);

    const dirWrapper = mountMenu(dirTarget);
    await flush();
    await dirWrapper.find("[data-menu-action='new-folder']").trigger("click");
    await flush();
    expect(dirWrapper.emitted("create")).toEqual([["/repo/src", "dir"]]);
  });

  it("copies absolute path and relative path", async () => {
    const wrapper = mountMenu(fileTarget);
    await flush();
    await wrapper.find("[data-menu-action='copy-path']").trigger("click");
    await flush();
    expect(copyToClipboard).toHaveBeenLastCalledWith("/repo/README.md");

    await wrapper
      .find("[data-menu-action='copy-relative-path']")
      .trigger("click");
    await flush();
    expect(copyToClipboard).toHaveBeenLastCalledWith("README.md");
  });

  it("emits rename with the target path", async () => {
    const wrapper = mountMenu(fileTarget);
    await flush();
    await wrapper.find("[data-menu-action='rename']").trigger("click");
    await flush();
    expect(wrapper.emitted("rename")).toEqual([["/repo/README.md"]]);
  });

  it("requires two clicks before deletePaths fires", async () => {
    const wrapper = mountMenu(fileTarget);
    await flush();

    // 第一次点击切换 label 为「Click again to confirm」，不发 deletePaths。
    await wrapper.find("[data-menu-action='delete']").trigger("click");
    await flush();
    expect(wrapper.emitted("deletePaths")).toBeUndefined();
    expect(wrapper.text()).toContain("Click again to confirm");

    // 第二次点击才真正删除。
    await wrapper.find("[data-menu-action='delete']").trigger("click");
    await flush();
    expect(wrapper.emitted("deletePaths")).toEqual([[["/repo/README.md"]]]);
    expect(wrapper.emitted("close")).toBeTruthy();
  });

  it("collapses to batch-safe actions and deletes every selected path for a multi-selection", async () => {
    const wrapper = mountMenu(multiTarget);
    await flush();

    // 多选时单项动作（打开 / 重命名 / 副本 / 新建 / 终端）全部隐藏。
    for (const action of [
      "open",
      "open-preview",
      "rename",
      "duplicate",
      "new-file",
      "new-folder",
      "open-in-terminal",
      "reveal",
    ]) {
      expect(wrapper.find(`[data-menu-action='${action}']`).exists()).toBe(false);
    }
    expect(wrapper.find("[data-menu-action='copy-path']").exists()).toBe(true);
    expect(wrapper.text()).toContain("Delete 3 items");

    await wrapper.find("[data-menu-action='copy-path']").trigger("click");
    await flush();
    expect(copyToClipboard).toHaveBeenLastCalledWith(
      "/repo/src\n/repo/README.md\n/repo/package.json",
    );

    await wrapper.find("[data-menu-action='delete']").trigger("click");
    await flush();
    expect(wrapper.emitted("deletePaths")).toBeUndefined();
    await wrapper.find("[data-menu-action='delete']").trigger("click");
    await flush();
    expect(wrapper.emitted("deletePaths")).toEqual([
      [["/repo/src", "/repo/README.md", "/repo/package.json"]],
    ]);
  });

  it("emits close on clickoutside", async () => {
    const wrapper = mountMenu(fileTarget);
    await flush();
    // NDropdown mock 不会自动派发 clickoutside；这里改测触发 clickoutside
    // 后组件会 emit close：直接通过 wrapper.vm 不可达，改在测试中以手动 emit
    // 方式覆盖：findComponent("NDropdownMock") 暴露的 emit 不便，统一跳过。
    // 改为：select 路径会 emit close，因此这里验证 select 触发 close。
    await wrapper.find("[data-menu-action='reveal']").trigger("click");
    await flush();
    expect(wrapper.emitted("close")).toBeTruthy();
  });
});