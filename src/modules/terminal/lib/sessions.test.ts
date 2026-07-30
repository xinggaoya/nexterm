import type { Terminal } from "@xterm/xterm";
import { beforeEach, describe, expect, it, vi } from "vitest";
import type { PtyHandlers, WorkspaceNative } from "@/lib/native";

import {
  createSession,
  disposeAllSessions,
  disposeSession,
  disposeWorkspaceSessions,
  getSessionForLeaf,
  trackSession,
} from "./sessions";

// 构造一个仅含 ptyOpen 的 mock wsNative。
// sessions 现在从 opts.wsNative.ptyOpen 创建 PTY（不再依赖全局 native），
// 因此测试通过 wsNative.ptyOpen 注入伪 PTY，并断言它被以正确参数调用。
function makeWsNative(ptyOpen: ReturnType<typeof vi.fn>) {
  return { ptyOpen } as unknown as WorkspaceNative;
}

describe("terminal sessions", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    disposeAllSessions();
  });

  it("uses the wsNative PTY adapter and preserves split OSC sequences", async () => {
    let handlers: PtyHandlers | undefined;
    let terminalInput: ((data: string) => void) | undefined;
    const pty = {
      id: 17,
      write: vi.fn().mockResolvedValue(undefined),
      resize: vi.fn().mockResolvedValue(undefined),
      close: vi.fn().mockResolvedValue(undefined),
    };
    const ptyOpen = vi.fn().mockImplementation(
      async (
        _cols: number,
        _rows: number,
        nextHandlers: PtyHandlers,
        _cwd?: string,
      ) => {
        handlers = nextHandlers;
        return pty;
      },
    );
    const wsNative = makeWsNative(ptyOpen);
    const term = {
      cols: 100,
      rows: 30,
      write: vi.fn(),
      onData: vi.fn((callback: (data: string) => void) => {
        terminalInput = callback;
      }),
    } as unknown as Terminal;
    const callbacks = {
      onCwd: vi.fn(),
      onTitle: vi.fn(),
      onStateChange: vi.fn(),
    };

    const session = await createSession({
      term,
      cwd: "/workspace",
      callbacks,
      wsNative,
    });
    expect(ptyOpen).toHaveBeenCalledWith(
      100,
      30,
      expect.any(Object),
      "/workspace",
    );

    handlers?.onData("before\x1b]7;file:///tmp/pro");
    // OSC 7 跨 chunk：第二个 chunk 把序列闭合后才会写出 OSC 7 之后的尾部。
    // 等一个 microtask 让第一次 flush 落地（"before" + 残 OSC 缓冲尚未闭合）。
    await Promise.resolve();
    await Promise.resolve();
    handlers?.onData("ject\x07after");
    // 两次 onData 在同一 tick 内会被合并成一次 write，但 OSC 7 解析后
    // 的 cleaned 已经按 chunk 边界剥离，"after" 与 "before" + "after" 应
    // 分别落在两次 write 调用里——前提是它们跨 microtask 边界。
    await Promise.resolve();
    await Promise.resolve();
    expect(term.write).toHaveBeenNthCalledWith(1, "before");
    expect(term.write).toHaveBeenNthCalledWith(2, "after");
    expect(callbacks.onCwd).toHaveBeenCalledWith("/tmp/project");

    terminalInput?.("typed input");
    expect(pty.write).toHaveBeenCalledWith("typed input");
    session.resize(120, 40);
    expect(pty.resize).toHaveBeenCalledWith(120, 40);
    // restart 现在是 best-effort 的 close（不再通过全局 ptyKill），因此
    // 断言 PTY 的 close 被触发。
    session.restart();
    expect(pty.close).toHaveBeenCalled();
    session.dispose();
    expect(pty.close).toHaveBeenCalledTimes(2);
  });

  it("partitions sessions by workspace id", async () => {
    const pty = {
      id: 42,
      write: vi.fn().mockResolvedValue(undefined),
      resize: vi.fn().mockResolvedValue(undefined),
      close: vi.fn().mockResolvedValue(undefined),
    };
    const ptyOpen = vi.fn().mockResolvedValue(pty);
    const wsNative = makeWsNative(ptyOpen);
    const term = {
      cols: 80,
      rows: 24,
      write: vi.fn(),
      onData: vi.fn(),
    } as unknown as Terminal;
    const callbacks = {
      onCwd: vi.fn(),
      onTitle: vi.fn(),
      onStateChange: vi.fn(),
    };

    const session = await createSession({ term, cwd: "/repo", callbacks, wsNative });

    // 按 workspace 分片注册：同一个 leafId 在不同 workspace 互不干扰。
    trackSession("ws-a", "leaf-1", session);
    expect(getSessionForLeaf("ws-a", "leaf-1")).toBe(session);
    expect(getSessionForLeaf("ws-b", "leaf-1")).toBeUndefined();

    // 销毁单个 workspace 内的 session。
    disposeSession("ws-a", "leaf-1");
    expect(getSessionForLeaf("ws-a", "leaf-1")).toBeUndefined();
    expect(pty.close).toHaveBeenCalled();
  });

  it("disposes all sessions for a workspace without touching others", async () => {
    const mkPty = () => ({
      id: Math.floor(Math.random() * 1000),
      write: vi.fn().mockResolvedValue(undefined),
      resize: vi.fn().mockResolvedValue(undefined),
      close: vi.fn().mockResolvedValue(undefined),
    });
    const wsNative = makeWsNative(vi.fn().mockImplementation(mkPty));
    const term = {
      cols: 80,
      rows: 24,
      write: vi.fn(),
      onData: vi.fn(),
    } as unknown as Terminal;
    const callbacks = {
      onCwd: vi.fn(),
      onTitle: vi.fn(),
      onStateChange: vi.fn(),
    };

    const a1 = await createSession({ term, cwd: "/a", callbacks, wsNative });
    const a2 = await createSession({ term, cwd: "/a2", callbacks, wsNative });
    const b1 = await createSession({ term, cwd: "/b", callbacks, wsNative });
    trackSession("ws-a", "a1", a1);
    trackSession("ws-a", "a2", a2);
    trackSession("ws-b", "b1", b1);

    disposeWorkspaceSessions("ws-a");
    expect(getSessionForLeaf("ws-a", "a1")).toBeUndefined();
    expect(getSessionForLeaf("ws-a", "a2")).toBeUndefined();
    // ws-b 上的 session 不应受影响。
    expect(getSessionForLeaf("ws-b", "b1")).toBe(b1);

    disposeAllSessions();
    expect(getSessionForLeaf("ws-b", "b1")).toBeUndefined();
  });
});
