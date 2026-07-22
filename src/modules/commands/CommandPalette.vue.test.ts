// @vitest-environment jsdom
import { flushPromises, mount } from "@vue/test-utils";
import { createPinia, setActivePinia } from "pinia";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { buildResolvedKeybindings } from "./keybindings";
import CommandPalette from "./CommandPalette.vue";
import type { CommandDefinition } from "./types";
import { useWorkspacesPiniaStore } from "@/modules/workspace";

const fileSearchMock = vi.hoisted(() => ({
  searchFileTree: vi.fn(),
}));

vi.mock("@/modules/explorer/lib/fileTreeService", () => ({
  searchFileTree: fileSearchMock.searchFileTree,
}));

// 多工作区重构后，CommandPalette 通过 useWorkspacesPiniaStore().activeWorkspace
// 拿到当前工作区，再用 createNativeForEnv(env) 构造 wsNative 去搜索文件。
// mock createNativeForEnv 返回一个占位对象（搜索函数本身已被单独 mock）。
vi.mock("@/lib/native", () => ({
  createNativeForEnv: () => ({}),
}));

const commands: CommandDefinition[] = [
  {
    id: "workbench.commandPalette.open",
    title: "Command Center",
    category: "workbench",
    defaultKeybinding: "Mod+K",
    run: () => {},
  },
  {
    id: "terminal.new",
    title: "New Terminal",
    category: "terminal",
    defaultKeybinding: "Ctrl+`",
    run: () => {},
  },
  {
    id: "git.refresh",
    title: "Refresh Source Control",
    category: "git",
    defaultKeybinding: null,
    when: (context) => context.workspaceReady,
    run: () => {},
  },
];

describe("CommandPalette.vue", () => {
  beforeEach(() => {
    setActivePinia(createPinia());
    fileSearchMock.searchFileTree.mockReset();
    // 文件快速打开模式需要当前活跃工作区；构造一个 local 工作区。
    const workspaces = useWorkspacesPiniaStore();
    workspaces.workspaces = [
      {
        id: "local:/repo",
        rootPath: "/repo",
        env: { kind: "local" },
        name: "repo",
        openedAt: 0,
      },
    ];
    workspaces.activeWorkspaceId = "local:/repo";
  });

  it("filters commands and emits the selected command", async () => {
    const wrapper = mount(CommandPalette, {
      props: {
        show: true,
        mode: "commands",
        commands,
        keybindings: buildResolvedKeybindings(commands, {}),
        context: { workspaceReady: true },
        workspaceRoot: "/repo",
        showHidden: false,
      },
    });

    await wrapper.find("[data-command-palette-input]").setValue("term");
    await wrapper.find("[data-command-palette-input]").trigger("keydown", {
      key: "Enter",
    });

    expect(wrapper.text()).toContain("New Terminal");
    expect(wrapper.emitted("executeCommand")).toEqual([["terminal.new"]]);
  });

  it("searches workspace files in quick-open mode and emits opened files", async () => {
    fileSearchMock.searchFileTree.mockResolvedValueOnce({
      hits: [
        {
          path: "/repo/src/main.ts",
          rel: "src/main.ts",
          name: "main.ts",
          is_dir: false,
        },
      ],
      truncated: false,
    });
    const wrapper = mount(CommandPalette, {
      props: {
        show: true,
        mode: "files",
        commands,
        keybindings: buildResolvedKeybindings(commands, {}),
        context: { workspaceReady: true },
        workspaceRoot: "/repo",
        showHidden: false,
        searchDelayMs: 0,
      },
    });

    await wrapper.find("[data-command-palette-input]").setValue("main");
    await flushPromises();

    // searchFileTree 现在以 wsNative 为首参；断言时忽略该参数。
    expect(fileSearchMock.searchFileTree).toHaveBeenCalledWith(
      expect.anything(),
      "/repo",
      "main",
      false,
    );
    await wrapper.find("[data-file-result='/repo/src/main.ts']").trigger("click");

    expect(wrapper.emitted("openFile")).toEqual([["/repo/src/main.ts"]]);
  });
});
