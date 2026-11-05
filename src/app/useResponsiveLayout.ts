import { computed, onBeforeUnmount, onMounted, ref, type Ref } from "vue";

/**
 * 壳层的响应式断点。
 *
 * 三栏结构（侧栏 + 画布 + 停靠面板）在默认窗口宽度（800×600）下会把画布
 * 挤成一条缝：侧栏 248px + 停靠面板 328px = 576px，画布只剩 224px；而顶栏
 * 的动作按钮（新建终端 / 分屏 / 命令中心 / 设置）因为身份区是 `shrink-0`，
 * 会被整体挤出可视区（`scrollWidth 313 > clientWidth 172`）——按钮看得见
 * 却点不到。
 *
 * 这里把判定集中到一处，各壳层只消费结论：
 * - `compact`：侧栏自动折叠成 52px 轨道（**不覆盖**用户偏好，窗口变宽后
 *   用户的偏好自动恢复）。
 * - `narrow`：停靠面板按可用宽度的比例收窄，而不是固定 328px。
 * - `tight`：停靠面板改为覆盖层，画布保持满宽。
 */
export const RESPONSIVE_BREAKPOINTS = {
  compact: 900,
  narrow: 760,
  tight: 640,
} as const;

/** 停靠面板在非紧凑模式下最多占可用宽度的比例。 */
export const PANEL_MAX_RATIO = 0.45;

/** 停靠面板的最小可见宽度（再窄就宁可露画布）。 */
export const PANEL_MIN_WIDTH = 200;

/** 覆盖层模式下，面板右侧要留给画布的最小余量（px）。 */
export const PANEL_OVERLAY_GUTTER = 24;

/**
 * 停靠面板的最终宽度（纯函数，便于单测）。
 *
 * `available` 是「容器宽度减去侧栏占用」，`requested` 是用户拖出来的偏好
 * 宽度。覆盖层模式下（`overlay`）面板不占布局宽度，但也要给画布留出
 * 余量，否则在极窄窗口里面板会盖住整个画布。
 */
export function resolveResponsivePanelWidth(
  requested: number,
  available: number,
  overlay: boolean,
): number {
  if (overlay) {
    const cap = Math.max(
      PANEL_MIN_WIDTH,
      Math.floor(Math.max(0, available) - PANEL_OVERLAY_GUTTER),
    );
    return Math.min(requested, cap);
  }
  const cap = Math.max(
    PANEL_MIN_WIDTH,
    Math.floor(Math.max(0, available) * PANEL_MAX_RATIO),
  );
  return Math.min(requested, cap);
}

export interface ResponsiveLayout {
  /** 壳层容器宽度（px）。容器不可测量时退回视口宽度。 */
  readonly width: Ref<number>;
  /** 宽度不足，侧栏应折叠成轨道。 */
  readonly compact: Ref<boolean>;
  /** 宽度偏窄，停靠面板应按比例收窄。 */
  readonly narrow: Ref<boolean>;
  /** 宽度很窄，停靠面板应改为覆盖层。 */
  readonly tight: Ref<boolean>;
  /**
   * 停靠面板的最终宽度。
   *
   * `available` 是「容器宽度减去侧栏占用」，`requested` 是用户拖出来的偏好
   * 宽度。覆盖层模式下不占布局，直接用请求宽度。
   */
  resolvePanelWidth: (requested: number, available: number) => number;
}

/**
 * 观测壳层容器宽度，产出断点结论。
 *
 * 用 `ResizeObserver` 而不是 `window.innerWidth`：WebView 的可视区宽度和
 * 布局容器宽度在某些场景下并不一致（缩放、嵌入、浏览器调试桥里的视口
 * 模拟），以容器为准才不会算错。
 */
export function useResponsiveLayout(
  target?: Ref<HTMLElement | null>,
): ResponsiveLayout {
  const width = ref(0);

  function measure(): void {
    const element = target?.value;
    const measured =
      element && element.isConnected ? element.clientWidth : window.innerWidth;
    width.value = measured > 0 ? measured : window.innerWidth;
  }

  let observer: ResizeObserver | null = null;

  onMounted(() => {
    measure();
    if (typeof ResizeObserver !== "undefined" && target?.value) {
      observer = new ResizeObserver(() => measure());
      observer.observe(target.value);
    }
    window.addEventListener("resize", measure);
  });

  onBeforeUnmount(() => {
    observer?.disconnect();
    observer = null;
    window.removeEventListener("resize", measure);
  });

  const compact = computed(
    () => width.value > 0 && width.value < RESPONSIVE_BREAKPOINTS.compact,
  );
  const narrow = computed(
    () => width.value > 0 && width.value < RESPONSIVE_BREAKPOINTS.narrow,
  );
  const tight = computed(
    () => width.value > 0 && width.value < RESPONSIVE_BREAKPOINTS.tight,
  );

  function resolvePanelWidth(requested: number, available: number): number {
    return resolveResponsivePanelWidth(requested, available, tight.value);
  }

  return { width, compact, narrow, tight, resolvePanelWidth };
}
