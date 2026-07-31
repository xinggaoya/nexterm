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

  it("rebindTerm switches the PTY bridge to a new xterm without leaking the old input subscription", async () => {
    // 构造一个 term mock:每个 term 维护一份 "active" 状态。
    // onData 注册的 callback 内部先检查 term 的 active 标志,只有活跃
    // 时才把数据送到 pty.write。rebind 内部 dispose 旧订阅时,会同步
    // 把旧 term 标记为 inactive(模拟 xterm 内部 onData 取消 listener
    // 后的真实行为)。这样可以严格断言"旧 term 的 onData 不再驱动
    // pty.write"。
    type Subs = Set<(data: string) => void>;
    function makeTerm(cols: number, rows: number, label: string) {
      let active = true;
      const subs: Subs = new Set();
      const term = {
        cols,
        rows,
        write: vi.fn(),
        onData: vi.fn((cb: (data: string) => void) => {
          if (!active) throw new Error(`onData on inactive ${label}`);
          // 包装 cb:term 被标记为 inactive 后,该 cb 自动 no-op,模拟
          // xterm 在 dispose 时取消内部 onData 订阅的语义。
          const wrapped = (data: string) => {
            if (!active) return;
            cb(data);
          };
          subs.add(wrapped);
          return {
            dispose: () => {
              subs.delete(wrapped);
            },
          };
        }),
      } as unknown as Terminal & { __subs: Subs; __deactivate: () => void };
      term.__subs = subs;
      // 测试用逃生口:模拟 xterm 被 dispose 时内部把所有 onData listener
      // 取消的行为。订阅本身仍存在,但 wrapper 已变 no-op。
      term.__deactivate = () => {
        active = false;
      };
      return term;
    }

    let handlers: PtyHandlers | undefined;
    const pty = {
      id: 9,
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
    const termA = makeTerm(100, 30, "A");
    const termB = makeTerm(120, 40, "B");
    const termC = makeTerm(80, 24, "C");
    const callbacks = {
      onCwd: vi.fn(),
      onTitle: vi.fn(),
      onStateChange: vi.fn(),
    };

    const session = await createSession({
      term: termA,
      cwd: "/repo",
      callbacks,
      wsNative,
    });

    // 初始:PTY 输出写到 termA,termA 的输入驱动 pty.write。
    handlers?.onData("hello-A");
    await Promise.resolve();
    expect(termA.write).toHaveBeenCalledWith("hello-A");
    expect(termA.__subs.size).toBe(1);
    const termAInput = [...termA.__subs][0];
    termAInput("typed-A");
    expect(pty.write).toHaveBeenLastCalledWith("typed-A");

    // 真实场景:split 触发 remount 时,旧 TerminalPane.onBeforeUnmount
    // 会 dispose renderer,renderer 会 dispose xterm,xterm 内部把所有
    // onData listener 取消(我们的 mock 用 __deactivate 模拟这一点)。
    // 接着新 TerminalPane.onMounted 跑完 createTerminalRenderer,再走
    // ensureSession 调 rebindTerm(newXterm)。这里先 deactivate 旧 term,
    // 再 rebind 到新 term,与真实流程一致。
    termA.__deactivate();
    session.rebindTerm(termB);

    // rebind 后:PTY 后续 onData 写到 termB,termA 不再收到(防止双写)。
    handlers?.onData("hello-B");
    await Promise.resolve();
    expect(termB.write).toHaveBeenCalledWith("hello-B");
    expect(termA.write).toHaveBeenCalledTimes(1);
    // termA 旧订阅已被 session 内部 dispose,xterm 也已 deactivate,任何
    // 通过旧 callback 路径触发的输入都不会到达 pty.write。
    expect(termA.__subs.size).toBe(0);
    expect(termB.__subs.size).toBe(1);
    const termBInput = [...termB.__subs][0];
    termAInput("after-rebind-A");
    termBInput("typed-B");
    expect(pty.write).toHaveBeenLastCalledWith("typed-B");
    expect(pty.write).not.toHaveBeenCalledWith("after-rebind-A");
    expect(pty.write).toHaveBeenCalledTimes(2); // 初始 1 + termB 1

    // 连续 rebind A→B→C:每次都要正确解绑前一次的输入订阅,不能累积。
    termB.__deactivate();
    session.rebindTerm(termC);
    expect(termB.__subs.size).toBe(0);
    expect(termC.__subs.size).toBe(1);
    handlers?.onData("hello-C");
    await Promise.resolve();
    expect(termC.write).toHaveBeenCalledWith("hello-C");
    expect(termA.write).toHaveBeenCalledTimes(1);
    expect(termB.write).toHaveBeenCalledTimes(1);
    // 在 termCInput 触发前,pty.write 应只有 typed-A / typed-B 两次。
    expect(pty.write).toHaveBeenCalledTimes(2);
    const termCInput = [...termC.__subs][0];
    termAInput("stale-A");
    termBInput("stale-B");
    termCInput("typed-C");
    // 只有 termCInput 真正到达 PTY,旧 term 的键入因 xterm 已 dispose 而
    // 失效(session 内部也已 dispose 旧订阅)。
    expect(pty.write).toHaveBeenLastCalledWith("typed-C");
    expect(pty.write).toHaveBeenCalledTimes(3);

    // rebind 到相同 term 是 no-op(防御性短路),不能重复挂订阅。
    session.rebindTerm(termC);
    expect(termC.__subs.size).toBe(1);

    // dispose 之后 rebind 仍安全:PTY 已关,新挂的 onData 把键入送到
    // 已死的 PTY,内部 silent-catch 不抛错。termA 已 deactivate(模拟旧
    // xterm 被 dispose),这里用一个新的、active 的 termD 来确保 rebind
    // 不会因为 onData 抛错而中断。
    session.dispose();
    const termD = makeTerm(100, 30, "D");
    expect(() => session.rebindTerm(termD)).not.toThrow();
  });
});
