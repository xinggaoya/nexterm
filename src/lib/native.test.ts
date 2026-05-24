import { beforeEach, describe, expect, it, vi } from "vitest";
import { invoke } from "@tauri-apps/api/core";
import { native } from "./native";
import {
  LOCAL_WORKSPACE,
  setCurrentWorkspaceEnv,
} from "@/modules/workspace/workspaceEnvSnapshot";

vi.mock("@tauri-apps/api/core", () => ({
  invoke: vi.fn(),
}));

describe("native shell background wrappers", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    setCurrentWorkspaceEnv(LOCAL_WORKSPACE);
  });

  it("spawns background shell commands with the current workspace context", async () => {
    setCurrentWorkspaceEnv({ kind: "wsl", distro: "Ubuntu" });
    vi.mocked(invoke).mockResolvedValueOnce(42);

    const handle = await native.shellBgSpawn("pnpm run dev", "/repo");

    expect(handle).toBe(42);
    expect(invoke).toHaveBeenCalledWith("shell_bg_spawn", {
      command: "pnpm run dev",
      cwd: "/repo",
      workspace: { kind: "wsl", distro: "Ubuntu" },
    });
  });

  it("reads logs, kills, and lists background shell commands", async () => {
    vi.mocked(invoke)
      .mockResolvedValueOnce({
        bytes: "ready\n",
        nextOffset: 6,
        dropped: 0,
        exited: false,
        exitCode: null,
      })
      .mockResolvedValueOnce(undefined)
      .mockResolvedValueOnce([
        {
          handle: 42,
          command: "pnpm run dev",
          cwd: "/repo",
          startedAtMs: 100,
          exited: false,
          exitCode: null,
        },
      ]);

    await expect(native.shellBgLogs(42, 0)).resolves.toMatchObject({
      bytes: "ready\n",
      nextOffset: 6,
    });
    await expect(native.shellBgKill(42)).resolves.toBeUndefined();
    await expect(native.shellBgList()).resolves.toHaveLength(1);

    expect(invoke).toHaveBeenNthCalledWith(1, "shell_bg_logs", {
      handle: 42,
      sinceOffset: 0,
    });
    expect(invoke).toHaveBeenNthCalledWith(2, "shell_bg_kill", {
      handle: 42,
    });
    expect(invoke).toHaveBeenNthCalledWith(3, "shell_bg_list");
  });
});
