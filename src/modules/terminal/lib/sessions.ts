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
  /**
   * PTY 打开后若在 watchdogMs 内既无输出也未退出，视为 shell 假死
   * （WSL 冷启动常见：wsl.exe 进程创建成功但 shell 半启动、无输出）。
   * 触发后回调上层销毁坏 session 并重建。正常 shell 首帧会在毫秒级到达，
   * 首次 onData 即清 watchdog，零开销。
   */
  onDeadStart?: () => void;
  /** 启动 watchdog 超时阈值（ms），默认 8000（WSL 冷启动给宽限）。 */
  watchdogMs?: number;
}

/** 默认启动 watchdog 阈值。WSL 冷启动可能数秒才出首帧，给宽限。 */
const DEFAULT_STARTUP_WATCHDOG_MS = 8000;

export async function createSession(
  opts: CreateSessionOptions,
): Promise<PtySessionHandle> {
  // Callbacks/state are mutable so a pane that remounts (e.g. after a tab
  // switch) can re-subscribe and recover the badge without respawning.
  let callbacks = opts.callbacks;
  let state: SessionState = "connecting";
  let exitCode: number | undefined;
  let pendingOsc = "";

  // pty_open 的 authorize_spawn_cwd 会校验 cwd 是否落在已授权工作区内。
  // 冷启动时 source-control 的 workspaceAuthorize 可能尚未完成,导致首个
  // 终端的 pty_open 被拒、term.onData 永不绑定、面板静默卡死。这里在开
  // PTY 前显式授权一次(幂等),失败则交由 pty_open 的 authorize_spawn_cwd
  // 给出精确错误,因此静默忽略此处错误。
  if (opts.cwd) {
    try {
      await opts.wsNative.workspaceAuthorize(opts.cwd);
    } catch {
      /* 交由 pty_open 报错 */
    }
  }
  // 启动 watchdog：PTY 打开后若既无输出也未退出，视为 shell 假死
  // （WSL 冷启动时 wsl.exe 创建成功但 shell 半启动、reader 永久阻塞）。
  // 正常 shell 首帧毫秒级到达，首次 onData 即清除此定时器，零开销。
  let receivedData = false;
  let startWatchdog: ReturnType<typeof setTimeout> | null = null;
  const clearStartWatchdog = () => {
    if (startWatchdog !== null) {
      clearTimeout(startWatchdog);
      startWatchdog = null;
    }
  };

  // PTY 输出批处理：高吞吐命令（pnpm install / cargo build）会在一次
  // event-loop tick 里推多个 chunk 到前端，每个 chunk 直接 term.write 会
  // 触发一次 reflow + paint，导致帧时间被反复打满。这里把 cleaned 累积
  // 到 microtask 边界一并写入：xterm 内部本就是 batched（其 write 也会
  // 排队），所以行为对外仍等价——只是把 N 次 write 折叠成 1 次。
  let pendingWrite: string | null = null;
  let writeScheduled = false;
  const flushPendingWrite = () => {
    writeScheduled = false;
    const data = pendingWrite;
    pendingWrite = null;
    if (data) opts.term.write(data);
  };
  const enqueueWrite = (data: string) => {
    if (!data) return;
    pendingWrite = (pendingWrite ?? "") + data;
    if (writeScheduled) return;
    writeScheduled = true;
    queueMicrotask(flushPendingWrite);
  };

  const pty = await opts.wsNative.ptyOpen(
    opts.term.cols,
    opts.term.rows,
    {
      onData: (chunk) => {
        if (!receivedData) {
          receivedData = true;
          clearStartWatchdog();
        }
        const { cleaned, events, pendingBuffer } = handleOscData(
          chunk,
          pendingOsc,
        );
        pendingOsc = pendingBuffer;
        for (const ev of events) emitOsc(ev, callbacks);
        enqueueWrite(cleaned);
      },
      onExit: (code) => {
        clearStartWatchdog();
        state = "exited";
        exitCode = code;
        callbacks.onStateChange("exited", code);
      },
    },
    opts.cwd,
  );
  // PTY 打开成功后挂上 watchdog（仅当上层关心假死时）。
  if (opts.onDeadStart) {
    startWatchdog = setTimeout(() => {
      if (!receivedData && (state as SessionState) !== "exited") {
        console.warn(
          "[pty] startup watchdog: shell produced no output within " +
            `${opts.watchdogMs ?? DEFAULT_STARTUP_WATCHDOG_MS}ms, ` +
            "treating as dead start (common on WSL cold boot)",
        );
        clearStartWatchdog();
        void pty.close().catch((e) => {
          console.debug("[pty] close dropped during dead-start", e);
        });
        opts.onDeadStart?.();
      }
    }, opts.watchdogMs ?? DEFAULT_STARTUP_WATCHDOG_MS);
  }
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
      clearStartWatchdog();
      // dispose 前必须把已 enqueue 但尚未 flush 的数据排干，否则最后一段
      // 输出会随 xterm 一起被销毁。flushPendingWrite 走 microtask，这里
      // 同步调用一次保证 term 还没 dispose 前已写入。
      flushPendingWrite();
      void pty.close().catch((e) => {
        console.debug("[pty] close dropped", e);
      });
    },
    write: (data) => {
      void pty.write(data).catch((e) => {
        console.debug("[pty] write dropped", e);
      });
    },
    resize: (cols, rows) => {
      void pty.resize(cols, rows).catch((e) => {
        console.debug("[pty] resize dropped", e);
      });
    },
    restart: () => {
      // ptyKill lives on the global native surface (id-keyed, not env-scoped)
      // but we intentionally avoid importing the singleton here; the pane owns
      // restart via its own channel if needed. Kept as best-effort no-op
      // fallback for legacy callers.
      void pty.close().catch((e) => {
        console.debug("[pty] close dropped (restart)", e);
      });
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
