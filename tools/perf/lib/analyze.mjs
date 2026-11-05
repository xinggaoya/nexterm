import { readFileSync, existsSync } from "node:fs";
import { join } from "node:path";

/**
 * 性能报告分析：把一次录制的原始数据汇总成可读结论。
 *
 * 输入（都在会话目录下）：
 * - `frontend.json`  前端采集（IPC / 长任务 / 帧率 / 内存）
 * - `backend.json`   后端命令耗时
 * - `os-samples.csv` 进程级 OS 指标
 *
 * 输出：
 * - `report.md`      人读报告
 * - `summary.json`   机器可读汇总
 */

const MB = 1024 * 1024;

function readJson(path) {
  if (!existsSync(path)) return null;
  try {
    return JSON.parse(readFileSync(path, "utf8"));
  } catch {
    return null;
  }
}

function readCsv(path) {
  if (!existsSync(path)) return [];
  const lines = readFileSync(path, "utf8").split(/\r?\n/).filter(Boolean);
  if (lines.length <= 1) return [];
  const header = lines[0].split(",");
  return lines.slice(1).map((line) => {
    const cells = line.split(",");
    const row = {};
    header.forEach((key, index) => {
      row[key] = cells[index] ?? "";
    });
    return row;
  });
}

function num(value, fallback = 0) {
  const parsed = Number(value);
  return Number.isFinite(parsed) ? parsed : fallback;
}

function formatMs(value) {
  if (value === null || value === undefined || !Number.isFinite(value)) return "-";
  if (value >= 1000) return `${(value / 1000).toFixed(2)}s`;
  return `${value.toFixed(1)}ms`;
}

function formatBytesMb(value) {
  if (value === null || value === undefined || !Number.isFinite(value)) return "-";
  return `${value.toFixed(1)}MB`;
}

function table(headers, rows) {
  if (rows.length === 0) return "_（无数据）_\n";
  const head = `| ${headers.join(" | ")} |`;
  const sep = `| ${headers.map(() => "---").join(" | ")} |`;
  const body = rows.map((row) => `| ${row.join(" | ")} |`).join("\n");
  return `${head}\n${sep}\n${body}\n`;
}

function analyzeOs(rows) {
  if (rows.length === 0) {
    return {
      samples: 0,
      peakCpuPercent: null,
      avgCpuPercent: null,
      peakWorkingSetMb: null,
      peakPrivateMb: null,
      peakThreads: null,
      peakHandles: null,
      byRole: {},
    };
  }
  const byRole = {};
  let peakCpuPercent = 0;
  let peakWorkingSetMb = 0;
  let peakPrivateMb = 0;
  let peakThreads = 0;
  let peakHandles = 0;
  const cpuSum = new Map();

  for (const row of rows) {
    const role = row.role || "unknown";
    const cpu = num(row.cpuPercent);
    const workingSet = num(row.workingSetMb);
    const privateMem = num(row.privateMb);
    const threads = num(row.threads);
    const handles = num(row.handles);
    const bucket = (byRole[role] ??= { samples: 0, cpuSum: 0, peakCpu: 0, peakWorkingSetMb: 0 });
    bucket.samples += 1;
    bucket.cpuSum += cpu;
    bucket.peakCpu = Math.max(bucket.peakCpu, cpu);
    bucket.peakWorkingSetMb = Math.max(bucket.peakWorkingSetMb, workingSet);
    cpuSum.set(role, (cpuSum.get(role) ?? 0) + cpu);
    peakCpuPercent = Math.max(peakCpuPercent, cpu);
    peakWorkingSetMb = Math.max(peakWorkingSetMb, workingSet);
    peakPrivateMb = Math.max(peakPrivateMb, privateMem);
    peakThreads = Math.max(peakThreads, threads);
    peakHandles = Math.max(peakHandles, handles);
  }

  for (const bucket of Object.values(byRole)) {
    bucket.avgCpu = bucket.samples > 0 ? bucket.cpuSum / bucket.samples : 0;
  }

  return {
    samples: rows.length,
    peakCpuPercent,
    avgCpuPercent:
      rows.length > 0
        ? rows.reduce((sum, row) => sum + num(row.cpuPercent), 0) / rows.length
        : null,
    peakWorkingSetMb,
    peakPrivateMb,
    peakThreads,
    peakHandles,
    byRole,
  };
}

