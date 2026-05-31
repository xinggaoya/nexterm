import { detectMonoFontFamily } from "@/lib/fonts";
import { readClipboardText, writeClipboardText } from "@/lib/clipboard";
import { readPreferencesSnapshot } from "@/modules/settings/preferencesSnapshot";
import { buildTerminalTheme } from "@/styles/terminalTheme";
import { openUrl } from "@tauri-apps/plugin-opener";
import { FitAddon } from "@xterm/addon-fit";
import { SearchAddon } from "@xterm/addon-search";
import { WebLinksAddon } from "@xterm/addon-web-links";
import { WebglAddon } from "@xterm/addon-webgl";
import { Terminal } from "@xterm/xterm";
import { terminalWordNavigationSequence } from "./keymap";

export const POOL_MAX_SIZE = 5;

export type SlotAdapter = {
  resolveLeaf(leafId: number): LeafBridge | null;
  evictLeaf(leafId: number): void;
  isLeafFocused(leafId: number): boolean;
};

export type LeafBridge = {
  writeToPty(data: string): void;
  resizePty(cols: number, rows: number): void;
  // Force a SIGWINCH on the underlying PTY at the given dims. Implemented
  // as a +1 row / restore bump because the Linux kernel suppresses winsize
  // ioctls that don't actually change the size. Used to make alt-screen
  // TUIs repaint from scratch after they were dormant.
  kickPty(cols: number, rows: number): void;
};

export type Slot = {
  readonly id: number;
  readonly term: Terminal;
  readonly fitAddon: FitAddon;
  readonly searchAddon: SearchAddon;
  readonly host: HTMLDivElement;
  container: HTMLDivElement | null;
  webglAddon: WebglAddon | null;
  webglCanvases: HTMLCanvasElement[];
  currentLeafId: number | null;
  oscDisposers: (() => void)[];
  observer: ResizeObserver | null;
  fitRaf: number | null;
  unhideRaf: number | null;
  lastCols: number;
  lastRows: number;
  lastW: number;
  lastH: number;
  lastUsedAt: number;
};

const slots: Slot[] = [];
let recyclerEl: HTMLDivElement | null = null;
let adapter: SlotAdapter | null = null;

export function configureRendererPool(a: SlotAdapter): void {
  adapter = a;
}

export function forEachSlot(fn: (slot: Slot) => void): void {
  for (const s of slots) fn(s);
}

export function poolSize(): number {
  return slots.length;
}

function getRecycler(): HTMLDivElement {
  if (recyclerEl && recyclerEl.isConnected) return recyclerEl;
  const el = document.createElement("div");
  el.setAttribute("data-nexterm-recycler", "");
  el.style.cssText =
    "position:fixed;left:-99999px;top:-99999px;width:1024px;height:768px;overflow:hidden;pointer-events:none;contain:strict;";
  document.body.appendChild(el);
  recyclerEl = el;
  return el;
}

export function createTerminalOptions() {
  const prefs = readPreferencesSnapshot();
  return {
    fontFamily: prefs.terminalFontFamily || detectMonoFontFamily(),
    letterSpacing: prefs.terminalLetterSpacing,
    fontSize: Math.max(4, Math.round(prefs.terminalFontSize * prefs.zoomLevel)),
    theme: buildTerminalTheme(),
    cursorBlink: false,
    cursorStyle: "bar" as const,
    cursorInactiveStyle: "outline" as const,
    scrollback: prefs.terminalScrollback,
    smoothScrollDuration: 125,
    scrollSensitivity: 1,
    fastScrollSensitivity: 5,
    allowProposedApi: true,
  };
}

