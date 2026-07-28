// @vitest-environment jsdom
import { beforeEach, describe, expect, it, vi } from "vitest";

const webglMocks = vi.hoisted(() => ({
  ctor: vi.fn(),
  dispose: vi.fn(),
  onContextLoss: vi.fn(() => ({ dispose: vi.fn() })),
  clearTextureAtlas: vi.fn(),
}));

vi.mock("@xterm/addon-webgl", () => ({
  WebglAddon: class {
    dispose = webglMocks.dispose;
    onContextLoss = webglMocks.onContextLoss;
    clearTextureAtlas = webglMocks.clearTextureAtlas;
    constructor(options?: { customGlyphs?: boolean }) {
      webglMocks.ctor(options);
    }
  },
}));

import { attachRendererPipeline } from "./rendererPipeline";

function makeTerminalStub() {
  return {
    loadAddon: vi.fn(),
    refresh: vi.fn(),
    rows: 24,
    setDevicePixelRatio: vi.fn(),
    clearTextureAtlas: vi.fn(),
  } as unknown as Parameters<typeof attachRendererPipeline>[0]["term"];
}

beforeEach(() => {
  webglMocks.ctor.mockReset();
  webglMocks.dispose.mockReset();
  webglMocks.onContextLoss.mockReset();
  webglMocks.onContextLoss.mockImplementation(() => ({ dispose: vi.fn() }));
});

describe("rendererPipeline", () => {
  it("attaches WebglAddon when preferred is webgl", () => {
    const term = makeTerminalStub();
    const pipeline = attachRendererPipeline({
      term,
      preferred: "webgl",
      autoFallback: true,
      watchDpi: false,
      customGlyphs: true,
    });
    expect(webglMocks.ctor).toHaveBeenCalled();
    // customGlyphs 应作为 WebglAddon 构造参数传入(xterm 6.1 起从 ITerminalOptions 迁出)
    expect(webglMocks.ctor).toHaveBeenCalledWith({ customGlyphs: true });
    expect(pipeline.active()).toBe("webgl");
    pipeline.dispose();
  });

  it("does not attach WebglAddon when preferred is dom", () => {
    const term = makeTerminalStub();
    const pipeline = attachRendererPipeline({
      term,
      preferred: "dom",
      autoFallback: true,
      watchDpi: false,
      customGlyphs: true,
    });
    expect(webglMocks.ctor).not.toHaveBeenCalled();
    expect(pipeline.active()).toBe("dom");
    pipeline.dispose();
  });

  it("switches from webgl to dom on setPreferred", () => {
    const term = makeTerminalStub();
    const pipeline = attachRendererPipeline({
      term,
      preferred: "webgl",
      autoFallback: true,
      watchDpi: false,
      customGlyphs: true,
    });
    expect(pipeline.active()).toBe("webgl");
    pipeline.setPreferred("dom");
    expect(pipeline.active()).toBe("dom");
    pipeline.dispose();
  });

  it("disposes the addon when dispose is called", () => {
    const term = makeTerminalStub();
    const pipeline = attachRendererPipeline({
      term,
      preferred: "webgl",
      autoFallback: true,
      watchDpi: false,
      customGlyphs: true,
    });
    pipeline.dispose();
    expect(webglMocks.dispose).toHaveBeenCalled();
  });

  it("treats 3+ context losses as permanent and switches to dom fallback", () => {
    let lossCallback: (() => void) | null = null;
    webglMocks.onContextLoss.mockImplementation(((cb: () => void) => {
      lossCallback = cb;
      return { dispose: vi.fn() };
    }) as never);
    const term = makeTerminalStub();
    const pipeline = attachRendererPipeline({
      term,
      preferred: "webgl",
      autoFallback: true,
      watchDpi: false,
      customGlyphs: true,
    });
    expect(lossCallback).not.toBeNull();
    expect(pipeline.active()).toBe("webgl");
    // 主动触发 3 次 context loss:应触发永久降级
    lossCallback!();
    lossCallback!();
    lossCallback!();
    expect(pipeline.active()).toBe("dom");
    // 之后尝试切回 webgl 应当被忽略(已知坏的驱动)
    pipeline.setPreferred("webgl");
    expect(pipeline.active()).toBe("dom");
    // 不会再构造新的 WebglAddon
    const ctorCallsBefore = webglMocks.ctor.mock.calls.length;
    pipeline.setPreferred("webgl");
    expect(webglMocks.ctor.mock.calls.length).toBe(ctorCallsBefore);
    pipeline.dispose();
  });
});