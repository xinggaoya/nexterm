// @vitest-environment jsdom
import { beforeEach, describe, expect, it, vi } from "vitest";

const terminalInstances = vi.hoisted(() => [] as MockTerminal[]);
const clipboardMocks = vi.hoisted(() => ({
  readClipboardText: vi.fn(),
  writeClipboardText: vi.fn(),
}));
const resizeObserverMocks = vi.hoisted(
  () =>
    [] as Array<{
      callback: ResizeObserverCallback;
      observe: ReturnType<typeof vi.fn>;
      disconnect: ReturnType<typeof vi.fn>;
    }>,
);

type MockTerminal = {
  cols: number;
  rows: number;
  buffer: { active: { type: string } };
  selection: string;
  pasted: string[];
  refreshes: Array<[number, number]>;
  resize(cols: number, rows: number): void;
  keyHandler: ((event: KeyboardEvent) => boolean) | null;
};

type MockFitAddon = {
  fit: ReturnType<typeof vi.fn>;
  proposeDimensions: () => { cols: number; rows: number } | undefined;
};

// Shared FitAddon mocks so tests can prime `proposeDimensions` BEFORE a slot
// is created (each instance references the same function). The `fit` mock
// mirrors the real addon: it reads proposeDimensions() and resizes the bound
// terminal when the dims differ. This lets tests catch the redundant
// double-resize that occurred when proposeSlotDimensions skipped the
// scrollbar subtraction that fit() performs internally.
const fitMocks = vi.hoisted(() => {
  const proposeDimensions = vi.fn(
    () => undefined as { cols: number; rows: number } | undefined,
  );
  const fit = vi.fn(function (this: { _term: MockTerminal | null }) {
    const term = this._term;
    if (!term) return;
    const dims = proposeDimensions();
    if (!dims) return;
    if (term.cols !== dims.cols || term.rows !== dims.rows) {
      term.resize(dims.cols, dims.rows);
    }
  });
  return { proposeDimensions, fit };
});
vi.mock("@/lib/fonts", () => ({
  detectMonoFontFamily: () => "JetBrains Mono",
}));

vi.mock("@/modules/settings/preferencesSnapshot", () => ({
  readPreferencesSnapshot: () => ({
    terminalFontFamily: "JetBrains Mono",
    terminalLetterSpacing: 0,
    terminalFontSize: 14,
    terminalScrollback: 1000,
    terminalWebglEnabled: false,
    zoomLevel: 1,
  }),
}));

vi.mock("@/styles/terminalTheme", () => ({
  buildTerminalTheme: () => ({}),
}));

vi.mock("@tauri-apps/plugin-opener", () => ({
  openUrl: vi.fn(async () => undefined),
}));

vi.mock("@/lib/clipboard", () => clipboardMocks);

vi.mock("@xterm/addon-fit", () => ({
  FitAddon: class {
    _term: MockTerminal | null = null;
    fit = fitMocks.fit;
    // Default to undefined so the renderer pool's helper falls back to the
    // current term cols/rows. Tests that need a specific proposal can call
    // `fitMocks.proposeDimensions.mockReturnValue(...)` before binding.
    proposeDimensions = fitMocks.proposeDimensions;
    activate(term: unknown) {
      this._term = term as MockTerminal;
    }
  },
}));

vi.mock("@xterm/addon-search", () => ({
  SearchAddon: class {
    findNext = vi.fn();
  },
}));

vi.mock("@xterm/addon-web-links", () => ({
  WebLinksAddon: class {
    constructor() {}
  },
}));
vi.mock("@xterm/addon-webgl", () => ({
  WebglAddon: class {
    onContextLoss = vi.fn();
    dispose = vi.fn();
  },
}));