function createSlot(): Slot {
  const term = new Terminal(createTerminalOptions());
  const fitAddon = new FitAddon();
  const searchAddon = new SearchAddon();
  term.loadAddon(fitAddon);
  term.loadAddon(searchAddon);
  term.loadAddon(
    new WebLinksAddon((_e, uri) => openUrl(uri).catch(console.error)),
  );

  const host = document.createElement("div");
  host.style.cssText = "width:100%;height:100%;";
  host.setAttribute("data-nexterm-slot", String(slots.length));
  getRecycler().appendChild(host);
  term.open(host);

  const slot: Slot = {
    id: slots.length,
    term,
    fitAddon,
    searchAddon,
    host,
    container: null,
    webglAddon: null,
    webglCanvases: [],
    currentLeafId: null,
    oscDisposers: [],
    observer: null,
    fitRaf: null,
    unhideRaf: null,
    lastCols: term.cols,
    lastRows: term.rows,
    lastW: 0,
    lastH: 0,
    lastUsedAt: 0,
  };

  attachWebgl(slot);

  term.attachCustomKeyEventHandler((event) => {
    const leafId = slot.currentLeafId;
    if (leafId === null) return false;
    const bridge = adapter?.resolveLeaf(leafId);
    if (!bridge) return true;
    if (isTerminalCopyShortcut(event)) {
      event.preventDefault();
      if (event.type === "keydown") void copyTerminalSelection(slot.term);
      return false;
    }
    if (isTerminalPasteShortcut(event)) {
      event.preventDefault();
      if (event.type === "keydown") void pasteClipboardIntoTerminal(slot.term);
      return false;
    }
    const wordNavigation = terminalWordNavigationSequence(event);
    if (wordNavigation) {
      event.preventDefault();
      if (event.type === "keydown") bridge.writeToPty(wordNavigation);
      return false;
    }
    if (isCtrlBackspace(event)) {
      event.preventDefault();
      if (event.type === "keydown") bridge.writeToPty("\x17");
      return false;
    }
    if (isShiftEnter(event)) {
      event.preventDefault();
      if (event.type === "keydown") bridge.writeToPty("\x1b\r");
      return false;
    }
    return true;
  });

  term.onData((data) => {
    const leafId = slot.currentLeafId;
    if (leafId === null) return;
    adapter?.resolveLeaf(leafId)?.writeToPty(data);
  });

  slots.push(slot);
  return slot;
}

type PickResult = { slot: Slot; previousLeafId: number | null };

function isAltScreen(s: Slot): boolean {
  try {
    return s.term.buffer.active.type === "alternate";
  } catch {
    return false;
  }
}

function pickSlotFor(leafId: number): PickResult {
  const free = slots.find((s) => s.currentLeafId === null);
  if (free) return { slot: free, previousLeafId: null };
  if (slots.length < POOL_MAX_SIZE)
    return { slot: createSlot(), previousLeafId: null };

  let best: Slot | null = null;
  let bestScore = Number.POSITIVE_INFINITY;
  for (const s of slots) {
    if (s.currentLeafId === leafId) return { slot: s, previousLeafId: null };
    const focused =
      s.currentLeafId !== null &&
      (adapter?.isLeafFocused(s.currentLeafId) ?? false);
    const score =
      (isAltScreen(s) ? 100 : 0) + (focused ? 10 : 0) + s.lastUsedAt / 1e12;
    if (score < bestScore) {
      bestScore = score;
      best = s;
    }
  }
  const chosen = best!;
  return { slot: chosen, previousLeafId: chosen.currentLeafId };
}

export type AcquireParams = {
  leafId: number;
  container: HTMLDivElement;
  snapshot: string | null;
  // True if the model is in alt-screen mode (TUI like vim, htop, dofek).
  // The view is rebuilt from the model snapshot and then nudged with SIGWINCH
  // so TUIs can repaint any volatile screen state.
  altScreen: boolean;
  shellExited: boolean;
  searchQuery: string | null;
  cols: number;
  rows: number;
  registerOsc: (term: Terminal) => (() => void)[];
  onSearchReady: (addon: SearchAddon) => void;
};

export function acquireSlot(params: AcquireParams): Slot {
  const existing = slots.find((s) => s.currentLeafId === params.leafId);
  if (existing) {
    rewireSlot(existing, params);
    return existing;
  }

  const pick = pickSlotFor(params.leafId);
  if (pick.previousLeafId !== null) {
    adapter?.evictLeaf(pick.previousLeafId);
  }
  if (
    pick.slot.currentLeafId !== null &&
    pick.slot.currentLeafId !== params.leafId
  ) {
    detachSlotFromLeaf(pick.slot);
  }
  bindSlot(pick.slot, params);
  return pick.slot;
}

