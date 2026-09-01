/**
 * Dev-only perf counter。开发模式 1s 打印一次各热点指标,
 * 用来定位"CPU 70% 时谁在涨"。
 *
 * 使用方式:
 *   import { recordPtyChunk, recordFsEvent, recordGitStatus } from "@/lib/perf";
 *   recordPtyChunk(bytes);
 *   recordFsEvent(paths.length);
 *   recordGitStatus(durationMs);
 *
 * 指标:
 *   - ptyChunks / ptyBytes: 终端 PTY chunk 数量 / 字节数
 *   - fsEvents / fsPaths:  FS watcher 事件数 / 路径总数
 *   - gitStatusCount / gitStatusMs: git status 调用次数 / 累计耗时
 *
 * 生产构建 (`process.env.NODE_ENV === "production"`) 走 stub,零开销。
 */

let ptyChunkCount = 0;
let ptyBytes = 0;
let fsEventCount = 0;
let fsPathCount = 0;
let gitStatusCount = 0;
let gitStatusMs = 0;
let startTickAt = Date.now();
let timerId: ReturnType<typeof setInterval> | null = null;

function isDev(): boolean {
  return process.env.NODE_ENV !== "production";
}

function flushAndReset(): void {
  if (!isDev()) return;
  const elapsedMs = Date.now() - startTickAt;
  if (
    ptyChunkCount === 0 &&
    ptyBytes === 0 &&
    fsEventCount === 0 &&
    fsPathCount === 0 &&
    gitStatusCount === 0
  ) {
    startTickAt = Date.now();
    return;
  }
  // 简单格式化,避免 devtools 噪音
  // eslint-disable-next-line no-console
  console.debug(
    `[perf ${elapsedMs}ms]`,
    "pty:",
    `${ptyChunkCount} chunks / ${(ptyBytes / 1024).toFixed(1)} KB`,
    "fs:",
    `${fsEventCount} events / ${fsPathCount} paths`,
    "git:",
    `${gitStatusCount} status / ${gitStatusMs.toFixed(0)} ms`,
  );
  ptyChunkCount = 0;
  ptyBytes = 0;
  fsEventCount = 0;
  fsPathCount = 0;
  gitStatusCount = 0;
  gitStatusMs = 0;
  startTickAt = Date.now();
}

function ensureTimer(): void {
  if (timerId !== null) return;
  if (typeof window === "undefined") return;
  timerId = setInterval(flushAndReset, 1000);
}

/**
 * 记录一次 PTY 接收到的 chunk (含字节数)。
 * 注意:PTY 端已经做了 8ms 时间窗合并,所以一个 chunk 可能包含
 * 多个 16KB 块,实际字节数会比原始 read 块大几倍。
 */
export function recordPtyChunk(bytes: number): void {
  if (!isDev()) return;
  ptyChunkCount += 1;
  ptyBytes += bytes;
  ensureTimer();
}

/**
 * 记录一次 FS 事件(含路径数)。
 * 一个 fsEvent 可能 paths.length = 0(根刷新)或数百(大批量写)。
 */
export function recordFsEvent(pathCount: number): void {
  if (!isDev()) return;
  fsEventCount += 1;
  fsPathCount += pathCount;
  ensureTimer();
}

/**
 * 记录一次 git status 调用的耗时。
 */
export function recordGitStatus(durationMs: number): void {
  if (!isDev()) return;
  gitStatusCount += 1;
  gitStatusMs += durationMs;
  ensureTimer();
}
