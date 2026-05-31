// @vitest-environment jsdom
import { invoke } from "@tauri-apps/api/core";
import { beforeEach, describe, expect, it, vi } from "vitest";

vi.mock("@tauri-apps/api/core", () => ({
  invoke: vi.fn(),
}));

async function loadLaunchDirModule() {
  vi.resetModules();
  return import("./launchDir");
}

describe("launchDir", () => {
  beforeEach(() => {
    vi.mocked(invoke).mockReset();
    window.history.replaceState(null, "", "/");
  });

  it("uses an explicit launch directory when Tauri provides one", async () => {
    vi.mocked(invoke).mockResolvedValueOnce("D:\\repo");
    const { initLaunchDir, getLaunchDir, getLaunchWorkspace } =
      await loadLaunchDirModule();

    await initLaunchDir();

    expect(getLaunchDir()).toBe("D:/repo");
    expect(getLaunchWorkspace()).toEqual({
      path: "D:/repo",
      env: { kind: "local" },
    });
    expect(invoke).toHaveBeenCalledTimes(1);
    expect(invoke).toHaveBeenCalledWith("get_launch_dir");
  });

  it("uses a local workspace encoded in the window URL ahead of Tauri launch args", async () => {
    window.history.replaceState(
      null,
      "",
      "/?workspacePath=D%3A%5Crepo&workspaceEnv=local",
    );
    vi.mocked(invoke).mockResolvedValueOnce("/ignored");
    const { initLaunchDir, getLaunchDir, getLaunchWorkspace } =
      await loadLaunchDirModule();

    await initLaunchDir();

    expect(getLaunchDir()).toBe("D:/repo");
    expect(getLaunchWorkspace()).toEqual({
      path: "D:/repo",
      env: { kind: "local" },
    });
    expect(invoke).not.toHaveBeenCalled();
  });

  it("uses a WSL workspace encoded in the window URL", async () => {
    window.history.replaceState(
      null,
      "",
      "/?workspacePath=%2Fhome%2Fdev%2Frepo&workspaceEnv=wsl&wslDistro=Ubuntu",
    );
    const { initLaunchDir, getLaunchWorkspace } = await loadLaunchDirModule();

    await initLaunchDir();

    expect(getLaunchWorkspace()).toEqual({
      path: "/home/dev/repo",
      env: { kind: "wsl", distro: "Ubuntu" },
    });
    expect(invoke).not.toHaveBeenCalled();
  });

  it("does not fall back to the process current directory without explicit launch args", async () => {
    vi.mocked(invoke).mockImplementation(async (cmd) => {
      if (cmd === "get_launch_dir") return null;
      if (cmd === "workspace_current_dir") return "D:\\fallback";
      throw new Error(`unexpected command: ${cmd}`);
    });
    const { initLaunchDir, getLaunchDir, getLaunchWorkspace } =
      await loadLaunchDirModule();

    await initLaunchDir();

    expect(getLaunchDir()).toBeUndefined();
    expect(getLaunchWorkspace()).toBeUndefined();
    expect(invoke).toHaveBeenCalledWith("get_launch_dir");
    expect(invoke).not.toHaveBeenCalledWith("workspace_current_dir");
  });

  it("keeps launch dir undefined when Tauri directory commands fail", async () => {
    vi.mocked(invoke).mockRejectedValue(new Error("not in tauri"));
    const { initLaunchDir, getLaunchDir } = await loadLaunchDirModule();

    await initLaunchDir();

    expect(getLaunchDir()).toBeUndefined();
  });
});
