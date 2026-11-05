import { describe, expect, it } from "vitest";

import { DurationAccumulator, PerfRecorder } from "./perfRecorder";

describe("DurationAccumulator", () => {
  it("aggregates count / total / max", () => {
    const accumulator = new DurationAccumulator();
    accumulator.add(10);
    accumulator.add(20);
    accumulator.add(30);

    expect(accumulator.count).toBe(3);
    expect(accumulator.totalMs).toBe(60);
    expect(accumulator.maxMs).toBe(30);
  });

  it("computes percentiles over the retained samples", () => {
    const accumulator = new DurationAccumulator();
    for (let index = 1; index <= 100; index += 1) accumulator.add(index);

    expect(accumulator.percentile(0.5)).toBeGreaterThanOrEqual(50);
    expect(accumulator.percentile(0.95)).toBeGreaterThanOrEqual(95);
    expect(accumulator.percentile(0.95)).toBeLessThanOrEqual(100);
  });

  it("keeps the sample buffer bounded through decimation", () => {
    const accumulator = new DurationAccumulator();
    for (let index = 0; index < 5000; index += 1) accumulator.add(index);

    expect(accumulator.count).toBe(5000);
    expect(accumulator.maxMs).toBe(4999);
    expect(accumulator.precision).toBeGreaterThan(1);
  });
});

describe("PerfRecorder", () => {
  it("collects nothing while disabled", () => {
    const recorder = new PerfRecorder();
    recorder.recordIpc("git_status", 120, true);
    recorder.recordLongTask(300, "self");
    recorder.recordMemory({ usedJsHeapMb: 10, totalJsHeapMb: 20, domNodes: 5 });

    expect(recorder.enabled).toBe(false);
    const report = recorder.buildReport();
    expect(report.ipc.total).toBe(0);
    expect(report.ipc.byCommand).toEqual([]);
    expect(report.longTasks.count).toBe(0);
    expect(report.memory.samples).toEqual([]);
  });

  it("aggregates per-command statistics after enabling", () => {
    const recorder = new PerfRecorder();
    recorder.enable("session-1");

    recorder.recordIpc("git_status", 10, true);
    recorder.recordIpc("git_status", 30, true);
    recorder.recordIpc("git_status", 90, false, new Error("boom"));

    const report = recorder.buildReport();
    expect(report.sessionId).toBe("session-1");
    expect(report.ipc.total).toBe(3);
    expect(report.ipc.errors).toBe(1);
    expect(report.ipc.byCommand).toHaveLength(1);
    const stat = report.ipc.byCommand[0];
    expect(stat.cmd).toBe("git_status");
    expect(stat.count).toBe(3);
    expect(stat.errors).toBe(1);
    expect(stat.totalMs).toBe(130);
    expect(stat.maxMs).toBe(90);
  });

  it("keeps the slowest calls sorted and bounded", () => {
    const recorder = new PerfRecorder();
    recorder.enable("session-2");

    for (let index = 0; index < 250; index += 1) {
      recorder.recordIpc(`cmd_${index}`, index, true);
    }

    const report = recorder.buildReport();
    expect(report.ipc.slowest.length).toBeLessThanOrEqual(100);
    expect(report.ipc.slowest[0].durationMs).toBe(249);
    expect(report.ipc.slowest[0].cmd).toBe("cmd_249");
  });

  it("buckets frames per second and counts long frames", () => {
    const recorder = new PerfRecorder();
    recorder.enable("session-3");

    recorder.recordFrame(16);
    recorder.recordFrame(16);
    recorder.recordFrame(120);

    const report = recorder.buildReport();
    expect(report.frames.buckets).toHaveLength(1);
    expect(report.frames.buckets[0].frames).toBe(3);
    expect(report.frames.buckets[0].longFrames).toBe(1);
    expect(report.frames.droppedTotal).toBe(1);
  });

  it("tracks vitals and counters", () => {
    const recorder = new PerfRecorder();
    recorder.enable("session-4");

    recorder.setLcp(1234.5);
    recorder.addCls(0.05);
    recorder.addCls(0.02);
    recorder.setInp(80);
    recorder.setInp(40);
    recorder.countPtyChunk(1024);
    recorder.countFsEvent(3);
    recorder.countGitStatus(25);

    const report = recorder.buildReport();
    expect(report.vitals.lcpMs).toBe(1234.5);
    expect(report.vitals.cls).toBe(0.07);
    expect(report.vitals.inpMs).toBe(80);
    expect(report.counters.ptyBytes).toBe(1024);
    expect(report.counters.fsEvents).toBe(1);
    expect(report.counters.fsPaths).toBe(3);
    expect(report.counters.gitStatusCount).toBe(1);
    expect(report.counters.gitStatusMs).toBe(25);
  });

  it("records boot stages even before the session is enabled", () => {
    const recorder = new PerfRecorder();
    recorder.markBoot("module-evaluated");
    recorder.enable("session-5");
    recorder.markBoot("mounted");

    const report = recorder.buildReport();
    expect(report.boot.stages.map((stage) => stage.stage)).toEqual([
      "module-evaluated",
      "mounted",
    ]);
  });
});
