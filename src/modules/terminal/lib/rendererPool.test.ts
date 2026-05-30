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
    fit = vi.fn();
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

    constructor(options: Record<string, unknown>) {
      this.options = { ...options };
      terminalInstances.push(this);
    }

    loadAddon() {}
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
  return { rendererPool, container, slot, term, writes, resizes, kicks };
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

  it("syncs PTY size on the next animation frame when the container resizes", async () => {
    const { container, term, resizes } = await mountBoundTerminal();
    term.resize(120, 32);
    setElementSize(container, 960, 480);

    const observer = lastItem(resizeObserverMocks)!;
    observer.callback([], observer as unknown as ResizeObserver);

    expect(lastItem(resizes)).toEqual([120, 32]);
    expect(lastItem(term.refreshes)).toEqual([0, 31]);
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
});

function lastItem<T>(items: T[]): T | undefined {
  return items[items.length - 1];
}
