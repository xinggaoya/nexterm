/**
 * 统一的错误消息提取。
 *
 * 全库曾有 8 份局部 normalizeError 拷贝（两种变体：`instanceof Error` 简版
 * 与「string 直返 + 取 .message」全量版）；本实现是全量版语义的超集 ——
 * Error 实例本身带 string message，两条路径都会在此收敛。
 */
export function normalizeErrorMessage(error: unknown): string {
  if (typeof error === "string") return error;
  if (error && typeof error === "object" && "message" in error) {
    const message = (error as { message?: unknown }).message;
    if (typeof message === "string") return message;
  }
  return String(error);
}
