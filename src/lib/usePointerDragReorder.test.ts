// @vitest-environment jsdom
import { defineComponent, h, nextTick } from "vue";
import { mount } from "@vue/test-utils";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import {
  usePointerDragReorder,
  type DragTarget,
} from "./usePointerDragReorder";

type Row = { id: number };

const rows: Row[] = [{ id: 1 }, { id: 2 }, { id: 3 }];

const originalElementFromPoint = document.elementFromPoint;
const elementFromPointMock = vi.fn((): Element | null => null);

/** 命中测试：x 落在哪个按钮的矩形区间内就返回哪个（jsdom 无真实布局）。 */
const rects = new Map<number, { left: number; right: number }>();
/** 最近一次探测点：`document.elementFromPoint` 的 mock 签名不收参数，用它回传坐标。 */
let lastProbeX = 0;

function resolveTarget(x: number): DragTarget<number> | null {
  for (const row of rows) {
    const rect = rects.get(row.id);
    if (rect && x >= rect.left && x < rect.right) {
      return { id: row.id, el: rowElement(row.id) };
    }
  }
  return null;
}

function rowElement(id: number): HTMLElement {
  const el = document.querySelector<HTMLElement>(`[data-row="${id}"]`);
  if (!el) throw new Error(`row ${id} not rendered`);
  return el;
}

function setRects(): void {
  rects.clear();
  for (const row of rows) {
    const el = rowElement(row.id);
    const left = (row.id - 1) * 100;
    el.getBoundingClientRect = () =>
      ({ left, right: left + 100, top: 0, bottom: 24, width: 100, height: 24 }) as DOMRect;
    rects.set(row.id, { left, right: left + 100 });
  }
}

// jsdom 的 MouseEvent 属性只读，trigger 不能带 clientX；改用构造器注入
// （与 SessionStrip.vue.test.ts 同一手法）。pointerId 缺省为 undefined，
// 手势内部的 pointerId 相等判定依然成立。
function fire(target: EventTarget, type: string, x = 0, y = 0, button = 0): void {
  target.dispatchEvent(
    new MouseEvent(type, { button, clientX: x, clientY: y, bubbles: true }),
  );
}

const pressSourceRow = (id = 1, x = 10, y = 5): void => {
  lastProbeX = x;
  fire(rowElement(id), "pointerdown", x, y);
};
function dragTo(x: number, y = 5): void {
  lastProbeX = x;
  fire(window, "pointermove", x, y);
}
const release = (x = 0, y = 5): void => {
  lastProbeX = x;
  fire(window, "pointerup", x, y);
};

type SetupOptions = {
  threshold?: number;
  enabled?: () => boolean;
  resolveGhost?: (id: number) => Row | null;
};

/** 用一个最小宿主组件跑 composable：三行按钮 + 真实的 pointerdown 接线。 */
function setup(options: SetupOptions = {}) {
  const onDrop = vi.fn();
  const onDraggingChange = vi.fn();
  let api: ReturnType<typeof usePointerDragReorder<Row, number>> | null = null;
  const Host = defineComponent({
    setup() {
      api = usePointerDragReorder<Row, number>({
        threshold: options.threshold,
        enabled: options.enabled,
        resolveTarget: (x) => resolveTarget(x),
        resolveGhost:
          options.resolveGhost ??
          ((id) => rows.find((row) => row.id === id) ?? null),
        onDrop,
        onDraggingChange,
      });
      return () =>
        h(
          "div",
          rows.map((row) =>
            h(
              "button",
              {
                "data-row": row.id,
                onPointerdown: (event: PointerEvent) => api!.startDrag(event, row.id),
              },
              String(row.id),
            ),
          ),
        );
    },
  });
  const wrapper = mount(Host, { attachTo: document.body });
  setRects();
  elementFromPointMock.mockImplementation(() => {
    const target = resolveTarget(lastProbeX);
    return target ? rowElement(target.id) : null;
  });
  return { wrapper, onDrop, onDraggingChange, api: () => api! };
}

beforeEach(() => {
  document.body.innerHTML = "";
  rects.clear();
  elementFromPointMock.mockReset();
  elementFromPointMock.mockReturnValue(null);
  // jsdom 没有实现 document.elementFromPoint，直接挂一个 mock。
  document.elementFromPoint =
    elementFromPointMock as unknown as typeof document.elementFromPoint;
});

afterEach(() => {
  document.elementFromPoint = originalElementFromPoint;
});

