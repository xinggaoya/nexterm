import { perfRecorder } from "./perfRecorder";

/**
 * invoke 的最小形状。
 *
 * 这里刻意 **不** 从 `@tauri-apps/api/core` 引入类型：IPC 边界测试
 * （`src/lib/nativeBoundary.test.ts`）只允许 `src/lib/native.ts` 触碰
 * Tauri 的 IPC 原始 API，perf 模块必须经由 native.ts 注入。
 */
export type PerfInvokeOptions = {
  headers?: Record<string, string>;
};

export type RawInvoke = <T>(
  cmd: string,
  args?: unknown,
  options?: PerfInvokeOptions,
) => Promise<T>;

/**
 * 给 invoke 包一层计时。
 *
 * - 录制关闭时是纯透传：多一次布尔判断，参数个数也不变（既有单测对
 *   `invoke` 的调用参数做了精确断言，不能多传 `undefined`）。
 * - 录制打开时记录每条命令的往返耗时、成功与否，并保留最慢的若干条。
 */
export function createTrackedInvoke(raw: RawInvoke): RawInvoke {
  return function trackedInvoke<T>(
    cmd: string,
    args?: unknown,
    options?: PerfInvokeOptions,
  ): Promise<T> {
    if (!perfRecorder.enabled) {
      // 参数个数必须与原调用一致：既有单测对 invoke 的参数做了精确断言。
      return args === undefined ? raw<T>(cmd) : raw<T>(cmd, args);
    }
    const startedAt = performance.now();
    const promise =
      args === undefined ? raw<T>(cmd, undefined, options) : raw<T>(cmd, args, options);
    return promise.then(
      (result) => {
        perfRecorder.recordIpc(cmd, performance.now() - startedAt, true);
        return result;
      },
      (error: unknown) => {
        perfRecorder.recordIpc(cmd, performance.now() - startedAt, false, error);
        throw error;
      },
    );
  };
}
