/**
 * Workspace-partitioned session management.
 *
 * Each leaf owns one xterm instance and one PtySession; both are torn down
 * when the leaf disposes. Sessions are partitioned by `workspaceId` so that
 * multiple workspaces can hold terminals concurrently without their leaf ids
 * or PTY handles colliding.
 *
 * `createSession` takes a `wsNative` (env-bound native surface) so the PTY is
 * spawned in the correct workspace's environment — there is no global
 * "current" env.
 *
 * `pendingBuffer` (held outside of the channel's reach) accumulates OSC
 * sequences that span a chunk boundary — the only piece of stateful
 * parsing the parser needs to keep.
 */

import type { Terminal } from "@xterm/xterm";
import type { WorkspaceNative } from "@/lib/native";
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
  ptyId: number;
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

interface CreateSessionOptions {
  term: Terminal;
  cwd?: string;
  callbacks: SessionCallbacks;
  /** Env-bound native surface for the workspace owning this session. */
  wsNative: WorkspaceNative;
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

  const pty = await opts.wsNative.ptyOpen(
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
    ptyId: id,
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
      // ptyKill lives on the global native surface (id-keyed, not env-scoped)
      // but we intentionally avoid importing the singleton here; the pane owns
      // restart via its own channel if needed. Kept as best-effort no-op
      // fallback for legacy callers.
      void pty.close().catch(() => {});
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
  else if (event.type === "title") cb.onTitle(event.value);
  // OSC 8 hyperlink handled separately via xterm.registerLinkProvider;
  // we keep the parser events here for completeness but don't surface them
  // to SessionCallbacks (which only knows about cwd/title).
}

/**
 * Workspace-partitioned session registry.
 *
 * Outer map: `workspaceId` → inner map. Inner map: `leafId` → handle. A
 * workspace's leaf ids are namespaced (e.g. `${workspaceId}:${n}`) so they
 * never collide across workspaces.
 */
const SESSION_REGISTRY = new Map<string, Map<string, PtySessionHandle>>();

function workspaceBucket(workspaceId: string): Map<string, PtySessionHandle> {
  let bucket = SESSION_REGISTRY.get(workspaceId);
  if (!bucket) {
    bucket = new Map();
    SESSION_REGISTRY.set(workspaceId, bucket);
  }
  return bucket;
}

export function trackSession(
  workspaceId: string,
  leafId: string,
  handle: PtySessionHandle,
): void {
  const bucket = workspaceBucket(workspaceId);
  const prev = bucket.get(leafId);
  if (prev && prev !== handle) prev.dispose();
  bucket.set(leafId, handle);
}

export function disposeSession(
  workspaceId: string,
  leafId: string,
): void {
  const bucket = SESSION_REGISTRY.get(workspaceId);
  if (!bucket) return;
  const handle = bucket.get(leafId);
  if (!handle) return;
  bucket.delete(leafId);
  handle.dispose();
  if (bucket.size === 0) SESSION_REGISTRY.delete(workspaceId);
}

export function getSessionForLeaf(
  workspaceId: string,
  leafId: string,
): PtySessionHandle | undefined {
  return SESSION_REGISTRY.get(workspaceId)?.get(leafId);
}

/** Dispose every session owned by a workspace (used when closing a workspace). */
export function disposeWorkspaceSessions(workspaceId: string): void {
  const bucket = SESSION_REGISTRY.get(workspaceId);
  if (!bucket) return;
  for (const handle of bucket.values()) handle.dispose();
  bucket.clear();
  SESSION_REGISTRY.delete(workspaceId);
}

/** Dispose all sessions across all workspaces (app shutdown). */
export function disposeAllSessions(): void {
  for (const bucket of SESSION_REGISTRY.values()) {
    for (const handle of bucket.values()) handle.dispose();
    bucket.clear();
  }
  SESSION_REGISTRY.clear();
}