vi.mock("@xterm/xterm", () => ({
  Terminal: class {
    cols = 80;
    rows = 24;
    options: Record<string, unknown>;
    element: HTMLElement | null = null;
    buffer = { active: { type: "normal" } };
    selection = "";
    pasted: string[] = [];
    refreshes: Array<[number, number]> = [];
    keyHandler: ((event: KeyboardEvent) => boolean) | null = null;
    private dataHandler: ((data: string) => void) | null = null;
    _core = {
      _renderService: {
        dimensions: {
          css: { cell: { width: 8, height: 16 } },
        },
      },
    };

    constructor(options: Record<string, unknown>) {
      this.options = { ...options };
      terminalInstances.push(this);
    }

    loadAddon(addon: unknown) {
      // The real xterm calls addon.activate(term) during loadAddon so the
      // FitAddon can reach the terminal. Mirror that here so the realistic
      // fit() mock can resize the bound term.
      const a = addon as { activate?: (term: unknown) => void };
      if (typeof a.activate === "function") a.activate(this);
    }
    open() {}
    clear() {}
    reset() {}
    focus() {}
    resize(cols: number, rows: number) {
      this.cols = cols;
      this.rows = rows;
    }
    refresh(start: number, end: number) {
      this.refreshes.push([start, end]);
    }
    write(_data: string | Uint8Array, callback?: () => void) {
      callback?.();
    }
    attachCustomKeyEventHandler(handler: (event: KeyboardEvent) => boolean) {
      this.keyHandler = handler;
    }
    onData(handler: (data: string) => void) {
      this.dataHandler = handler;
      return { dispose: vi.fn() };
    }
    getSelection() {
      return this.selection;
    }
    paste(data: string) {
      this.pasted.push(data);
      this.dataHandler?.(data);
    }
  },
}));

function installBrowserMocks() {
  resizeObserverMocks.length = 0;
  Object.defineProperty(globalThis, "ResizeObserver", {
    configurable: true,
    value: class {
      callback: ResizeObserverCallback;
      observe = vi.fn();
      unobserve = vi.fn();
      disconnect = vi.fn();
      constructor(callback: ResizeObserverCallback) {
        this.callback = callback;
        resizeObserverMocks.push(this);
      }
    },
  });
  Object.defineProperty(window, "requestAnimationFrame", {
    configurable: true,
    value: (callback: FrameRequestCallback) => {
      callback(0);
      return 0;
    },
  });
  Object.defineProperty(window, "cancelAnimationFrame", {
    configurable: true,
    value: vi.fn(),
  });
}

async function mountBoundTerminal() {
  const rendererPool = await import("./rendererPool");
  const writes: string[] = [];
  const resizes: Array<[number, number]> = [];
  const kicks: Array<[number, number]> = [];
  rendererPool.configureRendererPool({
    resolveLeaf: (leafId) =>
      leafId === 7
        ? {
            writeToPty: (data) => writes.push(data),
            resizePty: (cols, rows) => resizes.push([cols, rows]),
            kickPty: (cols, rows) => kicks.push([cols, rows]),
          }
        : null,
    evictLeaf: vi.fn(),
    isLeafFocused: () => true,
  });

  const container = document.createElement("div");
  setElementSize(container, 800, 400);
  document.body.appendChild(container);
  const slot = rendererPool.acquireSlot({
    leafId: 7,
    container,
    snapshot: null,
    altScreen: false,
    shellExited: false,
    searchQuery: null,
    cols: 80,
    rows: 24,
    registerOsc: () => [],
    onSearchReady: vi.fn(),
  });

  const term = terminalInstances[0];
  if (!term?.keyHandler) throw new Error("terminal key handler was not attached");
  return {
    rendererPool,
    container,
    slot,
    term,
    writes,
    resizes,
    kicks,
    fitAddon: slot.fitAddon as unknown as MockFitAddon,
  };
}

function setElementSize(el: HTMLElement, width: number, height: number): void {
  Object.defineProperty(el, "clientWidth", {
    configurable: true,
    value: width,
  });
  Object.defineProperty(el, "clientHeight", {
    configurable: true,
    value: height,
  });
}

function terminalKey(
  key: string,
  overrides: Partial<KeyboardEventInit> = {},
): KeyboardEvent {
  return new KeyboardEvent("keydown", {
    key,
    ctrlKey: true,
    shiftKey: true,
    bubbles: true,
    cancelable: true,
    ...overrides,
  });
}

