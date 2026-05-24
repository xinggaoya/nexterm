import { ensureMonoFontsLoaded } from "@/lib/fonts";
import { configureTerminalSessionDisposer } from "@/modules/tabs/terminalDisposal";
import { SerializeAddon } from "@xterm/addon-serialize";
import type { SearchAddon } from "@xterm/addon-search";
import { Terminal } from "@xterm/xterm";
import {
  createShellIntegrationState,
  registerCwdHandler,
  registerPromptTracker,
  registerTitleHandler,
} from "./osc-handlers";
import { openPty, type PtyOutputChunk, type PtySession } from "./pty-bridge";
import {
  acquireSlot,
  applyTheme as applyPoolTheme,
  createTerminalOptions,
  focusSlot,
  getSlotForLeaf,
  releaseSlot,
  setSlotFocused,
  configureRendererPool,
} from "./rendererPool";

export type TerminalSessionCallbacks = {
  onSearchReady?: (addon: SearchAddon) => void;
  onExit?: (code: number) => void;
  onCwd?: (cwd: string) => void;
  onTitle?: (title: string) => void;
};

type Session = {
  pty: PtySession | null;
  transcriptReader: PtySession | null;
  ptyOpening: boolean;
  initialCwd: string | undefined;
  lastCwd: string | null;
  pendingExit: number | null;
  shellExited: boolean;
  callbacks: TerminalSessionCallbacks;
  visibleNow: boolean;
  focusedNow: boolean;
  disposed: boolean;
  ready: Promise<void>;
  cols: number;
  rows: number;
  container: HTMLDivElement | null;
  searchQuery: string | null;
  hasSlot: boolean;
  modelTerm: Terminal;
  modelSerializeAddon: SerializeAddon;
  modelOscDisposers: (() => void)[];
  nextOutputOffset: number;
  outputChain: Promise<void>;
  generation: number;
  pendingWrites: string[];
};

export type TerminalSessionHandle = {
  write: (data: string) => void;
  focus: () => void;
  getBuffer: (maxLines?: number) => string | null;
  getSelection: () => string | null;
  applyTheme: () => void;
};

const sessions = new Map<number, Session>();
const TRANSCRIPT_READ_CHUNK_BYTES = 1024 * 1024;

configureRendererPool({
  resolveLeaf(leafId) {
    const s = sessions.get(leafId);
    if (!s) return null;
    return {
      writeToPty: (data) => {
        s.pty?.write(data);
      },
      resizePty: (cols, rows) => {
        s.cols = cols;
        s.rows = rows;
        resizeModel(s, cols, rows);
        s.pty?.resize(cols, rows);
      },
      kickPty: (cols, rows) => {
        const pty = s.pty;
        if (!pty || cols <= 0 || rows <= 0) return;
        pty
          .resize(cols, rows + 1)
          .then(() => pty.resize(cols, rows))
          .catch((e) => console.warn("[nexterm] kickPty failed:", e));
      },
    };
  },
  evictLeaf(leafId) {
    const s = sessions.get(leafId);
    if (!s) return;
    unbindLeafFromSlot(leafId, s);
  },
  isLeafFocused(leafId) {
    const s = sessions.get(leafId);
    return !!s && s.visibleNow && s.focusedNow;
  },
});

function ensureSession(
  leafId: number,
  initialCwd?: string,
  startupInput?: string,
): Session {
  const existing = sessions.get(leafId);
  if (existing) return existing;

  const modelTerm = new Terminal(createTerminalOptions());
  const modelSerializeAddon = new SerializeAddon();
  modelTerm.loadAddon(modelSerializeAddon);

  const session: Session = {
    pty: null,
    transcriptReader: null,
    ptyOpening: false,
    initialCwd,
    lastCwd: null,
    pendingExit: null,
    shellExited: false,
    callbacks: {},
    visibleNow: false,
    focusedNow: false,
    disposed: false,
    ready: Promise.resolve(),
    cols: modelTerm.cols,
    rows: modelTerm.rows,
    container: null,
    searchQuery: null,
    hasSlot: false,
    modelTerm,
    modelSerializeAddon,
    modelOscDisposers: [],
    nextOutputOffset: 0,
    outputChain: Promise.resolve(),
    generation: 0,
    pendingWrites: startupInput ? [startupInput] : [],
  };
  session.modelOscDisposers = registerModelOsc(session);
  sessions.set(leafId, session);

  session.ready = (async () => {
    await ensureMonoFontsLoaded();
    await document.fonts.ready;
  })();

  return session;
}

