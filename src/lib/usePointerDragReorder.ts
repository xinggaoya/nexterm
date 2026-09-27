import { onBeforeUnmount, shallowRef, type ShallowRef } from "vue";

/**
 * 拖拽落点方位：`before` = 目标元素的前半（上缘 / 左缘），
 * `after` = 后半（下缘 / 右缘）。语义与 `modules/tabs/tabsReorder.ts` 的
 * `TabDropPlacement` 一致，便于把解析结果直接喂给 `reorderTabs`。
 */
export type DragPlacement = "before" | "after";

export type DragTarget<TId extends string | number> = {
  id: TId;
  /** 命中的 DOM 元素：调用方要用它算中线、画指示线或读尺寸。 */
  el: HTMLElement;
};

export type PointerDragReorderOptions<T, TId extends string | number> = {
  /**
   * 是否允许启动拖拽。列表只剩 1 项时拖拽没有意义，调用方在这里直接
   * 返回 false 即可，无需自己再判一次。
   */
  enabled?: () => boolean;
  /**
   * 命中测试：由调用方决定 selector 与 id 提取方式（`data-*` 属性、
   * class、组件 ref 都可以）。指针移动的每一帧都会调用，**必须便宜**：
   * 典型实现是 `document.elementFromPoint(x, y)?.closest(selector)`。
   */
  resolveTarget: (clientX: number, clientY: number) => DragTarget<TId> | null;
  /** 把指针位置映射成落点方位。默认按元素的水平中线二分。 */
  placementOf?: (
    target: DragTarget<TId>,
    clientX: number,
    clientY: number,
  ) => DragPlacement;
  /**
   * 解析 ghost 要渲染的数据。返回 `null` 表示这一项没有 ghost（如
   * 折叠态芯片），此时不渲染浮层但拖拽本身照常工作。
   *
   * 内部按 id 缓存结果：pointermove 每帧都会调用，不能每帧线性扫描列表。
   */
  resolveGhost: (id: TId) => T | null;
  /** 落定：仅在真正拖动过（超过阈值）且目标 ≠ 源时触发。 */
  onDrop: (sourceId: TId, targetId: TId, placement: DragPlacement) => void;
  /** 拖动开始 / 结束，用于联动（悬停自动展开、busy 态、禁掉 hover 效果）。 */
  onDraggingChange?: (dragging: boolean, sourceId: TId | null) => void;
  /** 启动阈值（px）。低于它只当作普通点击，避免手抖误触。默认 6。 */
  threshold?: number;
  /** ghost 宽度整形钩子（钳位到可读区间等）。默认原样透出实测宽度。 */
  ghostWidth?: (measured: number) => number;
};

export type PointerDragReorder<T, TId extends string | number> = {
  /** 正在被拖动的条目 id（未拖动时为 null）。 */
  draggingId: Readonly<Ref<TId | null>>;
  /** 当前落点；指针不在任何可放置元素上时为 null。 */
  dropTarget: Readonly<Ref<{ id: TId; placement: DragPlacement } | null>>;
  /** 跟随指针的 ghost 负载与位置。 */
  ghost: Readonly<Ref<{ item: T; x: number; y: number; width: number } | null>>;
  /**
   * 判断"这次 click 是不是刚刚那次拖拽的尾巴"。
   * 命中即消费掉该抑制标记并返回 true，调用方据此跳过选中/切换。
   */
  consumeSuppressedClick: (id: TId) => boolean;
  /** 绑定到条目元素的 `pointerdown`。 */
  startDrag: (event: PointerEvent, id: TId) => void;
  /** 手动清空全部拖拽状态（换列表、销毁、外部中断时）。 */
  clear: () => void;
};

type PointerDragState<TId extends string | number> = {
  sourceId: TId;
  pointerId: number;
  startX: number;
  startY: number;
  sourceWidth: number;
  dragging: boolean;
};

