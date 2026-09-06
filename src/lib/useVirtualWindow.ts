import { computed, onScopeDispose, ref, watch, type Ref } from "vue";

export type VirtualRange = { start: number; end: number; virtual: boolean };

export type VirtualWindowOptions = {
  /** 响应式总行数 getter。 */
  total: () => number;
  /** 固定行高（px）。 */
  rowHeight: number;
  /** 少于该行数时不窗口化（直接全量渲染），默认 200。 */
  threshold?: number;
  /** 视口外上下各多渲染的行数，默认 6。 */
  overscan?: number;
  /** 额外的滚动副作用（如 FileExplorer 关闭右键菜单）。 */
  onScroll?: (event: Event) => void;
};

/**
 * 定高行虚拟滚动的公共实现（FileExplorer / GitHistoryPane 共用）。
 *
 * 返回 range（可见窗口）、上下占位高度与绑到滚动容器的 onScroll 处理器；
 * 内部用 ResizeObserver 跟踪视口高度（含 display:none ↔ 可见的 0 尺寸跳变）。
 */
export function useVirtualWindow(
  scrollEl: Ref<HTMLElement | null>,
  options: VirtualWindowOptions,
) {
  const threshold = options.threshold ?? 200;
  const overscan = options.overscan ?? 6;
  const scrollTop = ref(0);
  const viewportHeight = ref(0);
  let ro: ResizeObserver | null = null;

  const range = computed<VirtualRange>(() => {
    const total = options.total();
    if (total <= 0 || total < threshold) {
      return { start: 0, end: Math.max(total, 0), virtual: false };
    }
    const start = Math.max(
      0,
      Math.floor(scrollTop.value / options.rowHeight) - overscan,
    );
    const end = Math.min(
      total,
      start + Math.ceil(viewportHeight.value / options.rowHeight) + overscan * 2,
    );
    return { start, end, virtual: true };
  });

  const topPadding = computed(() =>
    range.value.virtual ? range.value.start * options.rowHeight : 0,
  );
  const bottomPadding = computed(() => {
    if (!range.value.virtual) return 0;
    const total = options.total();
    return Math.max(0, (total - range.value.end) * options.rowHeight);
  });

  function onScroll(event: Event) {
    scrollTop.value = (event.target as HTMLElement).scrollTop;
    options.onScroll?.(event);
  }

  onScopeDispose(() => {
    ro?.disconnect();
    ro = null;
  });

  watch(
    scrollEl,
    (el, prev) => {
      if (prev) ro?.unobserve(prev);
      ro?.disconnect();
      ro = null;
      if (el && typeof ResizeObserver === "function") {
        ro = new ResizeObserver((entries) => {
          for (const entry of entries) {
            viewportHeight.value = entry.contentRect.height;
          }
        });
        ro.observe(el);
        viewportHeight.value = el.clientHeight;
      }
    },
    { flush: "post" },
  );

  return { range, topPadding, bottomPadding, onScroll };
}
