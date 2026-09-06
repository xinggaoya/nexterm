import {
  isPermissionGranted,
  requestPermission,
  sendNotification,
} from "@tauri-apps/plugin-notification";

/**
 * 系统级通知的 best-effort 封装（终端响铃等场景）。
 *
 * 仅在窗口失焦时调用有意义：窗口有焦点时调用方应使用应用内 toast
 * （notificationCenter），避免双重打扰。权限被拒、非 Tauri 环境、原生
 * 运行时缺失时静默失败 —— 通知本来就是锦上添花的能力。
 */
export async function sendOsNotification(
  title: string,
  body?: string,
): Promise<void> {
  try {
    let permissionGranted = await isPermissionGranted();
    if (!permissionGranted) {
      const permission = await requestPermission();
      permissionGranted = permission === "granted";
    }
    if (!permissionGranted) return;
    sendNotification({ title, body });
  } catch {
    // 非 Tauri 环境（单测、浏览器调试）或原生运行时缺失：忽略。
  }
}
