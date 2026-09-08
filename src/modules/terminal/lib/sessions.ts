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
import { recordPtyChunk } from "@/lib/perf";
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
  /**
   * 重新把 PTY 桥接到一个新的 xterm 实例。
   *
   * 当 TerminalPane 因 split / close-leaf 触发的结构变化而 remount 时,
   * 旧 xterm 已被 dispose,新 xterm 需要接管 PTY 的输出,并把新 xterm
   * 的用户输入重新接回 PTY。PTY 进程本身保持不变,session 状态、cwd、
   * title、scrollback、history 全部保留。dispose 之后调用是安全的(no-op)。
   */
  rebindTerm: (term: Terminal) => void;
  /**
   * 同步 flush 待写入的 PTY 数据到 xterm。返回是否实际 flush 了数据。
   *
   * 在以下场景必须调用,否则用户会看到"内容缺失,等下一波数据才补出":
   * - workspace 从 v-show 隐藏切回可见:canvas 在隐藏期间被跳过绘制,
   *   但 xterm.buffer 一直在累积 PTY 输出;切回时必须先 flush 再 redraw,
   *   这样 redraw 看到的就是最新 buffer。
   * - pane 容器从 display:none 切回可见(同上一条)
   * - 切到目标 pane 准备 redraw 之前
   *
   * 并发语义:实现是"检查 `pendingChunks` 长度,非空则调
   * `flushPendingWrite` 同步写"。与 enqueueWrite 排到 rAF 的 flush
   * 是竞态友好的 —— `flushPendingWrite` 内部会把 `writeScheduled` 复位,
   * 之后 rAF 回调里的 flush 是空操作(pendingChunks 已空)。
   * 但调用方**不应**假设"flush 后下一帧之前不会再来新数据":
   * flush 之后 PTY 仍可能继续到,enqueueWrite 会再排 rAF,这是预期
   * 行为,不是 bug。简言之:flushPendingData 是"把当前累计的 batch
   * 立即落盘",不是"独占 flush 通道"。
   *
   * dispose / rebindTerm 内部已经调用过 flush,无需重复。
   */
  flushPendingData: () => boolean;
}

interface CreateSessionOptions {
  term: Terminal;
  cwd?: string;
  callbacks: SessionCallbacks;
  /** Env-bound native surface for the workspace owning this session. */
  wsNative: WorkspaceNative;
  /**
   * 本地终端的 shell profile id（后端探测白名单内）。"auto" / 未传 =
   * 后端历史默认顺序（pwsh → Windows PowerShell → CMD）。仅本地环境
   * 生效；WSL / SSH 有各自的登录 shell 逻辑。只影响新开的 PTY。
   */
  shellProfileId?: string;
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
  // 到一帧边界（rAF）一并写入：xterm 内部本就是 batched（其 write 也会
  // 排队），所以行为对外仍等价——只是把 N 次 write 折叠成 1 次/帧。
  //
  // 重要：必须用 Array.join 而非字符串拼接。后者在快速多 chunk 到达时
  // 是 O(n) 复制；Array.join 只在最后一次性 join 一次。
  //
  // 重要：必须在生命周期事件（rebindTerm / dispose / workspace 切回）
  // 显式调用 flushPendingWrite 同步刷出。否则：
  // - 切走 workspace：rAF 在隐藏 tab 仍会触发，但 webview 不可见期间
  //   xterm.buffer 持续累积；切回时 redraw 即可，无需 flush
  // - rebindTerm：旧 xterm 即将被 dispose，未 flush 的数据丢失
  // - 切回 workspace 时如果 PendingData 存在，renderer.fit + redraw 之前
  //   也应该 flush（redraw 画 canvas 不会更新 buffer，必须先 write）
  //
  // currentTerm / inputDisposable 是可变的：split / close-leaf 会导致
  // TerminalPane remount，xterm 被 dispose，新 xterm 通过 rebindTerm
  // 接管。PTY 进程不变，只换 xterm 桥接。
  let currentTerm: Terminal = opts.term;
  let inputDisposable: { dispose: () => void } | null = null;
  const pendingChunks: string[] = [];
  let writeScheduled = false;
  const flushPendingWrite = () => {
    writeScheduled = false;
    if (pendingChunks.length === 0) return;
    // 一次性合并所有 chunk 并写入。Array.join 比循环 += 少 N-1 次分配。
    const merged = pendingChunks.join("");
    pendingChunks.length = 0;
    currentTerm.write(merged);
  };
  const enqueueWrite = (data: string) => {
    if (!data) return;
    pendingChunks.push(data);
    if (writeScheduled) return;
    writeScheduled = true;
    // 优先 rAF(让 xterm.write 与一帧对齐),测试环境(jsdom)无 rAF
    // 时回退到 setTimeout 0,保持语义"异步 flush"。setTimeout 在
    // 浏览器返回 number、在 Node 返回 Timeout,统一 cast 成 number
    // 满足 rAF 签名。
    const raf =
      typeof globalThis.requestAnimationFrame === "function"
        ? globalThis.requestAnimationFrame.bind(globalThis)
        : (cb: FrameRequestCallback): number => {
            const id = setTimeout(() => cb(performance.now()), 0);
            return id as unknown as number;
          };
    raf(flushPendingWrite);
  };

  const pty = await opts.wsNative.ptyOpen(
    currentTerm.cols,
    currentTerm.rows,
    {
      onData: (chunk) => {
        recordPtyChunk(chunk.length);
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
    opts.shellProfileId,
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
      // 输出会随 xterm 一起被销毁。flushPendingWrite 是同步的，这里直接
      // 调用一次保证 term 还没 dispose 前已写入。
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
    flushPendingData: (): boolean => {
      if (pendingChunks.length === 0) return false;
      flushPendingWrite();
      return true;
    },
    rebindTerm: (next) => {
      if (next === currentTerm) return;
      // 先把旧 xterm 的输入订阅解绑，避免双订阅导致用户键入被 PTY
      // 收到双份（在测试里就能直接看到 pty.write 被调用两次）。
      inputDisposable?.dispose();
      inputDisposable = null;
      // 把 pending chunks 排干到旧 xterm，再切换 currentTerm。这样切换前
      // 的最后一段 PTY 输出仍然完整落到旧 xterm 上，新 xterm 从下一批
      // PTY 数据开始接收，不会丢中间这段。
      flushPendingWrite();
      currentTerm = next;
      inputDisposable = next.onData((data) => handle.write(data));
    },
  };

  // 初次绑定：xterm 的 onData 返回 IDisposable，留作后续 rebind 解绑用。
  inputDisposable = opts.term.onData((data) => handle.write(data));

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
