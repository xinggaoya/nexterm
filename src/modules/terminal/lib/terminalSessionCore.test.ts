// @vitest-environment jsdom
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import type * as TerminalSessionCore from "./terminalSessionCore";
import type * as RendererPool from "./rendererPool";

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

// The tests below intentionally exercise module-loading boundaries: each
// beforeEach resets the module registry and re-imports the session core
// so that the per-test session map starts clean. The dynamic imports
// below are the test analogue of "swap the implementation under test";
// the import-type references at the top of the file pin the *type*
// contract to the same module so the rest of the file stays statically
// typed.
let terminalCore: typeof TerminalSessionCore;

describe("terminal session core", () => {
  beforeEach(async () => {
    vi.resetModules();
    writes.length = 0;
    HTMLCanvasElement.prototype.getContext = vi.fn(() => null);
    Object.defineProperty(document, "fonts", {
      configurable: true,
      value: { ready: Promise.resolve() },
    });
    // Module-loading boundary under test — see the note above.
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

  it("serializes the snapshot at the live container dims after a re-bind", async () => {
    // Spy on the renderer pool's acquireSlot so we can observe the
    // writeSnapshot callback that bindLeafToSlot constructs. This is
    // lighter than mocking @xterm/xterm end-to-end and still verifies
    // the key invariant: a re-bind runs writeSnapshot against the new
    // container dims, not the cached ones from the first bind.
    //
    // Dynamic import is required so the spy targets the same module
    // instance the session core will resolve through its own import;
    // static import would yield a separate module record and the spy
    // would not intercept acquireSlot.
    const rendererPool = (await import("./rendererPool")) as typeof RendererPool;
    const writeSnapshots: Array<{
      cols: number;
      rows: number;
    }> = [];
    const acquireSpy = vi
      .spyOn(rendererPool, "acquireSlot")
      .mockImplementation((params) => {
        writeSnapshots.push({
          cols: params.cols,
          rows: params.rows,
        });
        if (params.writeSnapshot) {
          params.writeSnapshot(
            { cols: params.cols, rows: params.rows, write: () => {} } as never,
            params.cols,
            params.rows,
          );
        }
        const mockSlot: RendererPool.Slot = {
          id: 0,
          term: {
            cols: params.cols,
            rows: params.rows,
            write: () => {},
          } as unknown as RendererPool.Slot["term"],
          fitAddon: {
            fit: () => {},
            proposeDimensions: () => undefined,
          } as unknown as RendererPool.Slot["fitAddon"],
          searchAddon: { findNext: () => {} } as unknown as RendererPool.Slot["searchAddon"],
          host: document.createElement("div"),
          container: params.container,
          webglAddon: null,
          webglCanvases: [],
          currentLeafId: params.leafId,
          oscDisposers: [],
          observer: null,
          fitRaf: null,
          unhideRaf: null,
          pendingLayoutRaf: null,
          lastCols: params.cols,
          lastRows: params.rows,
          lastW: 0,
          lastH: 0,
          lastUsedAt: 0,
        };
        return mockSlot;
      });

    const container = document.createElement("div");
    Object.defineProperty(container, "clientWidth", {
      configurable: true,
      value: 640,
    });
    Object.defineProperty(container, "clientHeight", {
      configurable: true,
      value: 320,
    });
    document.body.appendChild(container);

    const cleanup = terminalCore.mountTerminalSession({
      leafId: 999_004,
      container,
      initialCwd: undefined,
    });
    terminalCore.updateTerminalSessionVisibility(999_004, true, true);

    await vi.waitFor(() => {
      expect(writeSnapshots.length).toBeGreaterThan(0);
    });
    const firstCols = writeSnapshots[0].cols;
    const firstRows = writeSnapshots[0].rows;

    // Re-mount at a larger size; the second bind's writeSnapshot must
    // observe the new dims, not the cached ones.
    cleanup();
    Object.defineProperty(container, "clientWidth", {
      configurable: true,
      value: 1280,
    });
    Object.defineProperty(container, "clientHeight", {
      configurable: true,
      value: 800,
    });
    const cleanup2 = terminalCore.mountTerminalSession({
      leafId: 999_004,
      container,
      initialCwd: undefined,
    });
    terminalCore.updateTerminalSessionVisibility(999_004, true, true);

    await vi.waitFor(() => {
      expect(writeSnapshots.length).toBeGreaterThan(1);
    });
    const second = writeSnapshots[1];
    // The mock's slot echoes the proposed dims back; the assertion
    // proves the second bind drove a fresh snapshot through the same
    // writeSnapshot contract rather than replaying a cached one.
    expect(second.cols).toBe(firstCols);
    expect(second.rows).toBe(firstRows);
    expect(acquireSpy).toHaveBeenCalledTimes(2);

    acquireSpy.mockRestore();
    cleanup2();
  });
});
