import { invoke, Channel } from "@tauri-apps/api/core";
import { currentWorkspaceEnv } from "@/modules/workspace/workspaceEnvSnapshot";

export type PtyOutputChunk = {
  startOffset: number;
  bytes: Uint8Array;
};

export type PtyTranscriptRead = {
  startOffset: number;
  nextOffset: number;
  totalOffset: number;
  bytes: Uint8Array;
};

export type PtyHandlers = {
  onData: (chunk: PtyOutputChunk) => void;
  onExit?: (code: number) => void;
};

export type PtySession = {
  id: number;
  write: (data: string) => Promise<void>;
  resize: (cols: number, rows: number) => Promise<void>;
  updateMetadata: (patch: { title?: string; cwd?: string }) => Promise<void>;
  readTranscript: (
    sinceOffset: number,
    maxBytes?: number,
  ) => Promise<PtyTranscriptRead>;
  close: () => Promise<void>;
};

type RawTranscriptRead = {
  startOffset: number;
  nextOffset: number;
  totalOffset: number;
  dataBase64: string;
};

const TRANSCRIPT_READ_CHUNK = 1024 * 1024;

export async function openPty(
  cols: number,
  rows: number,
  handlers: PtyHandlers,
  cwd?: string,
): Promise<PtySession> {
  // Raw bytes — no base64/JSON round-trip; messages arrive as ArrayBuffer.
  const onData = new Channel<ArrayBuffer>();
  const onExit = new Channel<number>();

  let released = false;
  const noop = () => {};
  const releaseHandlers = () => {
    if (released) return;
    released = true;
    onData.onmessage = noop;
    onExit.onmessage = noop;
  };

  onData.onmessage = (buf) => handlers.onData(decodeOutputFrame(buf));
  onExit.onmessage = (code) => {
    handlers.onExit?.(code);
    releaseHandlers();
  };

  const id = await invoke<number>("pty_open", {
    cols,
    rows,
    cwd: cwd ?? null,
    workspace: currentWorkspaceEnv(),
    onData,
    onExit,
  });

  let closed = false;

  return {
    id,
    write: (data) => invoke("pty_write", { id, data }),
    resize: (c, r) => invoke("pty_resize", { id, cols: c, rows: r }),
    updateMetadata: (patch) =>
      invoke("pty_update_metadata", {
        id,
        title: patch.title ?? null,
        cwd: patch.cwd ?? null,
      }),
    readTranscript: async (sinceOffset, maxBytes = TRANSCRIPT_READ_CHUNK) => {
      const raw = await invoke<RawTranscriptRead>("pty_read_transcript", {
        id,
        sinceOffset,
        maxBytes,
      });
      return {
        startOffset: raw.startOffset,
        nextOffset: raw.nextOffset,
        totalOffset: raw.totalOffset,
        bytes: decodeBase64(raw.dataBase64),
      };
    },
    close: async () => {
      if (closed) return;
      closed = true;
      try {
        await invoke("pty_close", { id });
      } finally {
        releaseHandlers();
      }
    },
  };
}

function decodeOutputFrame(buf: ArrayBuffer): PtyOutputChunk {
  if (buf.byteLength < 8) {
    return { startOffset: 0, bytes: new Uint8Array() };
  }
  const view = new DataView(buf);
  const startOffset = Number(view.getBigUint64(0, true));
  return {
    startOffset,
    bytes: new Uint8Array(buf, 8),
  };
}

function decodeBase64(value: string): Uint8Array {
  const binary = window.atob(value);
  const bytes = new Uint8Array(binary.length);
  for (let i = 0; i < binary.length; i++) {
    bytes[i] = binary.charCodeAt(i);
  }
  return bytes;
}
