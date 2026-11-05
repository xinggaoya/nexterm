import type {
  BootStage,
  CommandStat,
  FrameBucket,
  FrontendReport,
  IpcSample,
  LongTaskSample,
  MemorySample,
  PerfCounters,
  WebVitals,
} from "./perfTypes";

/** 每个命令保留的耗时样本上限，超出后做 1/2 降采样。 */
const MAX_DURATION_SAMPLES = 1024;
/** 报告里保留的最慢 IPC 明细条数。 */
const MAX_SLOWEST_IPC = 100;
/** 报告里保留的最长任务条数。 */
const MAX_LONG_TASKS = 300;
/** 帧桶保留上限（1s 一桶，≈1 小时）。 */
const MAX_FRAME_BUCKETS = 3600;
/** 内存采样保留上限（5s 一采，≈50 分钟）。 */
const MAX_MEMORY_SAMPLES = 600;
/** 错误摘要截断长度。 */
const MAX_ERROR_CHARS = 200;

function round2(value: number): number {
  return Math.round(value * 100) / 100;
}

/** 单调时钟（毫秒）。Node 测试环境没有 performance 时退回 Date.now。 */
function nowMs(): number {
  if (typeof performance !== "undefined" && typeof performance.now === "function") {
    return performance.now();
  }
  return Date.now();
}

/**
 * 流式分位数累加器。
 *
 * 保留最近 N 个样本计算分位数；超过上限时按 1/2 抽样降采样
 * （保留偶数位），并把降采样倍率翻倍。这样长时间录制时内存占用
 * 恒定，代价是分位数变成近似值——用于定位热点足够，且会随样本量
 * 在报告里标注。
 */
export class DurationAccumulator {
  private samples: number[] = [];
  private decimation = 1;
  count = 0;
  totalMs = 0;
  maxMs = 0;

  add(durationMs: number): void {
    this.count += 1;
    this.totalMs += durationMs;
    if (durationMs > this.maxMs) this.maxMs = durationMs;
    this.samples.push(durationMs);
    if (this.samples.length > MAX_DURATION_SAMPLES) {
      const kept: number[] = [];
      for (let index = 0; index < this.samples.length; index += 1) {
        if (index % 2 === 0) kept.push(this.samples[index]);
      }
      this.samples = kept;
      this.decimation *= 2;
    }
  }

  /** 采样精度：1 表示全量，越大说明做过降采样。 */
  get precision(): number {
    return this.decimation;
  }

  percentile(fraction: number): number {
    if (this.samples.length === 0) return 0;
    const sorted = [...this.samples].sort((a, b) => a - b);
    const index = Math.min(
      sorted.length - 1,
      Math.max(0, Math.floor(fraction * sorted.length)),
    );
    return sorted[index];
  }
}

/** 单个命令的聚合状态。 */
class CommandAccumulator {
  private readonly durations = new DurationAccumulator();
  errors = 0;

  add(durationMs: number, ok: boolean): void {
    this.durations.add(durationMs);
    if (!ok) this.errors += 1;
  }

  toStat(cmd: string): CommandStat {
    return {
      cmd,
      count: this.durations.count,
      errors: this.errors,
      totalMs: round2(this.durations.totalMs),
      p50Ms: round2(this.durations.percentile(0.5)),
      p95Ms: round2(this.durations.percentile(0.95)),
      p99Ms: round2(this.durations.percentile(0.99)),
      maxMs: round2(this.durations.maxMs),
    };
  }
}

function pushCapped<T>(list: T[], item: T, max: number): void {
  list.push(item);
  if (list.length > max) list.splice(0, list.length - max);
}

/**
 * 性能采集核心。
 *
 * 设计要点：
 * - **默认关闭**：`enabled` 为 false 时所有 record* 方法立即返回，
 *   生产构建的开销只有一次布尔判断。
 * - **内存有界**：所有明细都是定长环形缓冲，报告大小与录制时长无关。
 * - **时间基准统一**：`performance.now()` 相对会话开始，跨进程可比。
 */
export class PerfRecorder {
  /** 时间基准：模块被 import 的时刻。启动打点以此为 0。 */
  private readonly originAt: number = nowMs();
  /** 录制起点：enable() 被调用的时刻。采样时间戳以此为 0。 */
  private enabledAt = 0;
  private active = false;
  private sessionId = "";
  private startedAtEpochMs = 0;
  private readonly commands = new Map<string, CommandAccumulator>();
  private readonly slowestIpc: IpcSample[] = [];
  private readonly longTasks: LongTaskSample[] = [];
  private readonly frameBuckets: FrameBucket[] = [];
  private currentFrameBucket: FrameBucket | null = null;
  private readonly memorySamples: MemorySample[] = [];
  private readonly bootStages: BootStage[] = [];  private readonly counters: PerfCounters = {
    ptyChunks: 0,
    ptyBytes: 0,
    fsEvents: 0,
    fsPaths: 0,
    gitStatusCount: 0,
    gitStatusMs: 0,
  };
  private vitals: WebVitals = { lcpMs: null, cls: null, inpMs: null };
  private ipcTotal = 0;
  private ipcErrors = 0;
  private ipcTotalMs = 0;
  private longTaskTotalMs = 0;
  private droppedFrames = 0;
  private longFrameTotal = 0;