function bindSlot(slot: Slot, p: AcquireParams): void {
  slot.currentLeafId = p.leafId;
  slot.container = p.container;
  slot.lastUsedAt = performance.now();

  cancelPendingUnhide(slot);
  slot.host.style.visibility = "hidden";

  if (slot.host.parentNode !== p.container) {
    p.container.appendChild(slot.host);
  }

  slot.term.options.disableStdin = p.shellExited;
  slot.term.clear();
  slot.term.reset();

  if (
    p.cols > 0 &&
    p.rows > 0 &&
    (slot.term.cols !== p.cols || slot.term.rows !== p.rows)
  ) {
    slot.term.resize(p.cols, p.rows);
  }

  if (p.snapshot) {
    try {
      slot.term.write(p.snapshot);
    } catch (e) {
      console.warn("[nexterm] snapshot replay failed:", e);
    }
  }
  try {
    slot.term.write("\x1b[?25h");
  } catch {}

  for (const d of slot.oscDisposers) {
    try {
      d();
    } catch {}
  }
  slot.oscDisposers = p.registerOsc(slot.term);

  setupResizeObserver(slot, p);
  recoverSlotLayout(slot, p.leafId, {
    forcePty: true,
    kickPty: p.altScreen && !p.shellExited,
    focus: adapter?.isLeafFocused(p.leafId) ?? false,
  });

  if (p.searchQuery) {
    try {
      slot.searchAddon.findNext(p.searchQuery);
    } catch {}
  }

  applyCursorBlinkOnSlot(slot, adapter?.isLeafFocused(p.leafId) ?? false);

  scheduleUnhide(slot);

  p.onSearchReady(slot.searchAddon);
}

function scheduleUnhide(slot: Slot): void {
  slot.unhideRaf = requestAnimationFrame(() => {
    slot.unhideRaf = requestAnimationFrame(() => {
      slot.unhideRaf = null;
      slot.host.style.visibility = "";
      const leafId = slot.currentLeafId;
      if (leafId !== null && adapter?.isLeafFocused(leafId)) {
        slot.term.focus();
      }
    });
  });
}

function cancelPendingUnhide(slot: Slot): void {
  if (slot.unhideRaf !== null) {
    cancelAnimationFrame(slot.unhideRaf);
    slot.unhideRaf = null;
  }
}

function rewireSlot(slot: Slot, p: AcquireParams): void {
  slot.lastUsedAt = performance.now();
  slot.container = p.container;
  if (slot.host.parentNode !== p.container) {
    p.container.appendChild(slot.host);
  }
  setupResizeObserver(slot, p);
  recoverSlotLayout(slot, p.leafId, {
    forcePty: true,
    kickPty: p.altScreen && !p.shellExited,
    focus: adapter?.isLeafFocused(p.leafId) ?? false,
  });
  p.onSearchReady(slot.searchAddon);
}

function setupResizeObserver(slot: Slot, p: AcquireParams): void {
  slot.observer?.disconnect();
  cancelPendingFit(slot);

  const container = p.container;

  slot.observer = new ResizeObserver(() => {
    scheduleFit(slot, p.leafId, () => {
      if (slot.currentLeafId !== p.leafId) return;
      const w = container.clientWidth;
      const h = container.clientHeight;
      if (!isUsableLayout(w, h)) return;
      if (w === slot.lastW && h === slot.lastH) return;
      recoverSlotLayout(slot, p.leafId);
    });
  });
  slot.observer.observe(container);
}

function scheduleFit(slot: Slot, leafId: number, fn?: () => void): void {
  if (slot.fitRaf !== null) return;
  slot.fitRaf = requestAnimationFrame(() => {
    slot.fitRaf = null;
    if (fn) fn();
    else recoverSlotLayout(slot, leafId);
  });
}

function cancelPendingFit(slot: Slot): void {
  if (slot.fitRaf !== null) {
    cancelAnimationFrame(slot.fitRaf);
    slot.fitRaf = null;
  }
}

type RecoverLayoutOptions = {
  forcePty?: boolean;
  kickPty?: boolean;
  focus?: boolean;
};

export function refreshSlotLayout(
  leafId: number,
  options: RecoverLayoutOptions = {},
): boolean {
  const slot = slots.find((s) => s.currentLeafId === leafId);
  if (!slot) return false;
  return recoverSlotLayout(slot, leafId, options);
}

function recoverSlotLayout(
  slot: Slot,
  leafId: number,
  options: RecoverLayoutOptions = {},
): boolean {
  if (slot.currentLeafId !== leafId) return false;
  const container = slot.container;
  if (!container) return false;
  const w = container.clientWidth;
  const h = container.clientHeight;
  if (!isUsableLayout(w, h)) return false;
  slot.lastW = w;
  slot.lastH = h;
  safeFit(slot);
  const resized = syncPtySize(slot, leafId, options.forcePty ?? false);
  // Only force a full repaint when the terminal dimensions actually changed.
  // xterm handles repaint internally after fit() when dimensions are stable.
  if (resized) refreshTerminal(slot);

  const bridge = adapter?.resolveLeaf(leafId);
  if (options.kickPty && bridge && slot.term.cols > 0 && slot.term.rows > 0) {
    bridge.kickPty(slot.term.cols, slot.term.rows);
  }
  if (options.focus) slot.term.focus();
  return resized;
}

