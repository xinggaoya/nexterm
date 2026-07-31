// @vitest-environment jsdom
import { mount, type VueWrapper } from "@vue/test-utils";
import { nextTick } from "vue";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import type { Terminal } from "@xterm/xterm";
import type { TerminalRenderer } from "./lib/renderer";

// jsdom 默认没有 ResizeObserver；TerminalPane.onMounted 内部会 new 它并
// observe(host)。这里提供一个可控制的实现：捕获 observe 的回调,测试可
// 通过 triggerResize 手动模拟「容器尺寸变化」(尤其 0→非0,模拟工作区从
// v-show 隐藏切回可见),验证 redraw 补画逻辑。
type ResizeCb = (entries: { contentRect: { width: number; height: number } }[]) => void;
class ResizeObserverStub {
  private cb: ResizeCb | null = null;
  observe(): void {}
  unobserve(): void {}
  disconnect(): void {
    this.cb = null;
  }
  constructor(cb: ResizeCb) {
    capturedResizeObservers.push(this);
    this.cb = cb;
  }
  trigger(w: number, h: number): void {
    this.cb?.([{ contentRect: { width: w, height: h } }]);
  }
}
const capturedResizeObservers: ResizeObserverStub[] = [];
(globalThis as unknown as { ResizeObserver: typeof ResizeObserverStub }).ResizeObserver =
  ResizeObserverStub;

// requestAnimationFrame 同步执行：watch(isActive) 内部用 rAF 把 redraw
// 排到下一帧；测试中我们用微任务 + nextTick 链已经能稳定推到 watch 后
// 调 rAF 回调，把 rAF 改成同步执行能让一次 flush 跑完整个挂载 + 跳变路径。
const origRaf = globalThis.requestAnimationFrame;
beforeEach(() => {
  globalThis.requestAnimationFrame = ((cb: FrameRequestCallback) => {
    cb(0);
    return 0;
  }) as typeof globalThis.requestAnimationFrame;
});
afterEach(() => {
  globalThis.requestAnimationFrame = origRaf;
});

// 重依赖 stub：TerminalPane 在 onMounted 内做大量 init（创建 xterm 实例、
// 加载字体、attach 渲染器管线、挂 PTY 监听）。本测试只关心 watch(isActive)
// 触发 redraw 这条契约，因此把这些 init 路径整片 mock 掉，让组件能 mount
// 完成、renderer 被赋值到模块作用域 let 上。

const fakeTerm: Terminal = {
  cols: 80,
  rows: 24,
  onData: vi.fn(),
  onResize: vi.fn(),
  write: vi.fn(),
  refresh: vi.fn(),
  clearTextureAtlas: vi.fn(),
} as unknown as Terminal;

const fakeRenderer: TerminalRenderer = {
  term: fakeTerm,
  fit: vi.fn(),
  applyTypography: vi.fn(async () => undefined),
  setScrollback: vi.fn(),
  setRenderer: vi.fn(),
  activeRenderer: (): "dom" | "webgl" => "dom",
  redraw: vi.fn(),
  dispose: vi.fn(),
};

vi.mock("./lib/renderer", () => ({
  createTerminalRenderer: vi.fn(async () => fakeRenderer),
}));

vi.mock("./lib/sessions", () => ({
  createSession: vi.fn(async () => ({
    leafId: "leaf-1",
    ptyId: 1,
    dispose: vi.fn(),
    write: vi.fn(),
    resize: vi.fn(),
    restart: vi.fn(),
    getState: () => "running",
    getExitCode: () => undefined,
    setCallbacks: vi.fn(),
  })),
  trackSession: vi.fn(),
  getSessionForLeaf: vi.fn(() => undefined),
  disposeSession: vi.fn(),
}));

vi.mock("./lib/shortcuts", () => ({
  attachClipboardShortcuts: vi.fn(() => () => undefined),
}));

vi.mock("./lib/theme", () => ({
  applyTerminalTheme: vi.fn(),
  watchTerminalTheme: vi.fn(() => () => undefined),
}));

