import { beforeEach, describe, expect, it, vi } from "vitest";
import { invoke } from "@tauri-apps/api/core";
import { listen } from "@tauri-apps/api/event";
import {
  DEEP_LINK_OPEN_EVENT,
  exitApp,
  native,
  onDeepLinkOpen,
  relaunchApp,
} from "./native";
import {
  LOCAL_WORKSPACE,
  setCurrentWorkspaceEnv,
} from "@/modules/workspace/workspaceEnvSnapshot";

vi.mock("@tauri-apps/api/core", () => ({
  invoke: vi.fn(),
}));

const exitMock = vi.fn(async (_code?: number) => undefined);
const relaunchMock = vi.fn(async () => undefined);

vi.mock("@tauri-apps/api/event", () => ({
  listen: vi.fn(),
}));

vi.mock("@tauri-apps/plugin-process", () => ({
  exit: (code?: number) => exitMock(code),
  relaunch: () => relaunchMock(),
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

describe("onDeepLinkOpen", () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it("subscribes to the deep-link event name and forwards payloads to the handler", async () => {
    const unlisten = vi.fn();
    vi.mocked(listen).mockResolvedValueOnce(unlisten);
    const handler = vi.fn();

    const result = await onDeepLinkOpen(handler);

    expect(listen).toHaveBeenCalledTimes(1);
    expect(listen).toHaveBeenCalledWith(
      DEEP_LINK_OPEN_EVENT,
      expect.any(Function),
    );
    expect(result).toBe(unlisten);

    // Simulate the event bus delivering a payload: pull the registered
    // callback and invoke it with a deep-link request.
    const [, callback] = vi.mocked(listen).mock.calls[0]!;
    const payload = { path: "/repo", env: "local" };
    callback({ event: "fake", id: 0, payload } as unknown as Parameters<typeof callback>[0]);
    expect(handler).toHaveBeenCalledWith(payload);
  });

  it("forwards wsl-distro payload fields without modification", async () => {
    vi.mocked(listen).mockResolvedValueOnce(vi.fn());
    const handler = vi.fn();

    await onDeepLinkOpen(handler);
    const [, callback] = vi.mocked(listen).mock.calls[0]!;
    const payload = { path: "/home/dev/repo", env: "wsl", wslDistro: "Ubuntu" };
    callback({ event: "fake", id: 0, payload } as unknown as Parameters<typeof callback>[0]);

    expect(handler).toHaveBeenCalledWith(payload);
  });
});

describe("relaunchApp / exitApp", () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it("forwards relaunchApp to the process plugin with no arguments", async () => {
    await relaunchApp();
    expect(relaunchMock).toHaveBeenCalledTimes(1);
    expect(relaunchMock).toHaveBeenCalledWith();
  });

  it("defaults exitApp to code 0 when no argument is given", async () => {
    await exitApp();
    expect(exitMock).toHaveBeenCalledWith(0);
  });

  it("forwards explicit exit codes to the process plugin", async () => {
    await exitApp(137);
    expect(exitMock).toHaveBeenCalledWith(137);
  });
});
