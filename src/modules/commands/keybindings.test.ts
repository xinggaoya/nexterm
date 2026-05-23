import { describe, expect, it } from "vitest";
import {
  buildResolvedKeybindings,
  findKeybindingConflicts,
  formatKeybinding,
  keybindingFromEvent,
  keybindingMatchesEvent,
  normalizeKeybinding,
} from "./keybindings";
import type { CommandDefinition } from "./types";

const commands: CommandDefinition[] = [
  {
    id: "workbench.commandPalette.open",
    title: "Command Center",
    category: "workbench",
    defaultKeybinding: "Mod+K",
    run: () => {},
  },
  {
    id: "workbench.quickOpen.open",
    title: "Quick Open",
    category: "workbench",
    defaultKeybinding: "Mod+P",
    run: () => {},
  },
  {
    id: "terminal.new",
    title: "New Terminal",
    category: "terminal",
    defaultKeybinding: null,
    run: () => {},
  },
];

describe("command keybindings", () => {
  it("normalizes typed shortcuts into a stable modifier order", () => {
    expect(normalizeKeybinding(" cmd + shift + p ")).toBe("Mod+Shift+P");
    expect(normalizeKeybinding("Control+alt+`")).toBe("Ctrl+Alt+`");
    expect(normalizeKeybinding("⌘ k")).toBe("Mod+K");
    expect(normalizeKeybinding("")).toBeNull();
  });

  it("merges default bindings with user overrides and disabled bindings", () => {
    expect(
      buildResolvedKeybindings(commands, {
        "workbench.quickOpen.open": "Ctrl+Shift+P",
        "terminal.new": "ctrl+`",
        "workbench.commandPalette.open": null,
      }),
    ).toEqual({
      "workbench.commandPalette.open": null,
      "workbench.quickOpen.open": "Ctrl+Shift+P",
      "terminal.new": "Ctrl+`",
    });
  });

  it("detects conflicts only for active normalized bindings", () => {
    const resolved = buildResolvedKeybindings(commands, {
      "workbench.quickOpen.open": "Mod+K",
      "terminal.new": null,
    });

    expect(findKeybindingConflicts(commands, resolved)).toEqual([
      {
        keybinding: "Mod+K",
        commandIds: [
          "workbench.commandPalette.open",
          "workbench.quickOpen.open",
        ],
      },
    ]);
  });

  it("formats and matches platform-aware Mod keybindings", () => {
    expect(formatKeybinding("Mod+Shift+P", true)).toBe("⌘⇧P");
    expect(formatKeybinding("Mod+Shift+P", false)).toBe("Ctrl+Shift+P");

    const macEvent = {
      key: "p",
      metaKey: true,
      shiftKey: true,
      ctrlKey: false,
      altKey: false,
    } as KeyboardEvent;
    const linuxEvent = {
      key: "p",
      ctrlKey: true,
      shiftKey: true,
      metaKey: false,
      altKey: false,
    } as KeyboardEvent;

    expect(keybindingMatchesEvent("Mod+Shift+P", macEvent, true)).toBe(true);
    expect(keybindingMatchesEvent("Mod+Shift+P", linuxEvent, false)).toBe(true);
    expect(keybindingMatchesEvent("Mod+Shift+P", linuxEvent, true)).toBe(false);
    expect(
      keybindingMatchesEvent(
        "Ctrl+Alt+9",
        {
          key: "9",
          ctrlKey: true,
          altKey: true,
          shiftKey: false,
          metaKey: false,
        } as KeyboardEvent,
        false,
      ),
    ).toBe(true);
  });

  it("captures keyboard events into normalized shortcuts", () => {
    expect(
      keybindingFromEvent(
        {
          key: "k",
          ctrlKey: true,
          shiftKey: true,
          altKey: false,
          metaKey: false,
        } as KeyboardEvent,
        false,
      ),
    ).toBe("Mod+Shift+K");
    expect(
      keybindingFromEvent(
        {
          key: "Backspace",
          ctrlKey: false,
          shiftKey: false,
          altKey: true,
          metaKey: true,
        } as KeyboardEvent,
        true,
      ),
    ).toBe("Mod+Alt+Backspace");
  });
});
