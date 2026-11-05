/**
 * 性能录制报告的数据契约。
 *
 * 这份形状同时被三处消费，改动必须同步：
 * - 前端采集器 `perfRecorder.ts`（产出）
 * - Rust 后端 `src-tauri/src/modules/perf/`（产出 backend 侧）
 * - 分析脚本 `tools/perf/analyze.mjs`（消费）
 *
 * 字段名统一用 camelCase：Rust 侧通过 `#[serde(rename_all = "camelCase")]`
 * 对齐，Node 侧直接 `JSON.parse` 即可。
 */

/** 单次 IPC 调用的采样。 */
export type IpcSample = {
  /** Tauri 命令名，例如 `git_status`。 */
  cmd: string;
  /** 前端观测到的往返耗时（毫秒）。 */
  durationMs: number;
  /** 是否成功返回。 */
  ok: boolean;
  /** 相对会话开始的发起时刻（毫秒）。 */
  startedAtMs: number;
  /** 失败时的错误摘要（已截断）。 */
  error?: string;
};

/** 单个命令的耗时聚合。 */
export type CommandStat = {
  cmd: string;
  count: number;
  errors: number;
  totalMs: number;
  p50Ms: number;
  p95Ms: number;
  p99Ms: number;
  maxMs: number;
};

/** 主线程长任务（>50ms）。 */
export type LongTaskSample = {
  startedAtMs: number;
  durationMs: number;
  name: string;
};

/** 1 秒一桶的帧统计。 */
export type FrameBucket = {
  startedAtMs: number;
  frames: number;
  /** 单帧超过 50ms 的次数。 */
  longFrames: number;
  maxFrameMs: number;
  totalFrameMs: number;
};

/** 内存采样（Chromium 才有 JS 堆信息）。 */
export type MemorySample = {
  atMs: number;
  usedJsHeapMb: number | null;
  totalJsHeapMb: number | null;
  domNodes: number | null;
};

/** 启动阶段打点。 */
export type BootStage = {
  stage: string;
  /** 相对会话开始的时刻（毫秒）。 */
  atMs: number;
};

/** 与 `src/lib/perf.ts` 同源的计数器。 */
export type PerfCounters = {
  ptyChunks: number;
  ptyBytes: number;
  fsEvents: number;
  fsPaths: number;
  gitStatusCount: number;
  gitStatusMs: number;
};

/** Web Vitals 摘要。 */
export type WebVitals = {
  lcpMs: number | null;
  cls: number | null;
  /** 近似 INP：观察到的最长一次交互耗时。 */
  inpMs: number | null;
};

/** 前端报告。 */
export type FrontendReport = {
  schema: "nexterm-perf/1";
  kind: "frontend";
  sessionId: string;
  /** 会话开始的 epoch 毫秒。 */
  startedAtMs: number;
  /** 会话结束的 epoch 毫秒。 */
  endedAtMs: number;
  /** 录制时长（毫秒，相对会话开始）。 */
  durationMs: number;
  app: {
    userAgent: string;
    platform: string;
    hardwareConcurrency: number | null;
    devicePixelRatio: number | null;
  };
  boot: {
    stages: BootStage[];
    navigation: Record<string, number> | null;
  };
  ipc: {
    total: number;
    errors: number;
    totalMs: number;
    byCommand: CommandStat[];
    slowest: IpcSample[];
  };
  longTasks: {
    count: number;
    totalMs: number;
    worst: LongTaskSample[];
  };
  frames: {
    buckets: FrameBucket[];
    droppedTotal: number;
    longFrameTotal: number;
  };
  memory: {
    samples: MemorySample[];
    peakUsedJsHeapMb: number | null;
    peakDomNodes: number | null;
  };
  vitals: WebVitals;
  counters: PerfCounters;
};

/** 后端单命令聚合（Rust 侧产出）。 */
export type BackendCommandStat = {
  cmd: string;
  count: number;
  errors: number;
  totalMs: number;
  p50Ms: number;
  p95Ms: number;
  maxMs: number;
};

/** 后端报告（Rust 侧产出，由前端落盘）。 */
export type BackendReport = {
  schema: string;
  kind: string;
  sessionId: string;
  startedAtMs: number;
  endedAtMs: number;
  app: {
    version: string;
    os: String;
    arch: String;
  };
  commands: BackendCommandStat[];
  slowest: BackendCommandStat[];
  totalRecordedMs: number;
};
