import { perfBackendSnapshot, perfConfig, perfWriteReport } from "@/lib/native";
import { perfRecorder } from "./perfRecorder";
import { installProbes } from "./perfProbes";

/** 自动落盘间隔（毫秒）。 */
const FLUSH_INTERVAL_MS = 15_000;

let booted = false;
let flushTimer: number | null = null;
let uninstallProbes: (() => void) | null = null;
let flushing: Promise<void> | null = null;

/**
 * 启动性能录制会话。
 *
 * 只有后端确认"录制态"（进程带 `NEXTERM_PERF_DIR` 环境变量或
 * `--perf-dir=` 参数启动）才会真正开始采集；否则这里什么都不做，
 * 生产构建的开销是一次 IPC 往返。
 */
export async function bootPerfSession(): Promise<void> {
  if (booted) return;
  booted = true;
  try {
    const config = await perfConfig();
    if (!config?.enabled) return;
    perfRecorder.enable(config.sessionId);
    uninstallProbes = installProbes(perfRecorder);
    flushTimer = window.setInterval(() => {
      void flushPerfSession();
    }, FLUSH_INTERVAL_MS);
    window.addEventListener("pagehide", handlePageHide);
    document.addEventListener("visibilitychange", handleVisibilityChange);
    console.info(
      `[perf] recording started (session ${config.sessionId}), flush every ${FLUSH_INTERVAL_MS / 1000}s`,
    );
    await flushPerfSession();
  } catch (error: unknown) {
    console.info("[perf] session unavailable:", error);
  }
}

/**
 * 把当前快照写进会话目录。
 *
 * 前端不直接碰文件系统：报告由 Rust 侧的 `perf_write_report` 落盘，
 * 写死的文件名 + 白名单，webview 无法借此写任意路径。
 */
export async function flushPerfSession(): Promise<void> {
  if (!perfRecorder.enabled) return;
  if (flushing) return flushing;
  flushing = (async () => {
    try {
      const frontend = perfRecorder.buildReport();
      await perfWriteReport("frontend", JSON.stringify(frontend));
      const backend = await perfBackendSnapshot();
      await perfWriteReport("backend", JSON.stringify(backend));
    } catch (error: unknown) {
      console.warn("[perf] flush failed:", error);
    } finally {
      flushing = null;
    }
  })();
  return flushing;
}

/** 停止录制并落盘最后一份快照。 */
export async function stopPerfSession(): Promise<void> {
  if (flushTimer !== null) {
    window.clearInterval(flushTimer);
    flushTimer = null;
  }
  window.removeEventListener("pagehide", handlePageHide);
  document.removeEventListener("visibilitychange", handleVisibilityChange);
  uninstallProbes?.();
  uninstallProbes = null;
  await flushPerfSession();
}

function handlePageHide(): void {
  void flushPerfSession();
}

function handleVisibilityChange(): void {
  if (document.visibilityState === "hidden") {
    void flushPerfSession();
  }
}
