import { createApp } from "vue";
import DevBridgeUnavailable from "./components/DevBridgeUnavailable.vue";

/**
 * 挂载「调试桥未就绪」提示页。
 *
 * 独立于 MainApp：这个页面在**桥没起来**时渲染，而 MainApp 的启动流程
 * 依赖真实后端（偏好 hydrate、工作区 bootstrap），那时全都不可用 ——
 * 硬挂 MainApp 只会得到一个白屏。
 */
export function mountDevBridgeUnavailable(
  target: string | Element = "#root",
): void {
  createApp(DevBridgeUnavailable).mount(target);
}
