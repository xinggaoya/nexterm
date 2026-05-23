import { describe, expect, it, vi } from "vitest";
import { createCommandRegistry, filterCommands } from "./registry";
import type { CommandDefinition } from "./types";

describe("command registry", () => {
  const definitions: CommandDefinition[] = [
    {
      id: "workbench.quickOpen.open",
      title: "Quick Open File",
      category: "workbench",
      defaultKeybinding: "Mod+P",
      run: vi.fn(),
    },
    {
      id: "terminal.new",
      title: "New Terminal",
      category: "terminal",
      defaultKeybinding: null,
      run: vi.fn(),
    },
    {
      id: "git.refresh",
      title: "Refresh Source Control",
      category: "git",
      defaultKeybinding: null,
      when: (context) => context.workspaceReady,
      run: vi.fn(),
    },
  ];

  it("filters commands by query and workspace availability", () => {
    expect(
      filterCommands(definitions, "term", { workspaceReady: true }).map(
        (command) => command.id,
      ),
    ).toEqual(["terminal.new"]);

    expect(
      filterCommands(definitions, "", { workspaceReady: false }).map(
        (command) => command.id,
      ),
    ).toEqual(["workbench.quickOpen.open", "terminal.new"]);
  });

  it("executes registered commands with the current context", async () => {
    const quickOpen = vi.fn();
    const registry = createCommandRegistry([
      {
        id: "workbench.quickOpen.open",
        title: "Quick Open File",
        category: "workbench",
        defaultKeybinding: "Mod+P",
        run: quickOpen,
      },
    ]);
    const context = { workspaceReady: true };

    await registry.execute("workbench.quickOpen.open", context);

    expect(quickOpen).toHaveBeenCalledWith(context);
  });

  it("rejects duplicate command ids", () => {
    expect(() =>
      createCommandRegistry([
        definitions[0],
        { ...definitions[0], title: "Duplicate" },
      ]),
    ).toThrow("Duplicate command id: workbench.quickOpen.open");
  });
});
