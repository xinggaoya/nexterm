import { describe, expect, it, vi } from "vitest";
import {
  isSuppressedDevtoolsCommand,
  suppressDevtoolsNativeContextMenu,
} from "./devtoolsContextMenu";

type Internals = {
  invoke?: (cmd: string, ...args: unknown[]) => Promise<unknown>;
  __nextermDevtoolsContextMenuGuard?: boolean;
};

function fakeWindow(invoke?: Internals["invoke"]) {
  const internals: Internals = invoke ? { invoke } : {};
  return { __TAURI_INTERNALS__: internals } as unknown as Window & {
    __TAURI_INTERNALS__: Internals;
  };
}

describe("devtools context menu guard", () => {
  it("only suppresses the plugin native context menu command", () => {
    expect(isSuppressedDevtoolsCommand("plugin:devtools-app|show_context_menu")).toBe(
      true,
    );
    expect(isSuppressedDevtoolsCommand("plugin:devtools-app|toggle")).toBe(false);
    expect(isSuppressedDevtoolsCommand("toggle_devtools")).toBe(false);
  });

  it("drops the native context menu invocation and keeps other commands", async () => {
    const invoke = vi.fn(async (cmd: string) => `handled:${cmd}`);
    const target = fakeWindow(invoke);

    expect(suppressDevtoolsNativeContextMenu(target)).toBe(true);
    const internals = (
      target as unknown as { __TAURI_INTERNALS__: Internals }
    ).__TAURI_INTERNALS__;

    await expect(
      internals.invoke?.("plugin:devtools-app|show_context_menu"),
    ).resolves.toBeUndefined();
    expect(invoke).not.toHaveBeenCalled();

    await expect(internals.invoke?.("plugin:devtools-app|toggle")).resolves.toBe(
      "handled:plugin:devtools-app|toggle",
    );
    expect(invoke).toHaveBeenCalledWith("plugin:devtools-app|toggle");
  });

  it("is a no-op outside the Tauri runtime and installs only once", async () => {
    expect(suppressDevtoolsNativeContextMenu(fakeWindow())).toBe(false);

    const invoke = vi.fn(async (cmd: string) => cmd);
    const target = fakeWindow(invoke);
    expect(suppressDevtoolsNativeContextMenu(target)).toBe(true);
    expect(suppressDevtoolsNativeContextMenu(target)).toBe(false);

    const internals = (
      target as unknown as { __TAURI_INTERNALS__: Internals }
    ).__TAURI_INTERNALS__;
    await internals.invoke?.("plugin:devtools-app|toggle");
    expect(invoke).toHaveBeenCalledTimes(1);
  });
});