describe("rendererPool terminal clipboard shortcuts", () => {
  beforeEach(() => {
    vi.resetModules();
    terminalInstances.length = 0;
    clipboardMocks.readClipboardText.mockReset();
    clipboardMocks.writeClipboardText.mockReset();
    // Shared FitAddon mocks must be reset between tests so a return value
    // primed in one test does not leak into the next. fit keeps its
    // implementation (only call history is cleared) while proposeDimensions
    // is fully reset to its default `undefined` return.
    fitMocks.proposeDimensions.mockReset();
    fitMocks.proposeDimensions.mockReturnValue(undefined);
    fitMocks.fit.mockClear();
    document.body.innerHTML = "";
    installBrowserMocks();
  });
  it("copies the terminal selection with Ctrl+Shift+C without writing to the PTY", async () => {
    clipboardMocks.writeClipboardText.mockResolvedValue(undefined);
    const { term, writes } = await mountBoundTerminal();
    term.selection = "selected text";

    const event = terminalKey("C");
    const result = term.keyHandler!(event);

    expect(result).toBe(false);
    expect(event.defaultPrevented).toBe(true);
    await vi.waitFor(() => {
      expect(clipboardMocks.writeClipboardText).toHaveBeenCalledWith(
        "selected text",
      );
    });
    expect(writes).toEqual([]);
  });

  it("pastes clipboard text with Ctrl+Shift+V through xterm paste handling", async () => {
    clipboardMocks.readClipboardText.mockResolvedValue("pwd\n");
    const { term, writes } = await mountBoundTerminal();

    const event = terminalKey("V");
    const result = term.keyHandler!(event);

    expect(result).toBe(false);
    expect(event.defaultPrevented).toBe(true);
    await vi.waitFor(() => {
      expect(term.pasted).toEqual(["pwd\n"]);
    });
    expect(writes).toEqual(["pwd\n"]);
  });

  it("keeps Ctrl+C available for the shell interrupt signal", async () => {
    clipboardMocks.readClipboardText.mockResolvedValue("ignored");
    const { term } = await mountBoundTerminal();

    const event = terminalKey("c", { shiftKey: false });
    const result = term.keyHandler!(event);

    expect(result).toBe(true);
    expect(event.defaultPrevented).toBe(false);
    expect(clipboardMocks.writeClipboardText).not.toHaveBeenCalled();
    expect(clipboardMocks.readClipboardText).not.toHaveBeenCalled();
  });

  it("does not paste when the clipboard adapter returns empty text", async () => {
    clipboardMocks.readClipboardText.mockResolvedValue("");
    const { term } = await mountBoundTerminal();

    const event = terminalKey("V");
    expect(() => term.keyHandler!(event)).not.toThrow();

    expect(event.defaultPrevented).toBe(true);
    await vi.waitFor(() => {
      expect(clipboardMocks.readClipboardText).toHaveBeenCalledTimes(1);
    });
    expect(term.pasted).toEqual([]);
  });

  it("keeps the renderer bound when the same leaf is acquired again", async () => {
    const { rendererPool, container, term, resizes } = await mountBoundTerminal();
    term.resize(100, 30);

    const slot = rendererPool.acquireSlot({
      leafId: 7,
      container,
      snapshot: "ignored snapshot",
      altScreen: false,
      shellExited: false,
      searchQuery: null,
      cols: 100,
      rows: 30,
      registerOsc: () => [],
      onSearchReady: vi.fn(),
    });

    expect(slot.term).toBe(term);
    expect(terminalInstances).toHaveLength(1);
    expect(lastItem(term.refreshes)).toEqual([0, 29]);
    expect(lastItem(resizes)).toEqual([100, 30]);
  });

  it("syncs PTY size on the next animation frame when the proposed dims change", async () => {
    const { container, term, resizes, fitAddon } = await mountBoundTerminal();
    term.resize(120, 32);
    setElementSize(container, 960, 480);
    // proposeDimensions() drives the slot's resize decisions. Simulate the
    // FitAddon reading the new 960x480 container and proposing larger dims.
    (
      fitAddon.proposeDimensions as unknown as ReturnType<typeof vi.fn>
    ).mockReturnValue({ cols: 140, rows: 36 });

    const observer = lastItem(resizeObserverMocks)!;
    observer.callback([], observer as unknown as ResizeObserver);

    // The slot must adopt fitAddon's proposal with the scrollbar allowance
    // refunded: FitAddon subtracts 14px (≈1 col at cellWidth=8), but our
    // CSS hides the xterm scrollbar (globals.css .xterm .scrollbar), so we
    // add it back. Without this compensation the PTY reports 1 fewer col
    // than the canvas grid, leaving a right-side gap that visually pushes
    // TUI renderings toward the left edge of the pane.
    expect(lastItem(resizes)).toEqual([141, 36]);
    expect(term.cols).toBe(141);
    expect(term.rows).toBe(36);
    expect(lastItem(term.refreshes)).toEqual([0, 35]);
  });

  it("ignores zero-sized resize observations", async () => {
    const { container, term, resizes } = await mountBoundTerminal();
    const count = resizes.length;
    term.resize(10, 5);
    setElementSize(container, 0, 0);

    const observer = lastItem(resizeObserverMocks)!;
    observer.callback([], observer as unknown as ResizeObserver);

    expect(resizes).toHaveLength(count);
  });

  it("kicks alt-screen terminals after layout recovery", async () => {
    const { rendererPool, term, kicks } = await mountBoundTerminal();
    term.buffer.active.type = "alternate";

    rendererPool.refreshSlotLayout(7, {
      forcePty: true,
      kickPty: true,
    });

    expect(lastItem(kicks)).toEqual([term.cols, term.rows]);
  });

  it("defers applyFontSize layout recovery to the next animation frame", async () => {
    // Replace the synchronous RAF mock with a queue so we can observe the
    // gap between the option write and the layout recovery.
    const rafQueue: FrameRequestCallback[] = [];
    Object.defineProperty(window, "requestAnimationFrame", {
      configurable: true,
      value: (cb: FrameRequestCallback) => {
        rafQueue.push(cb);
        return rafQueue.length;
      },
    });
    Object.defineProperty(window, "cancelAnimationFrame", {
      configurable: true,
      value: (id: number) => {
        rafQueue[id - 1] = undefined as unknown as FrameRequestCallback;
      },
    });
    const { fitAddon } = await mountBoundTerminal();
    // mountBoundTerminal also queues its own double-RAF unhide, so we
    // measure the queue size delta rather than the absolute count.
    const initialQueueDepth = rafQueue.length;
    const initialProposeCount = (
      fitAddon.proposeDimensions as unknown as ReturnType<typeof vi.fn>
    ).mock.calls.length;

    // The fontSize change must schedule a RAF rather than running
    // proposeDimensions synchronously, otherwise xterm's css.cell.width is
    // still the previous frame's value and the resulting cols/rows are
    // stale.
    const rendererPool = await import("./rendererPool");
    rendererPool.applyFontSize(20);

    expect(
      (fitAddon.proposeDimensions as unknown as ReturnType<typeof vi.fn>).mock
        .calls.length,
    ).toBe(initialProposeCount);
    expect(rafQueue).toHaveLength(initialQueueDepth + 1);

    // Once the frame fires, the deferred recoverSlotLayout runs and reads
    // fitAddon.proposeDimensions() to recompute layout. (Previously this
    // asserted on fit() being called; that is no longer the case now that
    // the redundant safeFit has been removed.)
    rafQueue[initialQueueDepth](0);
    expect(
      (fitAddon.proposeDimensions as unknown as ReturnType<typeof vi.fn>).mock
        .calls.length,
    ).toBeGreaterThan(initialProposeCount);
  });

  it("invokes writeSnapshot with the live container dims during bindSlot", async () => {
    const rendererPool = await import("./rendererPool");
    const writes: string[] = [];
    const resizes: Array<[number, number]> = [];
    rendererPool.configureRendererPool({
      resolveLeaf: (leafId) =>
        leafId === 11
          ? {
              writeToPty: (data) => writes.push(data),
              resizePty: (cols, rows) => resizes.push([cols, rows]),
              kickPty: () => {},
            }
          : null,
      evictLeaf: vi.fn(),
      isLeafFocused: () => true,
    });

    const container = document.createElement("div");
    setElementSize(container, 800, 400);
    document.body.appendChild(container);

    // First bind establishes the "saved" model dims.
    rendererPool.acquireSlot({
      leafId: 11,
      container,
      snapshot: null,
      altScreen: false,
      shellExited: false,
      searchQuery: null,
      cols: 80,
      rows: 24,
      registerOsc: () => [],
      onSearchReady: vi.fn(),
      writeSnapshot: (term, cols, rows) => {
        // The slot is expected to be at the proposed live dims here, which
        // (under the mock) fall back to the current term dims. The contract
        // is that writeSnapshot is called exactly once and sees the slot's
        // post-fit terminal dims.
        expect(term.cols).toBeGreaterThan(0);
        expect(term.rows).toBeGreaterThan(0);
        expect([cols, rows]).toEqual([term.cols, term.rows]);
      },
    });
  });

  it("resizes the terminal at most once per layout recovery (no redundant fit)", async () => {
    const { container, term, fitAddon } = await mountBoundTerminal();
    term.resize(120, 32);
    setElementSize(container, 960, 480);
    (
      fitAddon.proposeDimensions as unknown as ReturnType<typeof vi.fn>
    ).mockReturnValue({ cols: 140, rows: 36 });

    const resizeSpy = vi.spyOn(term, "resize");
    const fitSpy = fitAddon.fit as unknown as ReturnType<typeof vi.fn>;
    const initialFitCount = fitSpy.mock.calls.length;

    const observer = lastItem(resizeObserverMocks)!;
    observer.callback([], observer as unknown as ResizeObserver);

    // Only one resize (120,32 → 141,36). The scrollbar allowance is refunded
    // by proposeSlotDimensions (FitAddon subtracts 14px ≈ 1 col) so the
    // canvas grid and the PTY size stay aligned. The old code did a second
    // resize inside safeFit() because proposeSlotDimensions recomputed cols
    // without the scrollbar subtraction fit() performs — fit() then saw a
    // mismatch and resized again. That double-resize reflowed alt-screen
    // snapshots and corrupted TUI layouts (vim, less) after tab switches.
    const resizeCalls = resizeSpy.mock.calls.map(
      ([c, r]) => [c, r] as [number, number],
    );
    expect(resizeCalls).toEqual([[141, 36]]);
    // fit() is no longer invoked during layout recovery — proposeDimensions()
    // alone drives the resize, and term.resize() applies it directly.
    expect(fitSpy.mock.calls.length).toBe(initialFitCount);
  });

  it("writeSnapshot cols match the final slot cols after bind (alt-screen tab re-bind regression)", async () => {
    const rendererPool = await import("./rendererPool");
    const resizes: Array<[number, number]> = [];
    rendererPool.configureRendererPool({
      resolveLeaf: (leafId) =>
        leafId === 42
          ? {
              writeToPty: () => {},
              resizePty: (cols, rows) => resizes.push([cols, rows]),
              kickPty: () => {},
            }
          : null,
      evictLeaf: vi.fn(),
      isLeafFocused: () => true,
    });

    // Simulate fit's scrollbar-aware proposal: container 800px, cellWidth 8,
    // fit subtracts ~14px scrollbar → 98 cols. proposeSlotDimensions refunds
    // that allowance (CSS hides the xterm scrollbar), so the slot ends up at
    // 98 + floor(14/8) = 99 cols. The OLD code recomputed cols as
    // floor(800/8)=100, then safeFit() internally resized the slot back to
    // 98 — AFTER the snapshot was already serialized at 100 cols. Writing
    // the 100-col snapshot into a 98-col terminal reflowed alt-screen
    // content and corrupted TUI layouts.
    fitMocks.proposeDimensions.mockReturnValue({ cols: 98, rows: 25 });

    const container = document.createElement("div");
    setElementSize(container, 800, 400);
    document.body.appendChild(container);

    let snapshotCols = -1;
    let snapshotRows = -1;
    const slot = rendererPool.acquireSlot({
      leafId: 42,
      container,
      snapshot: null,
      altScreen: true,
      shellExited: false,
      searchQuery: null,
      cols: 80,
      rows: 24,
      registerOsc: () => [],
      onSearchReady: vi.fn(),
      writeSnapshot: (_term, cols, rows) => {
        snapshotCols = cols;
        snapshotRows = rows;
      },
    });

    // Bug 1 invariant: the cols used to serialize the model snapshot must
    // equal the cols the slot settles on. A mismatch means the alt-screen
    // snapshot gets reflowed when written back, shifting vim/less layouts.
    expect(snapshotCols).toBe(slot.term.cols);
    expect(snapshotRows).toBe(slot.term.rows);
    expect(lastItem(resizes)?.[0]).toBe(slot.term.cols);
    // Sanity: with cellWidth=8 the 14px scrollbar refund is exactly 1 col.
    expect(slot.term.cols).toBe(99);
  });

  it("refunds the FitAddon scrollbar deduction so PTY cols match the canvas grid", async () => {
    // FitAddon hardcodes a 14px scrollbar allowance (see @xterm/addon-fit
    // v0.11.0 proposeDimensions). globals.css hides the xterm scrollbar
    // with display:none, so the 14px is wasted. proposeSlotDimensions
    // compensates by adding floor(14/cellW) back to the proposed cols.
    // With cellW=8 that is exactly 1 col.
    const { term, fitAddon, container } = await mountBoundTerminal();
    term.resize(80, 24);
    // Resize the container so the ResizeObserver actually fires.
    setElementSize(container, 1024, 600);
    // prime FitAddon to propose 100x25
    (
      fitAddon.proposeDimensions as unknown as ReturnType<typeof vi.fn>
    ).mockReturnValue({ cols: 100, rows: 25 });

    const observer = lastItem(resizeObserverMocks)!;
    observer.callback([], observer as unknown as ResizeObserver);

    // term.resize must have settled at FitAddon cols + the scrollbar refund
    // (100 + floor(14/8) = 101). Without the refund the slot would land at
    // 100 cols and the PTY would receive a smaller grid than the canvas can
    // render, leaving the TUI visually offset to the left of the pane.
    expect(term.cols).toBe(101);
    expect(term.rows).toBe(25);
  });

  it("kicks the PTY for inline (non-alt-screen) TUIs when cols actually move", async () => {
    // OpenCode / Claude Code are Ink-based inline TUIs — they never enter
    // alt-screen, so the legacy kickPty: options.kickPty condition never
    // fired for them. When a pane resizes, syncPtySize emits TIOCSWINSZ but
    // Linux suppresses winsize ioctls that don't actually change the size,
    // and inline TUIs that listen for SIGWINCH through useWindowSize() can
    // stay pinned to the previous cols. recoverSlotLayout now also kicks
    // when sizeChanged is true, so inline TUIs get a guaranteed SIGWINCH.
    const { term, fitAddon, container, kicks } = await mountBoundTerminal();
    // Move the terminal to a known state different from the createSlot
    // initial — slot.lastCols starts at term.cols (80), so we need term.cols
    // to differ from it for sizeChanged to fire later.
    term.resize(100, 24);
    // Resize the container so the ResizeObserver actually fires.
    setElementSize(container, 1024, 600);
    const initialKickCount = kicks.length;

    // Simulate FitAddon proposing larger dims (e.g. pane grew wider).
    (
      fitAddon.proposeDimensions as unknown as ReturnType<typeof vi.fn>
    ).mockReturnValue({ cols: 130, rows: 30 });

    const observer = lastItem(resizeObserverMocks)!;
    observer.callback([], observer as unknown as ResizeObserver);

    // term.resize must have settled at FitAddon cols + the scrollbar refund
    // (130 + 1 = 131) and a kick must have been recorded.
    expect(term.cols).toBe(131);
    expect(term.rows).toBe(30);
    expect(kicks.length).toBeGreaterThan(initialKickCount);
    expect(lastItem(kicks)).toEqual([131, 30]);
  });

  it("does not kick the PTY when cols/rows are stable and no kick is requested", async () => {
    // The new sizeChanged-based kick path must not fire on every layout
    // recovery. Only an actual grid move should trigger the kick, so
    // stable-size refreshes stay quiet and don't spam the PTY.
    const { rendererPool, term, container, kicks } = await mountBoundTerminal();
    term.resize(120, 30);
    // First refresh pins lastCols/lastRows to the terminal's current grid
    // and may itself emit a kick (sizeChanged was true before this call).
    rendererPool.refreshSlotLayout(7, { forcePty: true });
    const baselineKickCount = kicks.length;

    // Now refresh without any resize occurring — the terminal is already
    // settled at the same cols/rows, and the caller does NOT request a
    // kick. sizeChanged will be false so the new sizeChanged-based branch
    // must stay silent.
    setElementSize(container, 800, 480);
    rendererPool.refreshSlotLayout(7, { forcePty: false, kickPty: false });

    // No new kick: cols/rows are stable and kickPty is not requested.
    expect(kicks.length).toBe(baselineKickCount);
  });
});

function lastItem<T>(items: T[]): T | undefined {
  return items[items.length - 1];
}