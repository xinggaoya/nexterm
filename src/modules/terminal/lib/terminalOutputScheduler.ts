import type { Terminal } from "@xterm/xterm";

type TerminalWriteData = string | Uint8Array;

type PendingWrite = {
  data: TerminalWriteData;
  resolve: () => void;
};

type FrameHandle = number | ReturnType<typeof setTimeout>;

type TerminalWriteQueue = {
  pending: PendingWrite[];
  raf: FrameHandle | null;
  flushing: boolean;
};

const queues = new WeakMap<Terminal, TerminalWriteQueue>();

export function scheduleTerminalWrite(
  term: Terminal,
  data: TerminalWriteData,
): Promise<void> {
  if (isEmptyWrite(data)) return Promise.resolve();

  const queue = queueFor(term);
  return new Promise((resolve) => {
    queue.pending.push({ data, resolve });
    scheduleFlush(term, queue);
  });
}

function queueFor(term: Terminal): TerminalWriteQueue {
  const existing = queues.get(term);
  if (existing) return existing;
  const queue: TerminalWriteQueue = {
    pending: [],
    raf: null,
    flushing: false,
  };
  queues.set(term, queue);
  return queue;
}

function scheduleFlush(term: Terminal, queue: TerminalWriteQueue): void {
  if (queue.raf !== null || queue.flushing) return;
  queue.raf = requestFrame(() => {
    queue.raf = null;
    void flushQueue(term, queue);
  });
}

async function flushQueue(
  term: Terminal,
  queue: TerminalWriteQueue,
): Promise<void> {
  if (queue.flushing) return;
  queue.flushing = true;
  try {
    while (queue.pending.length > 0) {
      const batch = queue.pending.splice(0);
      const segments = coalesceWrites(batch.map((item) => item.data));
      for (const segment of segments) {
        await writeSegment(term, segment);
      }
      for (const item of batch) item.resolve();
    }
  } finally {
    queue.flushing = false;
    if (queue.pending.length > 0) scheduleFlush(term, queue);
  }
}

function writeSegment(term: Terminal, data: TerminalWriteData): Promise<void> {
  return new Promise((resolve) => {
    try {
      term.write(data, () => resolve());
    } catch (e) {
      console.warn("[nexterm] terminal write failed:", e);
      resolve();
    }
  });
}

function coalesceWrites(parts: TerminalWriteData[]): TerminalWriteData[] {
  const out: TerminalWriteData[] = [];
  let pendingText = "";
  let pendingBytes: Uint8Array[] = [];
  let pendingByteLength = 0;

  const flushText = () => {
    if (!pendingText) return;
    out.push(pendingText);
    pendingText = "";
  };
  const flushBytes = () => {
    if (pendingBytes.length === 0) return;
    out.push(concatBytes(pendingBytes, pendingByteLength));
    pendingBytes = [];
    pendingByteLength = 0;
  };

  for (const part of parts) {
    if (isEmptyWrite(part)) continue;
    if (typeof part === "string") {
      flushBytes();
      pendingText += part;
    } else {
      flushText();
      pendingBytes.push(part);
      pendingByteLength += part.length;
    }
  }
  flushText();
  flushBytes();
  return out;
}

function concatBytes(parts: Uint8Array[], totalLength: number): Uint8Array {
  if (parts.length === 1) return parts[0];
  const out = new Uint8Array(totalLength);
  let offset = 0;
  for (const part of parts) {
    out.set(part, offset);
    offset += part.length;
  }
  return out;
}

function isEmptyWrite(data: TerminalWriteData): boolean {
  return typeof data === "string" ? data.length === 0 : data.length === 0;
}

function requestFrame(callback: FrameRequestCallback): FrameHandle {
  const raf = globalThis.requestAnimationFrame;
  if (typeof raf === "function") {
    return raf(callback);
  }
  return globalThis.setTimeout(() => callback(performance.now()), 16);
}
