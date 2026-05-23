// @vitest-environment jsdom
import { flushPromises, mount } from "@vue/test-utils";
import { describe, expect, it, vi } from "vitest";
import { buildResolvedKeybindings } from "./keybindings";
import CommandPalette from "./CommandPalette.vue";
import type { CommandDefinition } from "./types";

const fileSearchMock = vi.hoisted(() => ({
  searchFileTree: vi.fn(),
}));

vi.mock("@/modules/explorer/lib/fileTreeService", () => ({
  searchFileTree: fileSearchMock.searchFileTree,
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

    expect(fileSearchMock.searchFileTree).toHaveBeenCalledWith(
      "/repo",
      "main",
      false,
    );
    await wrapper.find("[data-file-result='/repo/src/main.ts']").trigger("click");

    expect(wrapper.emitted("openFile")).toEqual([["/repo/src/main.ts"]]);
  });
});
