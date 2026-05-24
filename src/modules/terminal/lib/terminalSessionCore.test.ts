// @vitest-environment jsdom
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const writes = vi.hoisted(() => [] as string[]);
const openPtyMock = vi.hoisted(() =>
  vi.fn(async () => ({
    write: async (data: string) => {
      writes.push(data);
    },
    resize: vi.fn(async () => {}),
    close: vi.fn(async () => {}),
    readTranscript: vi.fn(async () => ({
      startOffset: 0,
      nextOffset: 0,
      totalOffset: 0,
      bytes: new Uint8Array(),
    })),
  })),
);

vi.mock("./pty-bridge", () => ({
  openPty: openPtyMock,
}));

let terminalCore: typeof import("./terminalSessionCore");

describe("terminal session core", () => {
  beforeEach(async () => {
    vi.resetModules();
    writes.length = 0;
    HTMLCanvasElement.prototype.getContext = vi.fn(() => null);
    Object.defineProperty(document, "fonts", {
      configurable: true,
      value: { ready: Promise.resolve() },
    });
    terminalCore = await import("./terminalSessionCore");
  });

  afterEach(() => {
    document.body.innerHTML = "";
    vi.clearAllMocks();
  });

  it("creates a framework-neutral pane handle for a leaf id", () => {
    const handle = terminalCore.createTerminalSessionHandle(999_001);

    expect(typeof handle.write).toBe("function");
    expect(typeof handle.focus).toBe("function");
    expect(typeof handle.getBuffer).toBe("function");
    expect(typeof handle.getSelection).toBe("function");
    expect(typeof handle.applyTheme).toBe("function");
  });

  it("returns null buffer and selection for a leaf without a session", () => {
    expect(terminalCore.getTerminalBuffer(999_002)).toBeNull();
    expect(terminalCore.getTerminalSelection(999_002)).toBeNull();
  });

  it("flushes startup input after the PTY opens", async () => {
    const container = document.createElement("div");
    document.body.appendChild(container);

    const cleanup = terminalCore.mountTerminalSession({
      leafId: 999_003,
      container,
      initialCwd: "/repo",
      startupInput: "pnpm run dev\r",
    });

    await vi.waitFor(() => {
      expect(openPtyMock).toHaveBeenCalled();
      expect(writes).toEqual(["pnpm run dev\r"]);
    });

    cleanup();
  });
});
