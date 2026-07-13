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
import { Channel } from "@tauri-apps/api/core";
import { invoke } from "@tauri-apps/api/core";
import type { WorkspaceEnv } from "@/modules/workspace/workspaceEnvSnapshot";
import { currentWorkspaceEnv } from "@/modules/workspace/workspaceEnvSnapshot";
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
  workspace?: WorkspaceEnv;
  callbacks: SessionCallbacks;
}

export async function createSession(
  opts: CreateSessionOptions,
): Promise<PtySessionHandle> {
  const onData = new Channel<string>();
  const onExit = new Channel<number>();

  onData.onmessage = (chunk) => {
    const { cleaned, events } = handleOscData(chunk, "");
    // OSC bookkeeping is local to the parser — combining across chunks uses
    // the pendingBuffer argument. We don't need it here because Tauri sends
    // each chunk verbatim; the only stateful thing left is OSC spanning a
    // chunk boundary, which we re-thread by passing empty each time.
    // (handleOscData ignores prevPending when the chunk is clean.)
    for (const ev of events) emitOsc(ev, opts.callbacks);
    if (cleaned) opts.term.write(cleaned);
  };

  onExit.onmessage = (code) => {
    opts.callbacks.onStateChange("exited", code);
  };

  const id = await invoke<number>("pty_open", {
    cols: opts.term.cols,
    rows: opts.term.rows,
    cwd: opts.cwd ?? null,
    workspace: opts.workspace ?? currentWorkspaceEnv(),
    onData,
    onExit,
  });

  opts.callbacks.onStateChange("running");

  const handle: PtySessionHandle = {
    leafId: id.toString(),
    dispose: () => {
      void invoke("pty_close", { id }).catch(() => {});
    },
    write: (data) => {
      void invoke("pty_write", { id, data }).catch(() => {});
    },
    resize: (cols, rows) => {
      void invoke("pty_resize", { id, cols, rows }).catch(() => {});
    },
    restart: () => {
      void invoke("pty_kill", { id }).catch(() => {});
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