/** 拖拽结束后短暂抑制该行的 click：否则松手瞬间会先落 drop 再触发选中。 */
const CLICK_SUPPRESS_MS = 400;

const DEFAULT_THRESHOLD = 6;

/**
 * 指针拖拽重排的公共实现。
 *
 * 抽出来是因为同一套手势在三个地方各写了一遍（`SessionStrip` 的标签重排、
 * `Sidebar` 的工作区重排、explorer 的文件搬运），而这类手势的细节最容易在
 * 复制过程中悄悄漂移：阈值、ghost 缓存、window 监听的成对移除、click 抑制、
 * pointercancel 清理。统一到这里后，`pointerDragBoundary.test.ts` 用静态扫描
 * 锁死"不再出现手写副本"。
 *
 * 用 Pointer Events 而不是 HTML5 drag-and-drop：Tauri v2 默认
 * `dragDropEnabled: true`，webview 内的原生 dragstart/drop 会被系统层拦走
 * （那条通道留给"从 Finder 拖文件进窗口"，见 `native.onOsFileDragDrop`）。
 */
export function usePointerDragReorder<T, TId extends string | number = number>(
  options: PointerDragReorderOptions<T, TId>,
): PointerDragReorder<T, TId> {
  const threshold = options.threshold ?? DEFAULT_THRESHOLD;
  // 全部用 shallowRef：`T` / `TId` 是调用方的类型参数，`ref()` 的深度
  // UnwrapRef 会把它们收窄成 `UnwrapRef<T>`，与对外声明的 `Readonly<Ref<T>>`
  // 不兼容；而且 ghost 负载只是每帧换值的展示对象，深度响应式纯属浪费。
  // 全部用 shallowRef：`T` / `TId` 是调用方的类型参数，`ref()` 的深度
  // UnwrapRef 会把它们收窄成 `UnwrapRef<T>`，与对外声明的 `Readonly<Ref<T>>`
  // 不兼容；而且 ghost 负载只是每帧换值的展示对象，深度响应式纯属浪费。
  //
  // 显式 cast：`TId extends string | number` 理论上也可能是 `Ref`，导致
  // `shallowRef(x)` 的两个重载无法在 `null` 初值上二选一，只能手动定住。
  const draggingId = shallowRef(null) as ShallowRef<TId | null>;
  const dropTarget = shallowRef(null) as ShallowRef<{
    id: TId;
    placement: DragPlacement;
  } | null>;
  const ghost = shallowRef(null) as ShallowRef<{
    item: T;
    x: number;
    y: number;
    width: number;
  } | null>;
  const suppressedClickId = shallowRef(null) as ShallowRef<TId | null>;
  const pointerDrag = shallowRef(null) as ShallowRef<PointerDragState<TId> | null>;

  // ghost 按 id 缓存：pointermove 每帧都会 resolveGhost，逐帧线性扫描列表
  // 在长列表上是 O(n) 的无谓开销。
  let cachedGhostId: TId | null = null;
  let cachedGhostItem: T | null = null;

  function resolveGhostItem(id: TId): T | null {
    if (cachedGhostId === id) return cachedGhostItem;
    cachedGhostId = id;
    cachedGhostItem = options.resolveGhost(id);
    return cachedGhostItem;
  }

  function defaultPlacementOf(
    target: DragTarget<TId>,
    clientX: number,
  ): DragPlacement {
    const rect = target.el.getBoundingClientRect();
    return clientX < rect.left + rect.width / 2 ? "before" : "after";
  }

  function updateDropTarget(e: PointerEvent): void {
    const drag = pointerDrag.value;
    if (!drag) return;
    const target = options.resolveTarget(e.clientX, e.clientY);
    if (!target || target.id === drag.sourceId) {
      dropTarget.value = null;
      return;
    }
    const placementOf = options.placementOf ?? defaultPlacementOf;
    dropTarget.value = {
      id: target.id,
      placement: placementOf(target, e.clientX, e.clientY),
    };
  }

  function updateGhost(e: PointerEvent, drag: PointerDragState<TId>): void {
    const item = resolveGhostItem(drag.sourceId);
    if (!item) {
      ghost.value = null;
      return;
    }
    const measured = drag.sourceWidth;
    ghost.value = {
      item,
      x: e.clientX,
      y: e.clientY,
      width: options.ghostWidth ? options.ghostWidth(measured) : measured,
    };
  }

  function clear(): void {
    const wasDragging = draggingId.value !== null;
    const sourceId = draggingId.value;
    draggingId.value = null;
    dropTarget.value = null;
    pointerDrag.value = null;
    ghost.value = null;
    cachedGhostId = null;
    cachedGhostItem = null;
    // 复位后不再通知 onDraggingChange(false) —— 那里已经把引用置空。
    if (wasDragging) options.onDraggingChange?.(false, sourceId);
  }

  function handleWindowPointerMove(e: PointerEvent): void {
    const drag = pointerDrag.value;
    if (!drag || drag.pointerId !== e.pointerId) return;
    const dist = Math.hypot(e.clientX - drag.startX, e.clientY - drag.startY);
    if (!drag.dragging && dist < threshold) return;
    e.preventDefault();
    if (!drag.dragging) {
      drag.dragging = true;
      draggingId.value = drag.sourceId;
      options.onDraggingChange?.(true, drag.sourceId);
    }
    updateGhost(e, drag);
    updateDropTarget(e);
  }

  function handleWindowPointerUp(e: PointerEvent): void {
    const drag = pointerDrag.value;
    if (!drag || drag.pointerId !== e.pointerId) return;
    const sourceId = drag.sourceId;
    // 最后一帧重新算一次落点：pointerup 常常不在 pointermove 之后。
    if (drag.dragging) updateDropTarget(e);
    const target = dropTarget.value;
    removePointerListeners();
    if (drag.dragging) {
      e.preventDefault();
      suppressedClickId.value = sourceId;
      window.setTimeout(() => {
        if (suppressedClickId.value === sourceId) suppressedClickId.value = null;
      }, CLICK_SUPPRESS_MS);
      if (target && target.id !== sourceId) {
        options.onDrop(sourceId, target.id, target.placement);
      }
    }
    clear();
  }

  function handleWindowPointerCancel(e: PointerEvent): void {
    const drag = pointerDrag.value;
    if (!drag || drag.pointerId !== e.pointerId) return;
    removePointerListeners();
    clear();
  }

  function addPointerListeners(): void {
    window.addEventListener("pointermove", handleWindowPointerMove, {
      passive: false,
    });
    window.addEventListener("pointerup", handleWindowPointerUp);
    window.addEventListener("pointercancel", handleWindowPointerCancel);
  }

  function removePointerListeners(): void {
    window.removeEventListener("pointermove", handleWindowPointerMove);
    window.removeEventListener("pointerup", handleWindowPointerUp);
    window.removeEventListener("pointercancel", handleWindowPointerCancel);
  }

  function startDrag(event: PointerEvent, id: TId): void {
    if (event.button !== 0) return;
    if (options.enabled && !options.enabled()) return;
    event.stopPropagation();
    removePointerListeners();
    const el = event.currentTarget as HTMLElement | null;
    const measured =
      typeof el?.getBoundingClientRect === "function"
        ? el.getBoundingClientRect().width
        : 0;
    pointerDrag.value = {
      sourceId: id,
      pointerId: event.pointerId,
      startX: event.clientX,
      startY: event.clientY,
      sourceWidth: measured,
      dragging: false,
    };
    addPointerListeners();
  }

  function consumeSuppressedClick(id: TId): boolean {
    if (suppressedClickId.value !== id) return false;
    suppressedClickId.value = null;
    return true;
  }

  onBeforeUnmount(() => {
    removePointerListeners();
  });

  return {
    draggingId,
    dropTarget,
    ghost,
    consumeSuppressedClick,
    startDrag,
    clear,
  };
}
