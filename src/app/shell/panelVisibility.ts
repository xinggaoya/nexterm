import type { PanelView, PanelLayoutPref } from "@/modules/settings/store";

/**
 * 停靠面板的布局与切换规则（纯函数，便于单测）。
 *
 * v3.3：左右两侧各一个面板，每个面板独立选视图（文件树 / 更改）、
 * 独立折叠。这里集中三件事：
 *
 * 1. **宽度预算** —— 两侧面板加起来不能把画布挤没。画布才是主体。
 * 2. **视图归属** —— 每个视图默认挂在哪一侧。
 * 3. **切换语义** —— 「切换某个视图」到底是打开它、关掉它，还是换到它。
 */

/** 画布的最小可视宽度（px）。 */
export const MIN_CANVAS_WIDTH = 360;

/** 单侧面板最多占容器宽度的比例。 */
export const PANEL_MAX_RATIO = 0.45;

export type PanelSide = "left" | "right";

/** 一侧面板的请求状态（宽度 + 是否展开）。 */
export type PanelRequest = {
  requested: number;
  open: boolean;
};

/**
 * 两侧面板的最终宽度。
 *
 * 规则：
 * - 单侧不超过容器宽度的 45%（对齐单面板时代的收窄策略）；
 * - 两侧加起来不超过「容器宽 − 画布最小宽」，超了就等比压缩；
 * - 收起的一侧宽度为 0（不占布局）。
 */
export function resolvePanelWidths(
  containerWidth: number,
  left: PanelRequest,
  right: PanelRequest,
): { left: number; right: number } {
  const container = Math.max(0, containerWidth);
  const perSideCap = Math.floor(container * PANEL_MAX_RATIO);
  let leftWidth = left.open ? Math.min(left.requested, perSideCap) : 0;
  let rightWidth = right.open ? Math.min(right.requested, perSideCap) : 0;

  const budget = Math.max(0, container - MIN_CANVAS_WIDTH);
  const total = leftWidth + rightWidth;
  if (total > budget && total > 0) {
    const scale = budget / total;
    leftWidth = Math.floor(leftWidth * scale);
    rightWidth = Math.floor(rightWidth * scale);
  }
  return { left: leftWidth, right: rightWidth };
}

/** 每个视图默认挂在哪一侧：文件树在左，更改在右。 */
export const DEFAULT_SIDE_OF_VIEW: Record<PanelView, PanelSide> = {
  explorer: "left",
  changes: "right",
};

/**
 * 把某个视图放到某一侧。
 *
 * **同一个视图不允许同时出现在两侧** —— 两边都开文件树没有意义，两边都开
 * git 面板更没有。所以当另一侧已经是这个视图时，两侧**对调**：另一侧换成
 * 这一侧原来的视图。
 */
export function assignPanelView(
  current: PanelLayoutPref,
  side: PanelSide,
  view: PanelView,
): PanelLayoutPref {
  const other: PanelSide = side === "left" ? "right" : "left";
  if (current[other] === view) {
    return { ...current, [other]: current[side], [side]: view };
  }
  return { ...current, [side]: view };
}

/** 一侧面板的当前状态（视图 + 是否展开）。 */
export type PanelSlotState = {
  view: PanelView;
  open: boolean;
};

/**
 * 「切换某个视图」的落点。
 *
 * 左右各持有一个视图且互不重复，所以每个视图都恰好在一侧：
 * 视图在那一侧就切换那一侧的显隐（开着就关，关着就开）。
 */
export function resolvePanelViewToggle(
  layout: PanelLayoutPref,
  open: { left: boolean; right: boolean },
  view: PanelView,
): { side: PanelSide; open: boolean } {
  const side: PanelSide = layout.left === view ? "left" : "right";
  return { side, open: !open[side] };
}

/** 某个视图当前挂在哪一侧。 */
export function sideOfView(
  layout: PanelLayoutPref,
  view: PanelView,
): PanelSide {
  return layout.left === view ? "left" : "right";
}