  get enabled(): boolean {
    return this.active;
  }

  get session(): string {
    return this.sessionId;
  }

  /** 打开采集。`sessionId` 用于把多次录制的报告关联起来。 */
  enable(sessionId: string): void {
    this.active = true;
    this.sessionId = sessionId;
    this.startedAtEpochMs = Date.now();
    this.enabledAt = nowMs();
  }

  /** 清空所有采集状态（测试用）。 */
  reset(): void {
    this.active = false;
    this.sessionId = "";
    this.startedAtEpochMs = 0;
    this.enabledAt = 0;
    this.commands.clear();
    this.slowestIpc.length = 0;
    this.longTasks.length = 0;
    this.frameBuckets.length = 0;
    this.currentFrameBucket = null;
    this.memorySamples.length = 0;
    this.bootStages.length = 0;
    this.counters.ptyChunks = 0;
    this.counters.ptyBytes = 0;
    this.counters.fsEvents = 0;
    this.counters.fsPaths = 0;
    this.counters.gitStatusCount = 0;
    this.counters.gitStatusMs = 0;
    this.vitals = { lcpMs: null, cls: null, inpMs: null };
    this.ipcTotal = 0;
    this.ipcErrors = 0;
    this.ipcTotalMs = 0;
    this.longTaskTotalMs = 0;
    this.droppedFrames = 0;
    this.longFrameTotal = 0;
  }

  /** 相对模块加载时刻的毫秒数（未开启采集时也可用，用于启动打点）。 */
  now(): number {
    return Math.max(0, nowMs() - this.originAt);
  }

  /** 相对录制起点的毫秒数（采样时间戳用这个）。 */
  recordingNow(): number {
    return this.active ? Math.max(0, nowMs() - this.enabledAt) : 0;
  }

  markBoot(stage: string): void {
    pushCapped(this.bootStages, { stage, atMs: round2(this.now()) }, 32);
  }

  recordIpc(cmd: string, durationMs: number, ok: boolean, error?: unknown): void {
    if (!this.active) return;
    this.ipcTotal += 1;
    this.ipcTotalMs += durationMs;
    if (!ok) this.ipcErrors += 1;
    const accumulator = this.commands.get(cmd) ?? new CommandAccumulator();
    accumulator.add(durationMs, ok);
    this.commands.set(cmd, accumulator);
    const sample: IpcSample = {
      cmd,
      durationMs: round2(durationMs),
      ok,
      startedAtMs: round2(this.recordingNow() - durationMs),
    };
    if (!ok) {
      sample.error = String((error as { message?: string } | undefined)?.message ?? error ?? "")
        .slice(0, MAX_ERROR_CHARS);
    }
    this.slowestIpc.push(sample);
    // 只保留最慢的 N 条：超出时丢弃当前最小的那条（O(n)，不排序）。
    if (this.slowestIpc.length > MAX_SLOWEST_IPC) {
      let minIndex = 0;
      for (let index = 1; index < this.slowestIpc.length; index += 1) {
        if (this.slowestIpc[index].durationMs < this.slowestIpc[minIndex].durationMs) {
          minIndex = index;
        }
      }
      this.slowestIpc.splice(minIndex, 1);
    }
  }

  recordLongTask(durationMs: number, name: string): void {
    if (!this.active) return;
    this.longTaskTotalMs += durationMs;
    this.longTasks.push({
      startedAtMs: round2(this.recordingNow() - durationMs),
      durationMs: round2(durationMs),
      name,
    });
    // 同上：只留最长的 N 条。
    if (this.longTasks.length > MAX_LONG_TASKS) {
      let minIndex = 0;
      for (let index = 1; index < this.longTasks.length; index += 1) {
        if (this.longTasks[index].durationMs < this.longTasks[minIndex].durationMs) {
          minIndex = index;
        }
      }
      this.longTasks.splice(minIndex, 1);
    }
  }

  /** 记录一帧的间隔（毫秒）。 */
  recordFrame(frameMs: number): void {
    if (!this.active) return;
    const bucketStart = Math.floor(this.recordingNow() / 1000) * 1000;
    let bucket = this.currentFrameBucket;
    if (!bucket || bucket.startedAtMs !== bucketStart) {
      bucket = {
        startedAtMs: bucketStart,
        frames: 0,
        longFrames: 0,
        maxFrameMs: 0,
        totalFrameMs: 0,
      };
      this.currentFrameBucket = bucket;
      pushCapped(this.frameBuckets, bucket, MAX_FRAME_BUCKETS);
    }
    bucket.frames += 1;
    bucket.totalFrameMs += frameMs;
    if (frameMs > bucket.maxFrameMs) bucket.maxFrameMs = frameMs;
    if (frameMs >= 50) {
      bucket.longFrames += 1;
      this.longFrameTotal += 1;
      this.droppedFrames += 1;
    }
  }