function safeFit(slot: Slot): void {
  try {
    slot.fitAddon.fit();
  } catch (e) {
    console.warn("[nexterm] terminal fit failed:", e);
  }
}

function syncPtySize(slot: Slot, leafId: number, force: boolean): boolean {
  const cols = slot.term.cols;
  const rows = slot.term.rows;
  if (cols <= 0 || rows <= 0) return false;
  if (!force && cols === slot.lastCols && rows === slot.lastRows) return false;
  slot.lastCols = cols;
  slot.lastRows = rows;
  adapter?.resolveLeaf(leafId)?.resizePty(cols, rows);
  return true;
}

function refreshTerminal(slot: Slot): void {
  if (slot.term.rows <= 0) return;
  try {
    slot.term.refresh(0, slot.term.rows - 1);
  } catch (e) {
    console.warn("[nexterm] terminal refresh failed:", e);
  }
}

function isUsableLayout(width: number, height: number): boolean {
  return width > 0 && height > 0;
}

export type SerializeOutput = {
  snapshot: string | null;
  cols: number;
  rows: number;
  altScreen: boolean;
};

export function releaseSlot(leafId: number): SerializeOutput | null {
  const slot = slots.find((s) => s.currentLeafId === leafId);
  if (!slot) return null;
  const out: SerializeOutput = {
    snapshot: null,
    cols: slot.term.cols,
    rows: slot.term.rows,
    altScreen: isAltScreen(slot),
  };
  detachSlotFromLeaf(slot);
  return out;
}

function detachSlotFromLeaf(slot: Slot): void {
  for (const d of slot.oscDisposers) {
    try {
      d();
    } catch {}
  }
  slot.oscDisposers = [];

  slot.observer?.disconnect();
  slot.observer = null;
  cancelPendingFit(slot);

  cancelPendingUnhide(slot);
  slot.host.style.visibility = "";

  if (slot.host.parentNode !== getRecycler()) {
    getRecycler().appendChild(slot.host);
  }

  slot.currentLeafId = null;
  slot.container = null;
  slot.lastUsedAt = performance.now();
}

const WEBGL_RECOVERY_DELAY_MS = 250;

function attachWebgl(slot: Slot): void {
  if (slot.webglAddon || !slot.term.element) return;
  if (!readPreferencesSnapshot().terminalWebglEnabled) return;
  const elem = slot.term.element;
  const before = new Set<HTMLCanvasElement>(
    elem.querySelectorAll<HTMLCanvasElement>("canvas"),
  );
  try {
    const webgl = new WebglAddon();
    webgl.onContextLoss(() => {
      const cur = slot.webglAddon;
      if (cur === webgl) {
        slot.webglAddon = null;
        slot.webglCanvases = [];
      }
      try {
        webgl.dispose();
      } catch {}
      // Recovery: WebKit may transiently lose contexts on sleep/wake or GPU
      // reset; without re-attach the slot would silently fall back to DOM
      // forever. Defer past WebKit's reset window before retrying.
      setTimeout(() => {
        if (slot.webglAddon) return;
        if (!readPreferencesSnapshot().terminalWebglEnabled) return;
        attachWebgl(slot);
      }, WEBGL_RECOVERY_DELAY_MS);
    });
    slot.term.loadAddon(webgl);
    const after = elem.querySelectorAll<HTMLCanvasElement>("canvas");
    const added: HTMLCanvasElement[] = [];
    for (const c of after) if (!before.has(c)) added.push(c);
    slot.webglAddon = webgl;
    slot.webglCanvases = added;
  } catch (e) {
    console.warn("[nexterm-webgl] unavailable:", e);
  }
}

function disposeSlotWebgl(slot: Slot): void {
  if (!slot.webglAddon) return;
  const addon = slot.webglAddon;
  for (const canvas of slot.webglCanvases) releaseCanvasContext(canvas);
  slot.webglCanvases = [];
  try {
    addon.dispose();
  } catch (e) {
    console.warn("[nexterm-webgl] dispose failed:", e);
  }
  try {
    const r = (
      addon as unknown as { _renderer?: Record<string, unknown> | null }
    )._renderer;
    if (r) {
      r._canvas = null;
      r._gl = null;
      r._charAtlas = null;
      r._atlas = null;
    }
    (
      addon as unknown as { _renderer?: unknown; _renderService?: unknown }
    )._renderer = null;
    (
      addon as unknown as { _renderer?: unknown; _renderService?: unknown }
    )._renderService = null;
  } catch {}
  slot.webglAddon = null;
}