function analyzeFrames(frontend) {
  const buckets = frontend?.frames?.buckets ?? [];
  if (buckets.length === 0) {
    return { buckets: 0, avgFps: null, worstWindow: null, droppedTotal: 0, longFrameTotal: 0 };
  }
  let frames = 0;
  let worst = null;
  for (const bucket of buckets) {
    frames += bucket.frames ?? 0;
    const fps = bucket.frames ?? 0;
    if (!worst || fps < worst.fps) {
      worst = { atMs: bucket.startedAtMs, fps, maxFrameMs: bucket.maxFrameMs };
    }
  }
  return {
    buckets: buckets.length,
    avgFps: Math.round((frames / buckets.length) * 10) / 10,
    worstWindow: worst,
    droppedTotal: frontend?.frames?.droppedTotal ?? 0,
    longFrameTotal: frontend?.frames?.longFrameTotal ?? 0,
  };
}

function analyzeMemory(frontend) {
  const samples = frontend?.memory?.samples ?? [];
  if (samples.length === 0) {
    return { samples: 0, firstHeapMb: null, lastHeapMb: null, peakHeapMb: null, peakDomNodes: null };
  }
  const heaps = samples
    .map((sample) => sample.usedJsHeapMb)
    .filter((value) => typeof value === "number");
  const domNodes = samples
    .map((sample) => sample.domNodes)
    .filter((value) => typeof value === "number");
  return {
    samples: samples.length,
    firstHeapMb: heaps[0] ?? null,
    lastHeapMb: heaps[heaps.length - 1] ?? null,
    peakHeapMb: heaps.length ? Math.max(...heaps) : null,
    peakDomNodes: domNodes.length ? Math.max(...domNodes) : null,
  };
}

function buildFindings(frontend, backend, os, frames, memory) {
  const findings = [];
  const commands = frontend?.ipc?.byCommand ?? [];
  const backendCommands = new Map((backend?.commands ?? []).map((stat) => [stat.cmd, stat]));

  for (const stat of commands.slice(0, 5)) {
    if (stat.p95Ms >= 200) {
      const backendStat = backendCommands.get(stat.cmd);
      const backendAvg =
        backendStat && backendStat.count > 0 ? backendStat.totalMs / backendStat.count : null;
      const frontendAvg = stat.count > 0 ? stat.totalMs / stat.count : 0;
      const gap =
        backendAvg === null
          ? "无后端埋点数据"
          : backendAvg >= frontendAvg * 0.7
            ? "后端耗时与前端往返接近 → 后端是瓶颈"
            : "后端耗时远小于前端往返 → 载荷/序列化或排队是瓶颈";
      findings.push(
        `**\`${stat.cmd}\`** p95 ${formatMs(stat.p95Ms)} / max ${formatMs(stat.maxMs)}（${stat.count} 次，均值 ${formatMs(frontendAvg)}），${gap}。`,
      );
    }
  }

  const longTaskTotal = frontend?.longTasks?.totalMs ?? 0;
  const sessionMs = Math.max(1, frontend?.durationMs ?? 0);
  if (longTaskTotal > 0 && longTaskTotal / sessionMs > 0.05) {
    findings.push(
      `主线程长任务累计 ${formatMs(longTaskTotal)}，占会话 ${((longTaskTotal / sessionMs) * 100).toFixed(1)}% —— 界面卡顿主要来自 JS 主线程阻塞。`,
    );
  }

  if (frames.longFrameTotal > 0) {
    findings.push(
      `掉帧（单帧 >50ms）共 ${frames.longFrameTotal} 次，最差 1s 窗口 ${frames.worstWindow?.fps ?? 0} 帧。`,
    );
  }

  if (
    memory.firstHeapMb !== null &&
    memory.lastHeapMb !== null &&
    memory.lastHeapMb - memory.firstHeapMb > 50
  ) {
    findings.push(
      `JS 堆从 ${formatBytesMb(memory.firstHeapMb)} 增长到 ${formatBytesMb(memory.lastHeapMb)}（+${formatBytesMb(memory.lastHeapMb - memory.firstHeapMb)}），疑似泄漏或缓存无上限。`,
    );
  }

  if (os.peakCpuPercent !== null && os.peakCpuPercent >= 80) {
    findings.push(
      `进程 CPU 峰值 ${os.peakCpuPercent.toFixed(1)}%（已按逻辑核数折算），持续高负载。`,
    );
  }

  if (backend && (backend.commands?.length ?? 0) > 0) {
    const top = backend.commands[0];
    findings.push(
      `后端累计耗时最高：\`${top.cmd}\` ${formatMs(top.totalMs)} / ${top.count} 次（p95 ${formatMs(top.p95Ms)}）。`,
    );
  }

  return findings;
}