  recordMemory(sample: Omit<MemorySample, "atMs">): void {
    if (!this.active) return;
    pushCapped(
      this.memorySamples,
      { atMs: round2(this.recordingNow()), ...sample },
      MAX_MEMORY_SAMPLES,
    );
  }

  setLcp(valueMs: number): void {
    if (!this.active) return;
    this.vitals.lcpMs = round2(valueMs);
  }

  addCls(value: number): void {
    if (!this.active) return;
    this.vitals.cls = round2((this.vitals.cls ?? 0) + value);
  }

  setInp(valueMs: number): void {
    if (!this.active) return;
    if (this.vitals.inpMs === null || valueMs > this.vitals.inpMs) {
      this.vitals.inpMs = round2(valueMs);
    }
  }

  countPtyChunk(bytes: number): void {
    if (!this.active) return;
    this.counters.ptyChunks += 1;
    this.counters.ptyBytes += bytes;
  }

  countFsEvent(pathCount: number): void {
    if (!this.active) return;
    this.counters.fsEvents += 1;
    this.counters.fsPaths += pathCount;
  }

  countGitStatus(durationMs: number): void {
    if (!this.active) return;
    this.counters.gitStatusCount += 1;
    this.counters.gitStatusMs += durationMs;
  }

  /** 生成前端报告快照。 */
  buildReport(): FrontendReport {
    const byCommand = [...this.commands.entries()]
      .map(([cmd, accumulator]) => accumulator.toStat(cmd))
      .sort((a, b) => b.totalMs - a.totalMs);
    const memoryPeak = this.memorySamples.reduce<number | null>((peak, sample) => {
      if (sample.usedJsHeapMb === null) return peak;
      return peak === null ? sample.usedJsHeapMb : Math.max(peak, sample.usedJsHeapMb);
    }, null);
    const domPeak = this.memorySamples.reduce<number | null>((peak, sample) => {
      if (sample.domNodes === null) return peak;
      return peak === null ? sample.domNodes : Math.max(peak, sample.domNodes);
    }, null);
    return {
      schema: "nexterm-perf/1",
      kind: "frontend",
      sessionId: this.sessionId,
      startedAtMs: this.startedAtEpochMs,
      endedAtMs: Date.now(),
      durationMs: round2(this.recordingNow()),
      app: {
        userAgent: typeof navigator === "undefined" ? "" : navigator.userAgent,
        platform: typeof navigator === "undefined" ? "" : navigator.platform,
        hardwareConcurrency:
          typeof navigator === "undefined" ? null : (navigator.hardwareConcurrency ?? null),
        devicePixelRatio:
          typeof window === "undefined" ? null : (window.devicePixelRatio ?? null),
      },
      boot: {
        stages: [...this.bootStages],
        navigation: readNavigationTiming(),
      },
      ipc: {
        total: this.ipcTotal,
        errors: this.ipcErrors,
        totalMs: round2(this.ipcTotalMs),
        byCommand,
        slowest: [...this.slowestIpc].sort((a, b) => b.durationMs - a.durationMs),
      },
      longTasks: {
        count: this.longTasks.length,
        totalMs: round2(this.longTaskTotalMs),
        worst: [...this.longTasks].sort((a, b) => b.durationMs - a.durationMs),
      },
      frames: {
        buckets: [...this.frameBuckets],
        droppedTotal: this.droppedFrames,
        longFrameTotal: this.longFrameTotal,
      },
      memory: {
        samples: [...this.memorySamples],
        peakUsedJsHeapMb: memoryPeak === null ? null : round2(memoryPeak),
        peakDomNodes: domPeak,
      },
      vitals: { ...this.vitals },
      counters: { ...this.counters },
    };
  }
}

/** 读取 Navigation Timing（冷启动关键指标）。 */
function readNavigationTiming(): Record<string, number> | null {
  if (typeof performance === "undefined") return null;
  const entries = performance.getEntriesByType?.("navigation") as
    | PerformanceNavigationTiming[]
    | undefined;
  const entry = entries?.[0];
  if (!entry) return null;
  return {
    responseStart: Math.round(entry.responseStart),
    domContentLoaded: Math.round(entry.domContentLoadedEventEnd),
    loadEventEnd: Math.round(entry.loadEventEnd),
    domInteractive: Math.round(entry.domInteractive),
    transferSize: entry.transferSize ?? 0,
  };
}

/** 全局采集器单例。 */
export const perfRecorder = new PerfRecorder();
