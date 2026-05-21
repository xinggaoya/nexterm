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
  });

  it("uses an explicit launch directory when Tauri provides one", async () => {
    vi.mocked(invoke).mockResolvedValueOnce("D:\\repo");
    const { initLaunchDir, getLaunchDir } = await loadLaunchDirModule();

    await initLaunchDir();

    expect(getLaunchDir()).toBe("D:/repo");
    expect(invoke).toHaveBeenCalledTimes(1);
    expect(invoke).toHaveBeenCalledWith("get_launch_dir");
  });

  it("does not fall back to the process current directory without explicit launch args", async () => {
    vi.mocked(invoke).mockImplementation(async (cmd) => {
      if (cmd === "get_launch_dir") return null;
      if (cmd === "workspace_current_dir") return "D:\\fallback";
      throw new Error(`unexpected command: ${cmd}`);
    });
    const { initLaunchDir, getLaunchDir } = await loadLaunchDirModule();

    await initLaunchDir();

    expect(getLaunchDir()).toBeUndefined();
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
