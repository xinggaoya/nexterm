import { openUrl } from "@tauri-apps/plugin-opener";

/**
 * 用系统默认浏览器打开外部链接。
 *
 * Markdown 预览、Git 远端、预览地址栏三处的「打开外部链接」共用这一个入口，
 * 避免每个消费方各自 import 一次 Tauri 插件。非 Tauri 环境（web-dev-bridge
 * 浏览器调试）插件不可用，调用方负责兜底。
 */
export async function openExternalUrl(url: string): Promise<void> {
  await openUrl(url);
}
