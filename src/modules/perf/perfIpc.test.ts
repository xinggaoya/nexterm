import { afterEach, describe, expect, it, vi } from "vitest";

import { createTrackedInvoke, type RawInvoke } from "./perfIpc";
import { perfRecorder } from "./perfRecorder";

afterEach(() => {
  // 采集器是单例，测试之间必须复位。
  perfRecorder.reset();
  vi.restoreAllMocks();
});

describe("createTrackedInvoke", () => {
  it("passes through untouched while the recorder is disabled", async () => {
    const raw = vi.fn(async () => "ok") as unknown as RawInvoke;
    const invoke = createTrackedInvoke(raw);

    await expect(invoke("git_status", { cwd: "/repo" })).resolves.toBe("ok");
    expect(raw).toHaveBeenCalledWith("git_status", { cwd: "/repo" });
  });

  it("records the round-trip time and the outcome while enabled", async () => {
    const raw = vi.fn(async () => "ok") as unknown as RawInvoke;
    const invoke = createTrackedInvoke(raw);
    perfRecorder.enable("session-test");

    await expect(invoke("git_status", { cwd: "/repo" })).resolves.toBe("ok");

    const report = perfRecorder.buildReport();
    expect(report.ipc.total).toBe(1);
    expect(report.ipc.errors).toBe(0);
    expect(report.ipc.byCommand[0].cmd).toBe("git_status");
  });

  it("records failures and rethrows the original error", async () => {
    const failure = new Error("boom");
    const raw = vi.fn(async () => {
      throw failure;
    }) as unknown as RawInvoke;
    const invoke = createTrackedInvoke(raw);
    perfRecorder.enable("session-test");

    await expect(invoke("git_status", {})).rejects.toBe(failure);

    const report = perfRecorder.buildReport();
    expect(report.ipc.errors).toBe(1);
    expect(report.ipc.byCommand[0].errors).toBe(1);
  });
});
