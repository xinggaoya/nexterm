/**
 * Single-session management. Each leaf owns one xterm instance and one
 * PtySession; both are torn down when the leaf disposes. The previous
 * architecture used a renderer pool with offscreen canvas reuse, but
 * keeping an instance per pane is simpler, easier to reason about, and
 * let us drop ~700 lines of recycling/scrollbar-refund code.
 *
 * `pendingBuffer` (held outside of the channel's reach) accumulates OSC
 * sequences that span a chunk boundary — the only piece of stateful
 * parsing the parser needs to keep.
 */

import type { Terminal } from "@xterm/xterm";
import { native } from "@/lib/native";
import { handleOscData } from "./osc";
import type { OscEvent } from "./osc";

export type SessionState = "connecting" | "running" | "exited";

export interface SessionCallbacks {
  onCwd: (cwd: string) => void;
  onTitle: (title: string) => void;
  onStateChange: (state: SessionState, exitCode?: number) => void;
}

export interface PtySessionHandle {
  leafId: string;
  dispose: () => void;
  write: (data: string) => void;
  resize: (cols: number, rows: number) => void;
  restart: () => void;
  /** Last known lifecycle state; lets a remounted pane recover its badge. */
  getState: () => SessionState;
  getExitCode: () => number | undefined;
  /** Re-point the session's cwd/title/state callbacks at a new pane. */
  setCallbacks: (callbacks: SessionCallbacks) => void;
}

export interface ActiveSession {
  ptyId: number;
  pendingOsc: string;
  write: (data: string) => Promise<void>;
  resize: (cols: number, rows: number) => Promise<void>;
  close: () => Promise<void>;
}

interface CreateSessionOptions {
  term: Terminal;
  cwd?: string;
  callbacks: SessionCallbacks;
}

export async function createSession(
  opts: CreateSessionOptions,
): Promise<PtySessionHandle> {
  // Callbacks/state are mutable so a pane that remounts (e.g. after a tab
  // switch) can re-subscribe and recover the badge without respawning.
  let callbacks = opts.callbacks;
  let state: SessionState = "connecting";
  let exitCode: number | undefined;
  let pendingOsc = "";

  const pty = await native.ptyOpen(
    opts.term.cols,
    opts.term.rows,
    {
      onData: (chunk) => {
        const { cleaned, events, pendingBuffer } = handleOscData(
          chunk,
          pendingOsc,
        );
        pendingOsc = pendingBuffer;
        for (const ev of events) emitOsc(ev, callbacks);
        if (cleaned) opts.term.write(cleaned);
      },
      onExit: (code) => {
        state = "exited";
        exitCode = code;
        callbacks.onStateChange("exited", code);
      },
    },
    opts.cwd,
  );
  const id = pty.id;

  // A very fast-exiting shell can fire onExit during the await above; only
  // promote to "running" when it hasn't already reported an exit.
  if ((state as SessionState) !== "exited") {
    state = "running";
    callbacks.onStateChange("running");
  }

  const handle: PtySessionHandle = {
    leafId: id.toString(),
    dispose: () => {
      void pty.close().catch(() => {});
    },
    write: (data) => {
      void pty.write(data).catch(() => {});
    },
    resize: (cols, rows) => {
      void pty.resize(cols, rows).catch(() => {});
    },
    restart: () => {
      void native.ptyKill(id).catch(() => {});
    },
    getState: () => state,
    getExitCode: () => exitCode,
    setCallbacks: (next) => {
      callbacks = next;
    },
  };

  opts.term.onData((data) => handle.write(data));

  return handle;
}

function emitOsc(event: OscEvent, cb: SessionCallbacks): void {
  if (event.type === "cwd") cb.onCwd(event.value);
  else cb.onTitle(event.value);
}

export const SESSION_REGISTRY = new Map<string, PtySessionHandle>();

export function trackSession(leafId: string, handle: PtySessionHandle): void {
  const prev = SESSION_REGISTRY.get(leafId);
  if (prev && prev !== handle) prev.dispose();
  SESSION_REGISTRY.set(leafId, handle);
}

export function disposeSession(leafId: string): void {
  const handle = SESSION_REGISTRY.get(leafId);
  if (!handle) return;
  SESSION_REGISTRY.delete(leafId);
  handle.dispose();
}

export function getSessionForLeaf(
  leafId: string,
): PtySessionHandle | undefined {
  return SESSION_REGISTRY.get(leafId);
}

export function disposeAllSessions(): void {
  for (const [leafId, handle] of SESSION_REGISTRY.entries()) {
    handle.dispose();
    SESSION_REGISTRY.delete(leafId);
  }
}