/**
 * 分析一次录制会话。
 *
 * @param {string} sessionDir 会话目录
 * @returns {{ summary: object, markdown: string }}
 */
export function analyzeSession(sessionDir) {
  const frontend = readJson(join(sessionDir, "frontend.json"));
  const backend = readJson(join(sessionDir, "backend.json"));
  const osRows = readCsv(join(sessionDir, "os-samples.csv"));
  const os = analyzeOs(osRows);
  const frames = analyzeFrames(frontend);
  const memory = analyzeMemory(frontend);
  const findings = buildFindings(frontend, backend, os, frames, memory);

  const commands = frontend?.ipc?.byCommand ?? [];
  const slowest = frontend?.ipc?.slowest ?? [];
  const longTasks = frontend?.longTasks?.worst ?? [];
  const backendCommands = backend?.commands ?? [];

  const summary = {
    schema: "nexterm-perf-summary/1",
    sessionId: frontend?.sessionId ?? backend?.sessionId ?? null,
    generatedAt: new Date().toISOString(),
    frontend: frontend
      ? {
          ipcTotal: frontend.ipc?.total ?? 0,
          ipcErrors: frontend.ipc?.errors ?? 0,
          ipcTotalMs: frontend.ipc?.totalMs ?? 0,
          durationMs: frontend.durationMs ?? 0,
          commandCount: commands.length,
          longTaskCount: frontend.longTasks?.count ?? 0,
          longTaskTotalMs: frontend.longTasks?.totalMs ?? 0,
          counters: frontend.counters ?? null,
          boot: frontend.boot?.stages ?? [],
        }
      : null,
    backend: backend
      ? {
          commandCount: backendCommands.length,
          totalRecordedMs: backend.totalRecordedMs ?? 0,
        }
      : null,
    os: {
      samples: os.samples,
      peakCpuPercent: os.peakCpuPercent,
      avgCpuPercent: os.avgCpuPercent,
      peakWorkingSetMb: os.peakWorkingSetMb,
      peakPrivateMb: os.peakPrivateMb,
      peakThreads: os.peakThreads,
      peakHandles: os.peakHandles,
    },
    frames,
    memory,
    findings,
    topCommands: commands.slice(0, 10),
  };

  const lines = [];
  lines.push(`# 性能录制报告 · ${summary.sessionId ?? "unknown"}`);
  lines.push("");
  lines.push(`> 生成时间：${summary.generatedAt}`);
  lines.push("");

  if (!frontend && !backend) {
    lines.push("**没有找到任何报告文件** —— 应用可能没有以录制态启动（缺少 `NEXTERM_PERF_DIR`）。");
    lines.push("");
    return { summary, markdown: lines.join("\n") };
  }

  lines.push("## 概览");
  lines.push("");
  lines.push(
    table(
      ["指标", "值"],
      [
        ["IPC 调用总数", String(frontend?.ipc?.total ?? "-")],
        ["录制时长", formatMs(frontend?.durationMs ?? 0)],
        ["IPC 失败数", String(frontend?.ipc?.errors ?? "-")],
        ["IPC 累计往返", formatMs(frontend?.ipc?.totalMs ?? 0)],
        ["主线程长任务", `${frontend?.longTasks?.count ?? 0} 次 / ${formatMs(frontend?.longTasks?.totalMs ?? 0)}`],
        ["掉帧（>50ms）", String(frames.longFrameTotal)],
        ["平均 FPS", frames.avgFps === null ? "-" : String(frames.avgFps)],
        ["JS 堆峰值", formatBytesMb(memory.peakHeapMb ?? null)],
        ["DOM 节点峰值", memory.peakDomNodes === null ? "-" : String(memory.peakDomNodes)],
        ["进程 CPU 峰值", os.peakCpuPercent === null ? "-" : `${os.peakCpuPercent.toFixed(1)}%`],
        ["进程内存峰值（工作集）", formatBytesMb(os.peakWorkingSetMb)],
        ["线程数峰值", os.peakThreads === null ? "-" : String(os.peakThreads)],
        ["句柄数峰值", os.peakHandles === null || os.peakHandles === 0 ? "-" : String(os.peakHandles)],
      ],
    ),
  );

  lines.push("## 结论");
  lines.push("");
  if (findings.length === 0) {
    lines.push("_没有触发任何告警阈值。_");
  } else {
    for (const finding of findings) lines.push(`- ${finding}`);
  }
  lines.push("");

  lines.push("## 命令耗时（前端往返）");
  lines.push("");
  lines.push(
    table(
      ["命令", "次数", "p50", "p95", "max", "累计", "后端均耗时"],
      commands.slice(0, 20).map((stat) => {
        const backendStat = (backend?.commands ?? []).find((item) => item.cmd === stat.cmd);
        const backendAvg =
          backendStat && backendStat.count > 0
            ? formatMs(backendStat.totalMs / backendStat.count)
            : "-";
        return [
          `\`${stat.cmd}\``,
          String(stat.count),
          formatMs(stat.p50Ms),
          formatMs(stat.p95Ms),
          formatMs(stat.maxMs),
          formatMs(stat.totalMs),
          backendAvg,
        ];
      }),
    ),
  );

  lines.push("## 最慢的单次调用");
  lines.push("");
  lines.push(
    table(
      ["时刻(ms)", "命令", "耗时", "结果"],
      slowest.slice(0, 20).map((sample) => [
        String(sample.startedAtMs),
        `\`${sample.cmd}\``,
        formatMs(sample.durationMs),
        sample.ok ? "ok" : `error: ${sample.error ?? ""}`,
      ]),
    ),
  );

  lines.push("## 后端命令耗时");
  lines.push("");
  if (backendCommands.length === 0) {
    lines.push("_（没有后端埋点数据）_");
  } else {
    lines.push(
      table(
        ["命令", "次数", "p50", "p95", "max", "累计", "错误"],
        backendCommands.slice(0, 20).map((stat) => [
          `\`${stat.cmd}\``,
          String(stat.count),
          formatMs(stat.p50Ms),
          formatMs(stat.p95Ms),
          formatMs(stat.maxMs),
          formatMs(stat.totalMs),
          String(stat.errors ?? 0),
        ]),
      ),
    );
  }
  lines.push("");

  lines.push("## 主线程长任务 Top");
  lines.push("");
  lines.push(
    table(
      ["时刻(ms)", "时长", "来源"],
      longTasks.slice(0, 20).map((task) => [
        String(task.startedAtMs),
        formatMs(task.durationMs),
        task.name,
      ]),
    ),
  );

  lines.push("## 内存曲线");
  lines.push("");
  if (memory.samples === 0) {
    lines.push("_（无内存采样，WebView 非 Chromium 内核时没有 JS 堆信息）_");
  } else {
    lines.push(
      table(
        ["采样点", "时刻(ms)", "JS 堆", "DOM 节点"],
        (frontend?.memory?.samples ?? []).map((sample, index) => [
          `#${index + 1}`,
          String(sample.atMs),
          formatBytesMb(sample.usedJsHeapMb ?? null),
          sample.domNodes === null ? "-" : String(sample.domNodes),
        ]),
      ),
    );
  }
  lines.push("");

  lines.push("## 启动打点");
  lines.push("");
  lines.push(
    table(
      ["阶段", "时刻(ms)"],
      (frontend?.boot?.stages ?? []).map((stage) => [stage.stage, String(stage.atMs)]),
    ),
  );

  lines.push("## 计数器");
  lines.push("");
  const counters = frontend?.counters ?? {};
  lines.push(
    table(
      ["指标", "值"],
      [
        ["PTY chunk 数", String(counters.ptyChunks ?? 0)],
        ["PTY 字节数", String(counters.ptyBytes ?? 0)],
        ["FS 事件数", String(counters.fsEvents ?? 0)],
        ["FS 路径数", String(counters.fsPaths ?? 0)],
        ["git status 次数", String(counters.gitStatusCount ?? 0)],
        ["git status 累计", formatMs(counters.gitStatusMs ?? 0)],
      ],
    ),
  );

  return { summary, markdown: `${lines.join("\n")}\n` };
}

export { MB };
