import type { Terminal } from "@xterm/xterm";
import { beforeEach, describe, expect, it, vi } from "vitest";
import type { PtyHandlers } from "@/lib/native";

const nativeMocks = vi.hoisted(() => ({
  ptyOpen: vi.fn(),
  ptyKill: vi.fn(),
}));

vi.mock("@/lib/native", () => ({ native: nativeMocks }));

import { createSession, SESSION_REGISTRY } from "./sessions";

describe("terminal sessions", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    SESSION_REGISTRY.clear();
    nativeMocks.ptyKill.mockResolvedValue(undefined);
  });

  it("uses the native PTY adapter and preserves split OSC sequences", async () => {
    let handlers: PtyHandlers | undefined;
    let terminalInput: ((data: string) => void) | undefined;
    const pty = {
      id: 17,
      write: vi.fn().mockResolvedValue(undefined),
      resize: vi.fn().mockResolvedValue(undefined),
      close: vi.fn().mockResolvedValue(undefined),
    };
    nativeMocks.ptyOpen.mockImplementation(
      async (_cols, _rows, nextHandlers: PtyHandlers) => {
        handlers = nextHandlers;
        return pty;
      },
    );
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

    const session = await createSession({ term, cwd: "/workspace", callbacks });
    expect(nativeMocks.ptyOpen).toHaveBeenCalledWith(
      100,
      30,
      expect.any(Object),
      "/workspace",
    );

    handlers?.onData("before\x1b]7;file:///tmp/pro");
    handlers?.onData("ject\x07after");
    expect(term.write).toHaveBeenNthCalledWith(1, "before");
    expect(term.write).toHaveBeenNthCalledWith(2, "after");
    expect(callbacks.onCwd).toHaveBeenCalledWith("/tmp/project");

    terminalInput?.("typed input");
    expect(pty.write).toHaveBeenCalledWith("typed input");
    session.resize(120, 40);
    expect(pty.resize).toHaveBeenCalledWith(120, 40);
    session.restart();
    expect(nativeMocks.ptyKill).toHaveBeenCalledWith(17);
    session.dispose();
    expect(pty.close).toHaveBeenCalled();
  });
});