function flushPendingWrites(s: Session): void {
  const pty = s.pty;
  if (!pty || s.pendingWrites.length === 0) return;
  const writes = s.pendingWrites.splice(0);
  for (const data of writes) {
    void pty.write(data).catch((e) => {
      console.warn("[nexterm] queued terminal write failed:", e);
    });
  }
}

function registerModelOsc(s: Session): (() => void)[] {
  const shellState = createShellIntegrationState();
  const prompt = registerPromptTracker(s.modelTerm, shellState);
  const cwd = registerCwdHandler(
    s.modelTerm,
    (next) => {
      if (s.lastCwd === next) return;
      s.lastCwd = next;
      s.callbacks.onCwd?.(next);
    },
    shellState,
  );
  const title = registerTitleHandler(s.modelTerm, (next) => {
    s.callbacks.onTitle?.(next);
  });
  return [prompt.dispose, cwd, title];
}

function deliverPtyChunk(
  leafId: number,
  generation: number,
  chunk: PtyOutputChunk,
): void {
  const s = sessions.get(leafId);
  if (!s || s.disposed || s.generation !== generation) return;
  s.outputChain = s.outputChain
    .then(() => processPtyChunk(leafId, s, generation, chunk))
    .catch((e) => console.warn("[nexterm] PTY output processing failed:", e));
}

async function processPtyChunk(
  leafId: number,
  s: Session,
  generation: number,
  chunk: PtyOutputChunk,
): Promise<void> {
  if (s.disposed || s.generation !== generation || chunk.bytes.length === 0) {
    return;
  }

  if (chunk.startOffset > s.nextOutputOffset) {
    await fillTranscriptGap(leafId, s, generation, chunk.startOffset);
  }

  let startOffset = chunk.startOffset;
  let bytes = chunk.bytes;
  if (startOffset < s.nextOutputOffset) {
    const overlap = s.nextOutputOffset - startOffset;
    if (overlap >= bytes.length) return;
    bytes = bytes.subarray(overlap);
    startOffset = s.nextOutputOffset;
  }

  await writeSessionBytes(leafId, s, generation, bytes);
  s.nextOutputOffset = startOffset + bytes.length;
}

async function fillTranscriptGap(
  leafId: number,
  s: Session,
  generation: number,
  targetOffset: number,
): Promise<void> {
  let cursor = s.nextOutputOffset;
  while (
    cursor < targetOffset &&
    !s.disposed &&
    s.generation === generation
  ) {
    const reader = s.transcriptReader ?? s.pty;
    if (!reader) {
      console.warn("[nexterm] missing PTY transcript reader for output gap");
      return;
    }
    const maxBytes = Math.min(
      TRANSCRIPT_READ_CHUNK_BYTES,
      targetOffset - cursor,
    );
    const read = await reader.readTranscript(cursor, maxBytes);
    if (read.bytes.length === 0) {
      console.warn("[nexterm] PTY transcript gap could not be filled");
      return;
    }

    let startOffset = read.startOffset;
    let bytes = read.bytes;
    if (startOffset < cursor) {
      const overlap = cursor - startOffset;
      bytes = bytes.subarray(overlap);
      startOffset = cursor;
    }
    if (startOffset > cursor) {
      console.warn("[nexterm] PTY transcript read skipped bytes");
      return;
    }

    const wanted = Math.min(bytes.length, targetOffset - cursor);
    await writeSessionBytes(leafId, s, generation, bytes.subarray(0, wanted));
    cursor += wanted;
    s.nextOutputOffset = cursor;
  }
}

async function writeSessionBytes(
  leafId: number,
  s: Session,
  generation: number,
  bytes: Uint8Array,
): Promise<void> {
  if (bytes.length === 0 || s.disposed || s.generation !== generation) return;

  const slot = getSlotForLeaf(leafId);
  if (slot && slot.currentLeafId === leafId) {
    await Promise.all([
      writeToTerminal(s.modelTerm, bytes),
      writeToTerminal(slot.term, bytes),
    ]);
    return;
  }

  await writeToTerminal(s.modelTerm, bytes);
  const currentSlot = getSlotForLeaf(leafId);
  if (
    currentSlot &&
    currentSlot.currentLeafId === leafId &&
    !s.disposed &&
    s.generation === generation
  ) {
    await writeToTerminal(currentSlot.term, bytes);
  }
}

function writeToTerminal(
  term: Terminal,
  data: string | Uint8Array,
): Promise<void> {
  if (typeof data !== "string" && data.length === 0) return Promise.resolve();
  if (typeof data === "string" && data.length === 0) return Promise.resolve();
  return new Promise((resolve) => {
    try {
      term.write(data, () => resolve());
    } catch (e) {
      console.warn("[nexterm] terminal write failed:", e);
      resolve();
    }
  });
}

