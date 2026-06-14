import { ref, type Ref } from "vue";

/**
 * Manages terminal pane resize state per tab.
 * Stores flex-grow values for each split container's children.
 */

type SplitSizes = number[];
type TabPaneSizes = Map<number, SplitSizes>; // splitIndex → sizes[]

const paneSizes = ref(new Map<number, TabPaneSizes>()); // tabId → splits

function getSplitSizes(tabId: number, splitIndex: number, childCount: number): number[] {
  const tabSplits = paneSizes.value.get(tabId);
  if (!tabSplits) return Array(childCount).fill(1);
  const sizes = tabSplits.get(splitIndex);
  if (!sizes || sizes.length !== childCount) return Array(childCount).fill(1);
  return sizes;
}

function setSplitSizes(tabId: number, splitIndex: number, sizes: number[]) {
  let tabSplits = paneSizes.value.get(tabId);
  if (!tabSplits) {
    tabSplits = new Map();
    paneSizes.value.set(tabId, tabSplits);
  }
  tabSplits.set(splitIndex, [...sizes]);
}

function resetSizes(tabId: number) {
  paneSizes.value.delete(tabId);
}

function startResize(
  event: PointerEvent,
  tabId: number,
  splitIndex: number,
  resizeIndex: number,
  direction: "row" | "col",
  containerEl: HTMLElement,
) {
  const sizes = getSplitSizes(tabId, splitIndex, containerEl.children.length);
  const totalSize = direction === "row" ? containerEl.clientWidth : containerEl.clientHeight;
  if (totalSize <= 0) return;

  const startPos = direction === "row" ? event.clientX : event.clientY;
  const startSizes = [...sizes];
  const totalGrow = startSizes.reduce((a, b) => a + b, 0);

  const onMove = (e: PointerEvent) => {
    const currentPos = direction === "row" ? e.clientX : e.clientY;
    const delta = currentPos - startPos;
    const deltaRatio = (delta / totalSize) * totalGrow;

    const leftIdx = resizeIndex;
    const rightIdx = resizeIndex + 1;
    const newLeft = Math.max(0.1, startSizes[leftIdx] + deltaRatio);
    const newRight = Math.max(0.1, startSizes[rightIdx] - deltaRatio);

    const newSizes = [...startSizes];
    newSizes[leftIdx] = newLeft;
    newSizes[rightIdx] = newRight;
    setSplitSizes(tabId, splitIndex, newSizes);

    // Force reactivity by replacing the Map entry
    const tabSplits = paneSizes.value.get(tabId);
    if (tabSplits) {
      paneSizes.value.set(tabId, new Map(tabSplits));
    }
  };

  const onUp = () => {
    window.removeEventListener("pointermove", onMove);
    window.removeEventListener("pointerup", onUp);
    window.removeEventListener("pointercancel", onUp);
    document.body.style.userSelect = "";
    document.body.style.cursor = "";
  };

  document.body.style.userSelect = "none";
  document.body.style.cursor = direction === "row" ? "col-resize" : "row-resize";
  window.addEventListener("pointermove", onMove, { passive: false });
  window.addEventListener("pointerup", onUp);
  window.addEventListener("pointercancel", onUp);
}

export function usePaneResize(): {
  paneSizes: Ref<Map<number, TabPaneSizes>>;
  getSplitSizes: (tabId: number, splitIndex: number, childCount: number) => number[];
  startResize: (
    event: PointerEvent,
    tabId: number,
    splitIndex: number,
    resizeIndex: number,
    direction: "row" | "col",
    containerEl: HTMLElement,
  ) => void;
  resetSizes: (tabId: number) => void;
} {
  return {
    paneSizes,
    getSplitSizes,
    startResize,
    resetSizes,
  };
}
