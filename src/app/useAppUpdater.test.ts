import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { createAppUpdaterController } from "./useAppUpdater";
import { checkForAppUpdate } from "@/lib/native";
import { hasTauriInternals } from "@/lib/tauriRuntime";
import type { AppUpdateProgressEvent } from "@/lib/native";

vi.mock("@/lib/native", () => ({
  checkForAppUpdate: vi.fn(),
  relaunchApp: vi.fn(),
}));

vi.mock("@/lib/tauriRuntime", () => ({
  hasTauriInternals: vi.fn(() => true),
}));

const checkMock = vi.mocked(checkForAppUpdate);

function makeUpdate(overrides?: {
  version?: string;
  download?: (onProgress?: (event: AppUpdateProgressEvent) => void) => Promise<void>;
}) {
  return {
    version: overrides?.version ?? "0.2.0",
    currentVersion: "0.1.2",
    body: "release notes",
    downloadAndInstall:
      overrides?.download ?? vi.fn(async () => undefined),
  };
}

describe("createAppUpdaterController", () => {
  beforeEach(() => {
    checkMock.mockReset();
    vi.mocked(hasTauriInternals).mockReturnValue(true);
  });

  afterEach(() => {
    vi.useRealTimers();
  });

  it("enters up-to-date when the endpoint reports no newer release", async () => {
    checkMock.mockResolvedValue(null);
    const controller = createAppUpdaterController();

    const result = await controller.checkForUpdates();

    expect(result).toBeNull();
    expect(controller.status.value).toBe("up-to-date");
    expect(controller.availableVersion.value).toBeNull();
    expect(controller.errorMessage.value).toBeNull();
  });

  it("downloads immediately and reaches ready when an update exists", async () => {
    const events: AppUpdateProgressEvent[] = [
      { event: "Started", data: { contentLength: 100 } },
      { event: "Progress", data: { chunkLength: 40 } },
      { event: "Progress", data: { chunkLength: 60 } },
      { event: "Finished" },
    ];
    const download = vi.fn(
      async (onProgress?: (event: AppUpdateProgressEvent) => void) => {
        for (const event of events) onProgress?.(event);
      },
    );
    checkMock.mockResolvedValue(makeUpdate({ download }));
    const controller = createAppUpdaterController();

    const result = await controller.checkForUpdates();

    expect(result?.version).toBe("0.2.0");
    expect(download).toHaveBeenCalledTimes(1);
    expect(controller.status.value).toBe("ready");
    expect(controller.availableVersion.value).toBe("0.2.0");
    expect(controller.releaseNotes.value).toBe("release notes");
    expect(controller.downloadProgress.value).toBe(100);
  });

  it("reports partial progress as a percentage while downloading", async () => {
    let finishDownload!: () => void;
    const download = vi.fn(
      async (onProgress?: (event: AppUpdateProgressEvent) => void) => {
        onProgress?.({ event: "Started", data: { contentLength: 200 } });
        onProgress?.({ event: "Progress", data: { chunkLength: 50 } });
        await new Promise<void>((resolve) => {
          finishDownload = resolve;
        });
      },
    );
    checkMock.mockResolvedValue(makeUpdate({ download }));
    const controller = createAppUpdaterController();

    const pending = controller.checkForUpdates();
    await vi.waitFor(() => {
      expect(controller.downloadProgress.value).toBe(25);
      expect(controller.downloadedBytes.value).toBe(50);
      expect(controller.status.value).toBe("downloading");
    });

    finishDownload();
    await pending;
    expect(controller.status.value).toBe("ready");
  });

  it("keeps the progress indeterminate when the content length is unknown", async () => {
    let finishDownload!: () => void;
    const download = vi.fn(
      async (onProgress?: (event: AppUpdateProgressEvent) => void) => {
        onProgress?.({ event: "Started", data: {} });
        onProgress?.({ event: "Progress", data: { chunkLength: 2048 } });
        await new Promise<void>((resolve) => {
          finishDownload = resolve;
        });
      },
    );
    checkMock.mockResolvedValue(makeUpdate({ download }));
    const controller = createAppUpdaterController();

    const pending = controller.checkForUpdates();
    await vi.waitFor(() => {
      expect(controller.downloadedBytes.value).toBe(2048);
      // Unknown total size → no percentage, UI shows indeterminate progress.
      expect(controller.downloadProgress.value).toBeNull();
    });

    finishDownload();
    await pending;
    expect(controller.status.value).toBe("ready");
    expect(controller.downloadProgress.value).toBe(100);
  });

  it("records the error on a visible check but stays quiet when silent", async () => {
    checkMock.mockRejectedValue(new Error("network down"));

    const visible = createAppUpdaterController();
    await visible.checkForUpdates();
    expect(visible.status.value).toBe("error");
    expect(visible.errorMessage.value).toBe("network down");

    const silent = createAppUpdaterController();
    await silent.checkForUpdates({ silent: true });
    expect(silent.status.value).toBe("error");
    expect(silent.errorMessage.value).toBeNull();
  });

  it("merges concurrent checks into one in-flight request", async () => {
    let resolve!: (value: Awaited<ReturnType<typeof checkForAppUpdate>>) => void;
    checkMock.mockReturnValue(
      new Promise((res) => {
        resolve = res;
      }),
    );
    const controller = createAppUpdaterController();

    const first = controller.checkForUpdates();
    const second = controller.checkForUpdates();
    resolve(makeUpdate());
    const [a, b] = await Promise.all([first, second]);

    expect(checkMock).toHaveBeenCalledTimes(1);
    expect(a?.version).toBe("0.2.0");
    expect(b?.version).toBe("0.2.0");
  });

  it("skips no-op work in non-tauri runtimes", async () => {
    vi.mocked(hasTauriInternals).mockReturnValue(false);
    const controller = createAppUpdaterController();

    await controller.checkForUpdates();

    expect(checkMock).not.toHaveBeenCalled();
    expect(controller.status.value).toBe("idle");
  });

  it("auto checks follow the enabled predicate on the delay + interval schedule", async () => {
    vi.useFakeTimers();
    checkMock.mockResolvedValue(null);
    const controller = createAppUpdaterController();
    let enabled = false;
    controller.startAutoUpdateChecks(() => enabled);

    // The one-shot 30s timer fires while the toggle is off: skipped.
    await vi.advanceTimersByTimeAsync(30_000);
    expect(checkMock).not.toHaveBeenCalled();

    // The 8h interval fires at t=8h/16h/… counted from startAutoUpdateChecks.
    enabled = true;
    await vi.advanceTimersByTimeAsync(7 * 60 * 60 * 1000);
    expect(checkMock).not.toHaveBeenCalled();

    await vi.advanceTimersByTimeAsync(60 * 60 * 1000);
    expect(checkMock).toHaveBeenCalledTimes(1);

    await vi.advanceTimersByTimeAsync(8 * 60 * 60 * 1000);
    expect(checkMock).toHaveBeenCalledTimes(2);

    controller.dispose();
  });

  it("does not restart the schedule when startAutoUpdateChecks is called twice", async () => {
    vi.useFakeTimers();
    checkMock.mockResolvedValue(null);
    const controller = createAppUpdaterController();
    controller.startAutoUpdateChecks(() => true);
    controller.startAutoUpdateChecks(() => true);

    await vi.advanceTimersByTimeAsync(30_000);
    expect(checkMock).toHaveBeenCalledTimes(1);

    controller.dispose();
  });
});