async function openPtyForSession(
  leafId: number,
  s: Session,
  generation: number,
  cwd: string | undefined,
): Promise<PtySession> {
  const startCols = s.cols > 0 ? s.cols : 80;
  const startRows = s.rows > 0 ? s.rows : 24;
  return openPty(
    startCols,
    startRows,
    {
      onData: (chunk) => deliverPtyChunk(leafId, generation, chunk),
      onExit: (code) => {
        if (s.generation !== generation) return;
        s.shellExited = true;
        s.pty = null;
        const slot = getSlotForLeaf(leafId);
        if (slot) slot.term.options.disableStdin = true;
        if (s.callbacks.onExit) s.callbacks.onExit(code);
        else s.pendingExit = code;
      },
    },
    cwd,
  );
}

function bindLeafToSlot(leafId: number, s: Session): void {
  if (!s.container) return;
  resizeModel(s, s.cols, s.rows);
  acquireSlot({
    leafId,
    container: s.container,
    snapshot: serializeModel(s),
    altScreen: isAltScreen(s.modelTerm),
    shellExited: s.shellExited,
    searchQuery: s.searchQuery,
    cols: s.cols,
    rows: s.rows,
    registerOsc: () => [],
    onSearchReady: (addon) => s.callbacks.onSearchReady?.(addon),
  });
  s.hasSlot = true;
  if (s.lastCwd !== null) s.callbacks.onCwd?.(s.lastCwd);
  if (s.pendingExit !== null) {
    const code = s.pendingExit;
    s.pendingExit = null;
    s.callbacks.onExit?.(code);
  }
}

function serializeModel(s: Session): string | null {
  try {
    return s.modelSerializeAddon.serialize();
  } catch (e) {
    console.warn("[nexterm] model serialize failed:", e);
    return null;
  }
}

function isAltScreen(term: Terminal): boolean {
  try {
    return term.buffer.active.type === "alternate";
  } catch {
    return false;
  }
}

function resizeModel(s: Session, cols: number, rows: number): void {
  if (cols <= 0 || rows <= 0) return;
  if (s.modelTerm.cols === cols && s.modelTerm.rows === rows) return;
  try {
    s.modelTerm.resize(cols, rows);
  } catch (e) {
    console.warn("[nexterm] model resize failed:", e);
  }
}

function resetModel(s: Session): void {
  try {
    s.modelTerm.clear();
    s.modelTerm.reset();
  } catch (e) {
    console.warn("[nexterm] model reset failed:", e);
  }
}

function unbindLeafFromSlot(leafId: number, s: Session): void {
  if (!s.hasSlot) return;
  const out = releaseSlot(leafId);
  if (out) {
    if (out.cols > 0) s.cols = out.cols;
    if (out.rows > 0) s.rows = out.rows;
    resizeModel(s, s.cols, s.rows);
  }
  s.hasSlot = false;
}

function attachSession(
  leafId: number,
  container: HTMLDivElement,
  callbacks: TerminalSessionCallbacks,
): void {
  const s = sessions.get(leafId);
  if (!s || s.disposed) return;
  s.callbacks = callbacks;
  s.container = container;

  if (s.visibleNow) bindLeafToSlot(leafId, s);

  if (!s.pty && !s.ptyOpening && !s.shellExited) {
    const generation = s.generation;
    s.ptyOpening = true;
    openPtyForSession(leafId, s, generation, s.initialCwd)
      .then((pty) => {
        s.ptyOpening = false;
        if (s.disposed || s.generation !== generation) {
          pty.close();
          return;
        }
        s.pty = pty;
        s.transcriptReader = pty;
        flushPendingWrites(s);
        if (s.cols > 0 && s.rows > 0) pty.resize(s.cols, s.rows);
      })
      .catch((e) => {
        s.ptyOpening = false;
        console.error("[nexterm] openPty failed:", e);
      });
  }
}

function detachSession(leafId: number): void {
  const s = sessions.get(leafId);
  if (!s) return;
  unbindLeafFromSlot(leafId, s);
  s.callbacks = {};
  s.container = null;
}