function releaseCanvasContext(canvas: HTMLCanvasElement): void {
  let gl: WebGL2RenderingContext | WebGLRenderingContext | null = null;
  try {
    gl = canvas.getContext("webgl2") as WebGL2RenderingContext | null;
  } catch {}
  if (!gl) {
    try {
      gl = canvas.getContext("webgl") as WebGLRenderingContext | null;
    } catch {}
  }
  if (gl) {
    try {
      const ext = gl.getExtension("WEBGL_lose_context");
      if (ext && !gl.isContextLost()) ext.loseContext();
    } catch {}
  }
  try {
    canvas.width = 0;
    canvas.height = 0;
  } catch {}
}

export function applyWebglPreference(enabled: boolean): void {
  for (const slot of slots) {
    if (enabled && !slot.webglAddon) attachWebgl(slot);
    else if (!enabled && slot.webglAddon) disposeSlotWebgl(slot);
  }
}

export function applyFontSize(size: number): void {
  for (const slot of slots) {
    if (slot.term.options.fontSize === size) continue;
    slot.term.options.fontSize = size;
    if (slot.currentLeafId !== null) {
      recoverSlotLayout(slot, slot.currentLeafId, { forcePty: true });
    }
  }
}

export function applyLetterSpacing(spacing: number): void {
  for (const slot of slots) {
    if (slot.term.options.letterSpacing === spacing) continue;
    slot.term.options.letterSpacing = spacing;
    if (slot.currentLeafId !== null) recoverSlotLayout(slot, slot.currentLeafId);
  }
}

export function applyFontFamily(family: string): void {
  const resolved = family || detectMonoFontFamily();
  for (const slot of slots) {
    if (slot.term.options.fontFamily === resolved) continue;
    slot.term.options.fontFamily = resolved;
    if (slot.currentLeafId !== null) {
      recoverSlotLayout(slot, slot.currentLeafId, { forcePty: true });
    }
  }
}

export function applyScrollback(value: number): void {
  for (const slot of slots) {
    if (slot.term.options.scrollback === value) continue;
    slot.term.options.scrollback = value;
  }
}

export function applyTheme(): void {
  const theme = buildTerminalTheme();
  for (const slot of slots) {
    slot.term.options.theme = theme;
  }
}

export function focusSlot(leafId: number): void {
  const slot = slots.find((s) => s.currentLeafId === leafId);
  slot?.term.focus();
}

export function setSlotFocused(leafId: number, focused: boolean): void {
  const slot = slots.find((s) => s.currentLeafId === leafId);
  if (!slot) return;
  applyCursorBlinkOnSlot(slot, focused);
}

function applyCursorBlinkOnSlot(slot: Slot, focused: boolean): void {
  const desired = focused;
  if (slot.term.options.cursorBlink === desired) return;
  slot.term.options.cursorBlink = desired;
}

export function getSlotForLeaf(leafId: number): Slot | null {
  return slots.find((s) => s.currentLeafId === leafId) ?? null;
}

function isCtrlBackspace(e: KeyboardEvent): boolean {
  const ua = typeof navigator !== "undefined" ? navigator.userAgent : "";
  const isMac = /Mac|iPhone|iPad/.test(ua);
  const mod = isMac ? e.metaKey : e.ctrlKey;
  return mod && (e.key === "Backspace" || e.code === "Backspace");
}

function isShiftEnter(e: KeyboardEvent): boolean {
  return (
    e.key === "Enter" && e.shiftKey && !e.altKey && !e.ctrlKey && !e.metaKey
  );
}

function isTerminalCopyShortcut(e: KeyboardEvent): boolean {
  return isCtrlShiftKey(e, "c");
}

function isTerminalPasteShortcut(e: KeyboardEvent): boolean {
  return isCtrlShiftKey(e, "v");
}

function isCtrlShiftKey(e: KeyboardEvent, key: "c" | "v"): boolean {
  return (
    e.ctrlKey &&
    e.shiftKey &&
    !e.altKey &&
    !e.metaKey &&
    (e.key.toLowerCase() === key ||
      e.code.toLowerCase() === `key${key}`)
  );
}

async function copyTerminalSelection(term: Terminal): Promise<void> {
  const selection = term.getSelection();
  if (!selection) return;
  await writeClipboardText(selection);
}

async function pasteClipboardIntoTerminal(term: Terminal): Promise<void> {
  const text = await readClipboardText();
  if (text) term.paste(text);
}