describe("usePointerDragReorder", () => {
  it("位移小于阈值时不算拖拽，落回目标行也不触发 drop", async () => {
    const { onDrop, api } = setup({ threshold: 20 });
    pressSourceRow(1, 10, 5);
    dragTo(15, 5);
    expect(api().draggingId.value).toBeNull();
    release(15, 5);
    expect(onDrop).not.toHaveBeenCalled();
    await nextTick();
  });

  it("越过阈值后按元素中线二分落点，pointerup 时触发 onDrop", async () => {
    const { onDrop, api } = setup();
    pressSourceRow(1, 10, 5);
    dragTo(120, 5); // 第 2 行左半区 [100,150)
    expect(api().draggingId.value).toBe(1);
    expect(api().dropTarget.value).toEqual({ id: 2, placement: "before" });

    dragTo(210, 5); // 第 3 行左半区 [200,250)
    expect(api().dropTarget.value).toEqual({ id: 3, placement: "before" });

    release(210, 5);
    expect(onDrop).toHaveBeenCalledWith(1, 3, "before");
    await nextTick();
  });

  it("右半区判为 after", async () => {
    const { onDrop, api } = setup();
    pressSourceRow(1, 10, 5);
    dragTo(260, 5); // 第 3 行右半区 [250,300)
    expect(api().dropTarget.value).toEqual({ id: 3, placement: "after" });
    release(260, 5);
    expect(onDrop).toHaveBeenCalledWith(1, 3, "after");
    await nextTick();
  });

  it("pointerup 位置与最后一帧 pointermove 不同时，以 pointerup 为准", async () => {
    const { onDrop } = setup();
    pressSourceRow(1, 10, 5);
    dragTo(120, 5);
    release(260, 5);
    expect(onDrop).toHaveBeenCalledWith(1, 3, "after");
    await nextTick();
  });

  it("指针不在任何行上时清空落点并放弃 drop", async () => {
    const { onDrop, api } = setup();
    pressSourceRow(1, 10, 5);
    dragTo(260, 5);
    expect(api().dropTarget.value).not.toBeNull();
    dragTo(999, 5);
    expect(api().dropTarget.value).toBeNull();
    release(999, 5);
    expect(onDrop).not.toHaveBeenCalled();
    await nextTick();
  });

  it("悬停源行自身不算落点", async () => {
    const { onDrop, api } = setup();
    pressSourceRow(2, 110, 5);
    dragTo(150, 5);
    expect(api().dropTarget.value).toBeNull();
    release(150, 5);
    expect(onDrop).not.toHaveBeenCalled();
    await nextTick();
  });

  it("拖动结束后抑制该行 400ms 内的 click，且只抑制一次", async () => {
    const { api } = setup();
    pressSourceRow(1, 10, 5);
    dragTo(160, 5);
    release(160, 5);

    expect(api().consumeSuppressedClick(1)).toBe(true);
    expect(api().consumeSuppressedClick(1)).toBe(false);
    expect(api().consumeSuppressedClick(2)).toBe(false);
    await nextTick();
  });

  it("未达到阈值的普通点击不抑制", async () => {
    const { api } = setup();
    pressSourceRow(1, 10, 5);
    release(10, 5);
    expect(api().consumeSuppressedClick(1)).toBe(false);
    await nextTick();
  });

  it("Esc 取消拖拽：清状态且不触发 onDrop", async () => {
    const { onDrop, api, onDraggingChange } = setup();
    pressSourceRow(1, 10, 5);
    dragTo(160, 5);
    expect(api().draggingId.value).toBe(1);

    window.dispatchEvent(
      new KeyboardEvent("keydown", { key: "Escape", bubbles: true, cancelable: true }),
    );
    expect(api().draggingId.value).toBeNull();
    expect(api().dropTarget.value).toBeNull();
    expect(api().ghost.value).toBeNull();
    expect(onDraggingChange).toHaveBeenLastCalledWith(false, 1);

    // 之后的 pointerup 不该再落 drop
    release(160, 5);
    expect(onDrop).not.toHaveBeenCalled();
    await nextTick();
  });

  it("Esc 在没有拖拽时不拦截按键", async () => {
    const { onDrop } = setup();
    const event = new KeyboardEvent("keydown", {
      key: "Escape",
      bubbles: true,
      cancelable: true,
    });
    window.dispatchEvent(event);
    expect(event.defaultPrevented).toBe(false);
    expect(onDrop).not.toHaveBeenCalled();
    await nextTick();
  });

  it("pointercancel 取消拖拽并回调 onDraggingChange(false)", async () => {
    const { api, onDraggingChange } = setup();
    pressSourceRow(1, 10, 5);
    dragTo(160, 5);
    expect(onDraggingChange).toHaveBeenCalledWith(true, 1);

    fire(window, "pointercancel", 160, 5);
    expect(api().draggingId.value).toBeNull();
    expect(api().dropTarget.value).toBeNull();
    expect(api().ghost.value).toBeNull();
    expect(onDraggingChange).toHaveBeenLastCalledWith(false, 1);
    await nextTick();
  });

  it("ghost 按 id 缓存：逐帧移动不重复解析负载", async () => {
    const resolveGhost = vi.fn((id: number) => rows.find((row) => row.id === id) ?? null);
    const { wrapper, api } = setup({ resolveGhost });
    pressSourceRow(1, 10, 5);
    dragTo(20, 5);
    dragTo(30, 5);
    dragTo(40, 5);
    expect(resolveGhost).toHaveBeenCalledTimes(1);
    expect(api().ghost.value).toMatchObject({ item: { id: 1 } });
    release(40, 5);
    wrapper.unmount();
    await nextTick();
  });

  it("启用判定不通过时不启动拖拽", async () => {
    const { onDrop, api } = setup({ enabled: () => false });
    pressSourceRow(1, 10, 5);
    dragTo(160, 5);
    expect(api().draggingId.value).toBeNull();
    release(160, 5);
    expect(onDrop).not.toHaveBeenCalled();
    await nextTick();
  });

  it("非主键不启动拖拽", async () => {
    const { onDrop, api } = setup();
    fire(rowElement(1), "pointerdown", 10, 5, 2);
    dragTo(160, 5);
    expect(api().draggingId.value).toBeNull();
    release(160, 5);
    expect(onDrop).not.toHaveBeenCalled();
    await nextTick();
  });

  it("组件卸载时摘掉 window 上的 pointer 监听", async () => {
    const removeSpy = vi.spyOn(window, "removeEventListener");
    const { wrapper } = setup();
    pressSourceRow(1, 10, 5);
    dragTo(160, 5);
    removeSpy.mockClear();
    wrapper.unmount();
    for (const type of ["pointermove", "pointerup", "pointercancel"]) {
      expect(removeSpy).toHaveBeenCalledWith(type, expect.any(Function));
    }
    await nextTick();
  });
});
