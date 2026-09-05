import { readonly, ref, type Ref } from "vue";
import {
  checkForAppUpdate,
  type AppUpdate,
} from "@/lib/native";
import { hasTauriInternals } from "@/lib/tauriRuntime";

/**
 * 应用内自动更新控制器。
 *
 * 数据源是 Tauri updater 插件（endpoint 指向 GitHub Releases 的
 * latest.json，由 release workflow 在推标签时生成）。发现新版本后
 * 立即下载安装（校验 minisign 签名），完成后进入 `ready` 状态等待
 * 用户确认重启。
 */

/** 首次自动检查延迟：避开启动高峰，不拖慢首屏。 */
const FIRST_CHECK_DELAY_MS = 30_000;
/** 启动后的周期复查间隔（8 小时）。 */
const RECHECK_INTERVAL_MS = 8 * 60 * 60 * 1000;

function normalizeError(error: unknown): string {
  if (error instanceof Error) return error.message;
  return String(error);
}

export type AppUpdateStatus =
  | "idle" // 尚未检查
  | "checking" // 正在询问更新端点
  | "downloading" // 已发现新版本，正在下载安装
  | "ready" // 已安装完毕，等待重启生效
  | "up-to-date" // 已是最新版本
  | "error"; // 检查或下载失败（详见 errorMessage）

export type AppUpdaterCheckOptions = {
  /**
   * 静默检查：失败时不写 errorMessage（避免 Linux 非 AppImage 安装
   * 场景在每次启动时都弹出错误）。
   */
  silent?: boolean;
};

export type AppUpdaterController = {
  status: Readonly<Ref<AppUpdateStatus>>;
  /** 端点通告的新版本号；未发现更新时为 null。 */
  availableVersion: Readonly<Ref<string | null>>;
  /** 端点附带的更新说明。 */
  releaseNotes: Readonly<Ref<string | null>>;
  /** 下载进度百分比（0-100）；总大小未知时为 null。 */
  downloadProgress: Readonly<Ref<number | null>>;
  /** 已下载字节数（总大小未知时用于 indeterminate 展示）。 */
  downloadedBytes: Readonly<Ref<number>>;
  /** 最近一次非静默失败的错误信息。 */
  errorMessage: Readonly<Ref<string | null>>;
  /**
   * 手动/自动检查一次更新。发现新版本时按需求直接下载安装，
   * 完成后状态变为 `ready`（不自动重启，由用户决定时机）。
   * 并发调用共享同一次进行中的检查。
   */
  checkForUpdates(options?: AppUpdaterCheckOptions): Promise<AppUpdate | null>;
  /**
   * 启动自动检查调度（启动延迟 + 周期检查）。`isEnabled` 在每次
   * 触发时求值，以便实时反映"自动检查更新"偏好。幂等。
   */
  startAutoUpdateChecks(isEnabled: () => boolean): void;
  /** 停掉自动检查定时器并复位调度状态（单例销毁时使用）。 */
  dispose(): void;
};

export function createAppUpdaterController(): AppUpdaterController {
  const status = ref<AppUpdateStatus>("idle");
  const availableVersion = ref<string | null>(null);
  const releaseNotes = ref<string | null>(null);
  const downloadProgress = ref<number | null>(null);
  const downloadedBytes = ref(0);
  const errorMessage = ref<string | null>(null);

  let started = false;
  let checkTimer: ReturnType<typeof setTimeout> | null = null;
  let intervalTimer: ReturnType<typeof setInterval> | null = null;
  // 进行中的"检查+下载" promise；并发调用合并到它上面。
  let inflight: Promise<AppUpdate | null> | null = null;

  async function downloadAndInstall(update: AppUpdate): Promise<void> {
    status.value = "downloading";
    downloadProgress.value = null;
    downloadedBytes.value = 0;
    let totalBytes: number | undefined;
    let received = 0;
    await update.downloadAndInstall((event) => {
      switch (event.event) {
        case "Started":
          totalBytes = event.data.contentLength;
          downloadProgress.value = totalBytes ? 0 : null;
          break;
        case "Progress":
          received += event.data.chunkLength;
          downloadedBytes.value = received;
          if (totalBytes) {
            downloadProgress.value = Math.min(
              100,
              Math.round((received / totalBytes) * 100),
            );
          }
          break;
        case "Finished":
          break;
      }
    });
    // 无论端点是否发送 Finished 事件，安装完成后进度一律收口为 100%。
    downloadProgress.value = 100;
    status.value = "ready";
  }

  async function checkForUpdates(
    options?: AppUpdaterCheckOptions,
  ): Promise<AppUpdate | null> {
    if (!hasTauriInternals()) return null;
    if (inflight) return inflight;
    const silent = options?.silent ?? false;
    status.value = "checking";
    errorMessage.value = null;
    inflight = (async () => {
      try {
        const update = await checkForAppUpdate();
        if (!update) {
          status.value = "up-to-date";
          availableVersion.value = null;
          releaseNotes.value = null;
          return null;
        }
        availableVersion.value = update.version;
        releaseNotes.value = update.body;
        await downloadAndInstall(update);
        return update;
      } catch (error) {
        status.value = "error";
        if (!silent) errorMessage.value = normalizeError(error);
        else console.warn("Background update check failed:", error);
        return null;
      } finally {
        inflight = null;
      }
    })();
    return inflight;
  }

  function startAutoUpdateChecks(isEnabled: () => boolean): void {
    if (started || !hasTauriInternals()) return;
    started = true;
    const tick = () => {
      if (isEnabled()) void checkForUpdates({ silent: true });
    };
    checkTimer = setTimeout(tick, FIRST_CHECK_DELAY_MS);
    intervalTimer = setInterval(tick, RECHECK_INTERVAL_MS);
  }

  function dispose(): void {
    if (checkTimer !== null) clearTimeout(checkTimer);
    if (intervalTimer !== null) clearInterval(intervalTimer);
    checkTimer = null;
    intervalTimer = null;
    started = false;
  }

  return {
    status: readonly(status),
    availableVersion: readonly(availableVersion),
    releaseNotes: readonly(releaseNotes),
    downloadProgress: readonly(downloadProgress),
    downloadedBytes: readonly(downloadedBytes),
    errorMessage: readonly(errorMessage),
    checkForUpdates,
    startAutoUpdateChecks,
    dispose,
  };
}

/** App 级单例：MainApp 的自动检查与设置页共享同一状态。 */
let singleton: AppUpdaterController | null = null;

export function useAppUpdater(): AppUpdaterController {
  singleton ??= createAppUpdaterController();
  return singleton;
}

// 仅供测试/极端场景重置单例（如热更新残留的定时器）。
export function disposeAppUpdaterSingleton(): void {
  singleton?.dispose();
  singleton = null;
}