vi.mock("@/app/workspaceContext", () => ({
  tryWorkspaceContext: () => ({
    workspace: {
      id: "ws-1",
      rootPath: "/repo",
      env: { kind: "local" },
      name: "repo",
      openedAt: 0,
    },
    wsNative: {
      workspaceAuthorize: vi.fn(async () => undefined),
      ptyOpen: vi.fn(),
    },
  }),
  useWorkspaceContext: () => ({
    workspace: {
      id: "ws-1",
      rootPath: "/repo",
      env: { kind: "local" },
      name: "repo",
      openedAt: 0,
    },
    wsNative: {
      workspaceAuthorize: vi.fn(async () => undefined),
      ptyOpen: vi.fn(),
    },
  }),
  provideWorkspaceContext: vi.fn(),
  WORKSPACE_CONTEXT_KEY: Symbol("workspace-context"),
}));

vi.mock("@/lib/clipboard", () => ({
  readClipboardText: vi.fn(async () => ""),
  writeClipboardText: vi.fn(async () => undefined),
}));

// Pinia store TerminalPane 间接用（prefs/terminalRenderer 等字段），但
// createTerminalRenderer / applyTerminalTheme 都被 mock，组件不再读 prefs
// 内部字段——usePreferencesPiniaStore 仍需可调用。
vi.mock("@/modules/settings/preferencesPinia", () => ({
  usePreferencesPiniaStore: () => ({
    terminalFontFamily: "JetBrains Mono",
    terminalFontSize: 14,
    terminalLetterSpacing: 0,
    terminalFontWeight: 400,
    terminalFontWeightBold: 700,
    terminalScrollback: 5000,
    terminalRenderer: "dom",
    terminalRendererAutoFallback: true,
    terminalCursorStyle: "block",
    terminalCursorBlink: true,
    terminalCursorInactiveStyle: "outline",
    terminalFastScrollSensitivity: 5,
    terminalFastScrollModifier: "alt",
    terminalMacOptionIsMeta: true,
    terminalMacOptionClickForcesSelection: false,
    terminalMinimumContrastRatio: 1,
    terminalDrawBoldTextInBrightColors: true,
    terminalCustomGlyphs: false,
    terminalRescaleOverlappingGlyphs: true,
    terminalNerdFontEnabled: true,
    terminalCjkFontEnabled: true,
    terminalEmojiFontEnabled: true,
    terminalContextMenuEnabled: true,
  }),
}));

import TerminalPane from "./TerminalPane.vue";

async function flush(): Promise<void> {
  // 推完 microtask + 一次 nextTick，覆盖 onMounted 内的 await 链路
  // 与 rAF（rAF 需要再推一次 microtask + nextTick）。
  for (let i = 0; i < 6; i += 1) {
    await Promise.resolve();
    await nextTick();
  }
}