export function mountTerminalSession({
  leafId,
  container,
  initialCwd,
  startupInput,
  callbacks,
}: {
  leafId: number;
  container: HTMLDivElement;
  initialCwd?: string;
  startupInput?: string;
  callbacks?: TerminalSessionCallbacks;
}): () => void {
  let cancelled = false;
  const s = ensureSession(leafId, initialCwd, startupInput);
  s.ready.then(() => {
    if (cancelled || s.disposed) return;
    attachSession(leafId, container, callbacks ?? {});
    if (s.visibleNow && s.focusedNow) focusSlot(leafId);
  });
  return () => {
    cancelled = true;
    detachSession(leafId);
  };
}

export function updateTerminalSessionVisibility(
  leafId: number,
  visible: boolean,
  focused = true,
): void {
  const s = sessions.get(leafId);
  if (!s) return;
  s.visibleNow = visible;
  s.focusedNow = focused;
  if (visible) {
    if (s.container && !s.hasSlot) bindLeafToSlot(leafId, s);
    setSlotFocused(leafId, focused);
    if (focused) focusSlot(leafId);
  } else if (s.hasSlot) {
    unbindLeafFromSlot(leafId, s);
  }
}

export async function respawnSession(
  leafId: number,
  cwd?: string,
): Promise<void> {
  const s = sessions.get(leafId);
  if (!s || s.disposed) return;
  s.generation++;
  const previous = s.pty ?? s.transcriptReader;
  s.pty = null;
  s.transcriptReader = null;
  await previous?.close();
  s.outputChain = Promise.resolve();
  s.nextOutputOffset = 0;
  s.shellExited = false;
  s.pendingExit = null;
  resetModel(s);

  const slot = getSlotForLeaf(leafId);
  if (slot) {
    slot.term.options.disableStdin = false;
    slot.term.clear();
    slot.term.reset();
  }

  const generation = s.generation;
  s.ptyOpening = true;
  let pty: PtySession;
  try {
    pty = await openPtyForSession(leafId, s, generation, cwd ?? s.initialCwd);
  } catch (e) {
    s.ptyOpening = false;
    console.error("[nexterm] respawn openPty failed:", e);
    return;
  }
  s.ptyOpening = false;
  if (s.disposed || s.generation !== generation) {
    pty.close();
    return;
  }
  s.pty = pty;
  s.transcriptReader = pty;
  flushPendingWrites(s);
  if (s.cols > 0 && s.rows > 0) pty.resize(s.cols, s.rows);
}

export function disposeSession(leafId: number): void {
  const s = sessions.get(leafId);
  if (!s) return;
  s.disposed = true;
  s.generation++;
  unbindLeafFromSlot(leafId, s);
  const previous = s.pty ?? s.transcriptReader;
  s.pty = null;
  s.transcriptReader = null;
  previous?.close();
  for (const dispose of s.modelOscDisposers) {
    try {
      dispose();
    } catch {}
  }
  s.modelOscDisposers = [];
  s.modelTerm.dispose();
  sessions.delete(leafId);
}

configureTerminalSessionDisposer(disposeSession);

export function writeTerminalSession(leafId: number, data: string): void {
  const s = sessions.get(leafId);
  if (!s) return;
  if (!s.pty) {
    s.pendingWrites.push(data);
    return;
  }
  void s.pty.write(data);
}

export function focusTerminalSession(leafId: number): void {
  focusSlot(leafId);
}

export function getTerminalBuffer(
  leafId: number,
  maxLines = 200,
): string | null {
  const s = sessions.get(leafId);
  if (!s) return null;
  const buf = s.modelTerm.buffer.active;
  const total = buf.length;
  const lines: string[] = [];
  const start = Math.max(0, total - maxLines);
  for (let i = start; i < total; i++) {
    lines.push(buf.getLine(i)?.translateToString(true) ?? "");
  }
  while (lines.length && lines[lines.length - 1] === "") lines.pop();
  return lines.join("\n");
}

export function getTerminalSelection(leafId: number): string | null {
  const slot = getSlotForLeaf(leafId);
  const sel = slot?.term.getSelection() ?? "";
  return sel.length > 0 ? sel : null;
}

export function applyTerminalSessionTheme(): void {
  applyPoolTheme();
}

export function applyTerminalSessionScrollback(value: number): void {
  for (const s of sessions.values()) {
    if (s.modelTerm.options.scrollback === value) continue;
    s.modelTerm.options.scrollback = value;
  }
}

export function createTerminalSessionHandle(
  leafId: number,
): TerminalSessionHandle {
  return {
    write: (data) => writeTerminalSession(leafId, data),
    focus: () => focusTerminalSession(leafId),
    getBuffer: (max) => getTerminalBuffer(leafId, max),
    getSelection: () => getTerminalSelection(leafId),
    applyTheme: () => applyTerminalSessionTheme(),
  };
}
