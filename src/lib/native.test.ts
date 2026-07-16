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

vi.mock("@tauri-apps/api/core", () => {
  class Channel<T> {
    onmessage: ((value: T) => void) | null = null;
  }
  return {
    invoke: vi.fn(),
    Channel,
  };
});

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

describe("native filesystem wrappers", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    setCurrentWorkspaceEnv(LOCAL_WORKSPACE);
  });

  it("reads files with the current workspace context", async () => {
    setCurrentWorkspaceEnv({ kind: "wsl", distro: "Ubuntu" });
    vi.mocked(invoke).mockResolvedValueOnce({
      kind: "text",
      content: "hi",
      size: 2,
    });

    const result = await native.fsReadFile("/repo/a.ts");

    expect(result).toEqual({ kind: "text", content: "hi", size: 2 });
    expect(invoke).toHaveBeenCalledWith("fs_read_file", {
      path: "/repo/a.ts",
      workspace: { kind: "wsl", distro: "Ubuntu" },
    });
  });

  it("writes files with the local workspace env by default", async () => {
    await native.fsWriteFile("/repo/a.ts", "next");

    expect(invoke).toHaveBeenCalledWith("fs_write_file", {
      path: "/repo/a.ts",
      content: "next",
      workspace: LOCAL_WORKSPACE,
    });
  });

  it("reads directories and propagates showHidden", async () => {
    vi.mocked(invoke).mockResolvedValueOnce([
      { name: "src", kind: "dir", size: 0, mtime: 1 },
    ]);

    const entries = await native.fsReadDir("/repo", true);

    expect(entries).toEqual([{ name: "src", kind: "dir", size: 0, mtime: 1 }]);
    expect(invoke).toHaveBeenCalledWith("fs_read_dir", {
      path: "/repo",
      showHidden: true,
      workspace: LOCAL_WORKSPACE,
    });
  });

  it("dispatches create dir vs create file to the right backend command", async () => {
    await native.fsCreateDir("/repo/dir");
    await native.fsCreateFile("/repo/file.txt");

    expect(invoke).toHaveBeenNthCalledWith(1, "fs_create_dir", {
      path: "/repo/dir",
      workspace: LOCAL_WORKSPACE,
    });
    expect(invoke).toHaveBeenNthCalledWith(2, "fs_create_file", {
      path: "/repo/file.txt",
      workspace: LOCAL_WORKSPACE,
    });
  });

  it("renames, deletes, and searches via the right backend commands", async () => {
    vi.mocked(invoke)
      .mockResolvedValueOnce(undefined)
      .mockResolvedValueOnce(undefined)
      .mockResolvedValueOnce({ hits: [], truncated: false });

    await native.fsRename("/repo/a.ts", "/repo/b.ts");
    await native.fsDelete("/repo/a.ts");
    const result = await native.fsSearch("/repo", "main", false);

    expect(invoke).toHaveBeenNthCalledWith(1, "fs_rename", {
      from: "/repo/a.ts",
      to: "/repo/b.ts",
      workspace: LOCAL_WORKSPACE,
    });
    expect(invoke).toHaveBeenNthCalledWith(2, "fs_delete", {
      path: "/repo/a.ts",
      workspace: LOCAL_WORKSPACE,
    });
    expect(invoke).toHaveBeenNthCalledWith(3, "fs_search", {
      root: "/repo",
      query: "main",
      limit: 200,
      showHidden: false,
      workspace: LOCAL_WORKSPACE,
    });
    expect(result).toEqual({ hits: [], truncated: false });
  });

  it("looks up the launch dir and WSL home through native", async () => {
    vi.mocked(invoke)
      .mockResolvedValueOnce("/repo")
      .mockResolvedValueOnce("/home/dev");

    await expect(native.getLaunchDir()).resolves.toBe("/repo");
    await expect(native.getWslHome("Ubuntu")).resolves.toBe("/home/dev");

    expect(invoke).toHaveBeenNthCalledWith(1, "get_launch_dir");
    expect(invoke).toHaveBeenNthCalledWith(2, "wsl_home", { distro: "Ubuntu" });
  });
});

describe("native git discovery wrapper", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    setCurrentWorkspaceEnv(LOCAL_WORKSPACE);
  });

  it("passes discovery limits and current workspace to git_discover_repositories (local)", async () => {
    vi.mocked(invoke).mockResolvedValueOnce({
      repositories: [],
      truncated: false,
    });

    const result = await native.gitDiscoverRepositories("/workspace", {
      maxDepth: 4,
      maxRepos: 32,
    });

    expect(result).toEqual({ repositories: [], truncated: false });
    expect(invoke).toHaveBeenCalledWith("git_discover_repositories", {
      rootPath: "/workspace",
      maxDepth: 4,
      maxRepos: 32,
      workspace: { kind: "local" },
    });
  });

  it("passes discovery limits and current workspace to git_discover_repositories (wsl)", async () => {
    setCurrentWorkspaceEnv({ kind: "wsl", distro: "Ubuntu" });
    vi.mocked(invoke).mockResolvedValueOnce({
      repositories: [],
      truncated: false,
    });

    await native.gitDiscoverRepositories("/workspace", {
      maxDepth: 4,
      maxRepos: 32,
    });

    expect(invoke).toHaveBeenCalledWith("git_discover_repositories", {
      rootPath: "/workspace",
      maxDepth: 4,
      maxRepos: 32,
      workspace: { kind: "wsl", distro: "Ubuntu" },
    });
  });
});

