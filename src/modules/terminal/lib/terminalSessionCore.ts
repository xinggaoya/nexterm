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
  refreshSlotLayout,
  releaseSlot,
  setSlotFocused,
  configureRendererPool,
} from "./rendererPool";
import { scheduleTerminalWrite } from "./terminalOutputScheduler";

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
  ptyFailed: boolean;
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
  pendingWriteBytes: number;
};

// Cap on how much user-typed input we buffer while the PTY is not yet
// attached. The bound is in bytes (UTF-16 code units) rather than entries
// because a long paste can be a single entry that runs into the megabytes.
const PENDING_WRITES_BYTE_LIMIT = 256 * 1024;

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
    ptyFailed: false,
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
    pendingWriteBytes: startupInput ? startupInput.length : 0,
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
  s.pendingWriteBytes = 0;
  for (const data of writes) {
    void pty.write(data).catch((e) => {
      console.warn("[nexterm] queued terminal write failed:", e);
    });
  }
}

function dropPendingWrites(s: Session): void {
  s.pendingWrites.length = 0;
  s.pendingWriteBytes = 0;
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

  writeSessionBytes(leafId, s, generation, bytes);
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
    writeSessionBytes(leafId, s, generation, bytes.subarray(0, wanted));
    cursor += wanted;
    s.nextOutputOffset = cursor;
  }
}

function writeSessionBytes(
  leafId: number,
  s: Session,
  generation: number,
  bytes: Uint8Array,
): void {
  if (bytes.length === 0 || s.disposed || s.generation !== generation) return;

  // Fire-and-forget: scheduleTerminalWrite queues data for the next RAF
  // flush. Awaiting it would stall the outputChain to one chunk per frame.
  // By not awaiting, multiple PTY chunks merge within a single RAF frame
  // via coalesceWrites in the output scheduler.
  writeToTerminal(s.modelTerm, bytes);

  const slot = getSlotForLeaf(leafId);
  if (slot && slot.currentLeafId === leafId) {
    writeToTerminal(slot.term, bytes);
  }
}

function writeToTerminal(term: Terminal, data: string | Uint8Array): void {
  scheduleTerminalWrite(term, data);
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
        s.ptyFailed = false;
        flushPendingWrites(s);
        if (s.cols > 0 && s.rows > 0) pty.resize(s.cols, s.rows);
      })
      .catch((e) => {
        s.ptyOpening = false;
        s.ptyFailed = true;
        // Without dropping the queued writes, every keystroke the user
        // typed while the open was in flight would sit in memory forever
        // (the PTY is gone and nothing will ever drain the queue). Drop
        // them now and surface the error via the onExit channel so the
        // UI can offer "respawn" or show an inline failure state.
        const queuedCount = s.pendingWrites.length;
        const queuedBytes = s.pendingWriteBytes;
        dropPendingWrites(s);
        console.error(
          `[nexterm] openPty failed for leaf ${leafId} (dropped ${queuedCount} queued writes / ${queuedBytes} bytes):`,
          e,
        );
        s.pendingExit = -1;
        s.shellExited = true;
        s.callbacks.onExit?.(-1);
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
  const wasVisible = s.visibleNow;
  s.visibleNow = visible;
  s.focusedNow = focused;
  if (visible) {
    const hadSlot = s.hasSlot;
    if (s.container && !s.hasSlot) bindLeafToSlot(leafId, s);
    if (!wasVisible || !hadSlot) {
      refreshSlotLayout(leafId, {
        forcePty: true,
        kickPty: isAltScreen(s.modelTerm) && !s.shellExited,
        focus: focused,
      });
    }
    setSlotFocused(leafId, focused);
    if (focused) focusSlot(leafId);
  } else {
    setSlotFocused(leafId, false);
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
  s.ptyFailed = false;
  s.pendingExit = null;
  dropPendingWrites(s);
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
  if (s.ptyFailed || s.shellExited) {
    // The PTY is gone for good — don't accumulate input the shell can never
    // see. A single warning per session is enough to surface the problem
    // without spamming the console on every keystroke.
    console.warn(
      `[nexterm] dropping terminal input for leaf ${leafId}: PTY unavailable`,
    );
    return;
  }
  if (!s.pty) {
    if (s.pendingWriteBytes + data.length > PENDING_WRITES_BYTE_LIMIT) {
      console.warn(
        `[nexterm] pending terminal input exceeded ${PENDING_WRITES_BYTE_LIMIT} bytes; dropping oldest entries`,
      );
      while (
        s.pendingWriteBytes + data.length > PENDING_WRITES_BYTE_LIMIT &&
        s.pendingWrites.length > 0
      ) {
        const removed = s.pendingWrites.shift();
        if (removed) s.pendingWriteBytes -= removed.length;
      }
    }
    s.pendingWrites.push(data);
    s.pendingWriteBytes += data.length;
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
