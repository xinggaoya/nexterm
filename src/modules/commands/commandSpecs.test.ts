import { describe, expect, it } from "vitest";
import { ALL_COMMAND_SPECS } from "./commandSpecs";

describe("command specs", () => {
  it("collects unique module-owned command specs", () => {
    const ids = ALL_COMMAND_SPECS.map((command) => command.id);

    expect(new Set(ids).size).toBe(ids.length);
    expect(ids).toEqual(
      expect.arrayContaining([
        "workbench.commandPalette.open",
        "workbench.quickOpen.open",
        "terminal.new",
        "git.refresh",
        "explorer.refresh",
        "editor.save",
      ]),
    );
  });

  it("preserves the command center and quick open default shortcuts", () => {
    const defaults = Object.fromEntries(
      ALL_COMMAND_SPECS.map((command) => [
        command.id,
        command.defaultKeybinding,
      ]),
    );

    expect(defaults["workbench.commandPalette.open"]).toBe("Mod+K");
    expect(defaults["workbench.quickOpen.open"]).toBe("Mod+P");
  });
});