describe("TerminalPane.vue", () => {
  let host: HTMLDivElement | null = null;
  let wrapper: VueWrapper | null = null;

  beforeEach(() => {
    vi.clearAllMocks();
    capturedResizeObservers.length = 0;
    host = document.createElement("div");
    document.body.appendChild(host);
  });

  afterEach(() => {
    if (wrapper) {
      wrapper.unmount();
      wrapper = null;
    }
    if (host) {
      host.remove();
      host = null;
    }
  });

  it("calls renderer.redraw on the false→true isActive transition", async () => {
    // isActive=false 起步：监听 canvas 重绘丢失的修复路径，模拟
    // "display:none 切回可见" 时 false→true 跳变触发补画。
    wrapper = mount(TerminalPane, {
      attachTo: host!,
      props: { leafId: "1", isActive: false, isFocused: false, flex: 1 },
    });
    await flush();
    expect(fakeRenderer.redraw).not.toHaveBeenCalled();

    await wrapper.setProps({ isActive: true });
    await flush();
    expect(fakeRenderer.fit).toHaveBeenCalled();
    expect(fakeRenderer.redraw).toHaveBeenCalledTimes(1);
  });

  it("does not call redraw when isActive stays true on remount", async () => {
    // 首次挂载即为 active（首个终端常见情况）：watch 不应被触发补画。
    wrapper = mount(TerminalPane, {
      attachTo: host!,
      props: { leafId: "1", isActive: true, isFocused: false, flex: 1 },
    });
    await flush();
    expect(fakeRenderer.redraw).not.toHaveBeenCalled();
  });

  it("does not call redraw when isActive goes from true to false", async () => {
    // 切走时不应主动 redraw——display:none 期间浏览器自然停画，调用
    // redraw 反而会无谓地消耗 CPU。
    wrapper = mount(TerminalPane, {
      attachTo: host!,
      props: { leafId: "1", isActive: true, isFocused: false, flex: 1 },
    });
    await flush();
    await wrapper.setProps({ isActive: false });
    await flush();
    expect(fakeRenderer.redraw).not.toHaveBeenCalled();
  });

  it("does not call fit when container is hidden and redraws on switch back (workspace switch)", async () => {
    // 根因(经实测日志确认): 工作区切换靠 v-show(display:none)实现,隐藏期间
    // ResizeObserver 仍会触发并报告 0 尺寸。若此时调 fit(),FitAddon 会读
    // getComputedStyle().height='auto' → 算出 cols=2(其 MINIMUM_COLS) →
    // term.resize(2,1) → xterm buffer reflow 把提示符「➜  repo git:(master)」
    // 按 2 列折行不可逆切碎。切回后 resize 回原尺寸,但 reflow 损坏的 buffer
    // 已无法恢复。所以必须在 0 尺寸时从源头拦住 fit 调用。
    wrapper = mount(TerminalPane, {
      attachTo: host!,
      props: { leafId: "1", isActive: true, isFocused: false, flex: 1 },
    });
    await flush();
    const ro = capturedResizeObservers[0];
    expect(ro).toBeTruthy();
    // 先喂正常尺寸,模拟首次可见。lastObservedW/H 初始为 0,首次非0也触发 redraw
    // (无害的初始补画)。
    ro!.trigger(800, 600);
    await flush();
    const fitAfterFirstShow = (fakeRenderer.fit as ReturnType<typeof vi.fn>).mock.calls.length;
    const redrawsAfterFirstShow = (fakeRenderer.redraw as ReturnType<typeof vi.fn>).mock.calls.length;
    expect(fitAfterFirstShow).toBeGreaterThanOrEqual(1);
    expect(redrawsAfterFirstShow).toBeGreaterThanOrEqual(1);

    // 切走工作区:display:none → 容器尺寸归 0。此时绝不能调 fit(会损坏 buffer)。
    ro!.trigger(0, 0);
    await flush();
    expect((fakeRenderer.fit as ReturnType<typeof vi.fn>).mock.calls.length).toBe(fitAfterFirstShow);
    expect((fakeRenderer.redraw as ReturnType<typeof vi.fn>).mock.calls.length).toBe(redrawsAfterFirstShow);

    // 切回工作区:尺寸从 0 恢复到非 0 → 必须 fit(恢复正常尺寸)+ redraw(补画)。
    ro!.trigger(800, 600);
    await flush();
    expect((fakeRenderer.fit as ReturnType<typeof vi.fn>).mock.calls.length).toBe(fitAfterFirstShow + 1);
    expect((fakeRenderer.redraw as ReturnType<typeof vi.fn>).mock.calls.length).toBe(redrawsAfterFirstShow + 1);
  });

  it("does not call redraw on size changes between two non-zero sizes", async () => {
    // 分屏拖动等导致的同向尺寸变化(始终非 0)不应触发补画 —— 那只是普通 fit,
    // canvas 仍在绘制,不需要 redraw。redraw 只针对"从隐藏切回"这一跳变。
    wrapper = mount(TerminalPane, {
      attachTo: host!,
      props: { leafId: "1", isActive: true, isFocused: false, flex: 1 },
    });
    await flush();
    const ro = capturedResizeObservers[0];
    // 初始化为非 0
    ro!.trigger(800, 600);
    await flush();
    const redrawsBefore = (fakeRenderer.redraw as ReturnType<typeof vi.fn>).mock.calls.length;

    // 同向变化(仍是非 0 尺寸)不应触发 redraw。
    ro!.trigger(600, 400);
    await flush();
    expect((fakeRenderer.redraw as ReturnType<typeof vi.fn>).mock.calls.length).toBe(redrawsBefore);
  });
});