describe("native git log wrapper", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    setCurrentWorkspaceEnv(LOCAL_WORKSPACE);
  });

  it("requests the first page with the default options", async () => {
    vi.mocked(invoke).mockResolvedValueOnce({ entries: [], hasMore: false });

    const page = await native.gitLog("/repo");

    expect(page).toEqual({ entries: [], hasMore: false });
    expect(invoke).toHaveBeenCalledWith("git_log", {
      repoRoot: "/repo",
      options: {
        limit: null,
        offset: null,
        refName: null,
        all: false,
      },
      workspace: { kind: "local" },
    });
  });

  it("forwards refName / all / offset options through to git_log", async () => {
    vi.mocked(invoke).mockResolvedValueOnce({
      entries: [
        {
          sha: "abcdef123456",
          shortSha: "abcdef1",
          author: "Ada",
          authorEmail: "ada@example.com",
          timestampSecs: 1,
          parents: [],
          subject: "Add feature",
          filesChanged: 1,
          insertions: 1,
          deletions: 0,
          refs: [{ name: "feature/x", kind: "local-branch", isHead: true }],
        },
      ],
      hasMore: true,
    });

    const page = await native.gitLog("/repo", {
      limit: 30,
      offset: 30,
      refName: "feature/x",
      all: true,
    });

    expect(page.entries[0].refs?.[0]).toEqual({
      name: "feature/x",
      kind: "local-branch",
      isHead: true,
    });
    expect(page.hasMore).toBe(true);
    expect(invoke).toHaveBeenCalledWith("git_log", {
      repoRoot: "/repo",
      options: {
        limit: 30,
        offset: 30,
        refName: "feature/x",
        all: true,
      },
      workspace: { kind: "local" },
    });
  });

  it("passes the current workspace context through to git_log (wsl)", async () => {
    setCurrentWorkspaceEnv({ kind: "wsl", distro: "Ubuntu" });
    vi.mocked(invoke).mockResolvedValueOnce({ entries: [], hasMore: false });

    await native.gitLog("/repo", { limit: 5 });

    expect(invoke).toHaveBeenCalledWith("git_log", {
      repoRoot: "/repo",
      options: {
        limit: 5,
        offset: null,
        refName: null,
        all: false,
      },
      workspace: { kind: "wsl", distro: "Ubuntu" },
    });
  });
});

describe("native PTY wrappers", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    setCurrentWorkspaceEnv(LOCAL_WORKSPACE);
  });

  it("opens a PTY session that wires the onData channel to a typed handler", async () => {
    const captured: Array<{ onData: unknown; onExit: unknown }> = [];
    vi.mocked(invoke).mockImplementationOnce(async (_cmd, args) => {
      captured.push(args as { onData: unknown; onExit: unknown });
      return 7;
    });

    const handlers = {
      onData: vi.fn(),
      onExit: vi.fn(),
    };
    const session = await native.ptyOpen(80, 24, handlers, "/repo");

    expect(session.id).toBe(7);
    expect(captured).toHaveLength(1);
    const [args] = captured;
    expect(args).toMatchObject({
      cols: 80,
      rows: 24,
      cwd: "/repo",
      workspace: LOCAL_WORKSPACE,
    });
    expect(typeof args?.onData).toBe("object");
    expect(typeof args?.onExit).toBe("object");

    // Simulate an onData channel message carrying the raw PTY output.
    const { onData } = args as { onData: { onmessage: (chunk: string) => void } };
    onData.onmessage("hello\n");
    expect(handlers.onData).toHaveBeenCalledWith("hello\n");

    // Write/resize/close proxy through the session and forward to invoke
    vi.mocked(invoke).mockResolvedValueOnce(undefined);
    await session.write("echo");
    expect(invoke).toHaveBeenLastCalledWith("pty_write", { id: 7, data: "echo" });

    vi.mocked(invoke).mockResolvedValueOnce(undefined);
    await session.resize(120, 30);
    expect(invoke).toHaveBeenLastCalledWith("pty_resize", {
      id: 7,
      cols: 120,
      rows: 30,
    });

    vi.mocked(invoke).mockResolvedValueOnce(undefined);
    await session.close();
    expect(invoke).toHaveBeenLastCalledWith("pty_close", { id: 7 });
  });

  it("exposes raw PTY write/resize/close helpers", async () => {
    vi.mocked(invoke).mockResolvedValue(undefined);

    await native.ptyWrite(7, "echo");
    await native.ptyResize(7, 80, 24);
    await native.ptyClose(7);

    expect(invoke).toHaveBeenNthCalledWith(1, "pty_write", {
      id: 7,
      data: "echo",
    });
    expect(invoke).toHaveBeenNthCalledWith(2, "pty_resize", {
      id: 7,
      cols: 80,
      rows: 24,
    });
    expect(invoke).toHaveBeenNthCalledWith(3, "pty_close", { id: 7 });
  });
});