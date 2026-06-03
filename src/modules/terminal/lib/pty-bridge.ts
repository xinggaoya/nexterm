import {
  native,
  type PtyHandlers,
  type PtyOutputChunk,
  type PtySession,
  type PtyTranscriptRead,
} from "@/lib/native";

export type {
  PtyHandlers,
  PtyOutputChunk,
  PtySession,
  PtyTranscriptRead,
};

/**
 * Open a PTY session. Thin re-export of `native.ptyOpen` that preserves the
 * historical entry point for tests and downstream callers. The base64
 * transcript decode and channel `onData` framing both live in `native.ts`
 * so the bridge module has no client-side helpers of its own.
 */
export function openPty(
  cols: number,
  rows: number,
  handlers: PtyHandlers,
  cwd?: string,
): Promise<PtySession> {
  return native.ptyOpen(cols, rows, handlers, cwd);
}
