/**
 * 渲染器管线:WebGL → DOM 二级回退。
 *
 * xterm.js v6 官方 canvas addon 仍在 beta(0.8.x)且依赖 v5 内部 API,
 * 在 v6 上跑不起来,所以本期不接 canvas,WebGL 失败时直接降级 xterm 内置 DOM 渲染器。
 *
 * 设计目标(对齐 VSCode / Tabby):
 * - WebGL 可用时 attach WebglAddon,WebGL context loss 时主动 dispose
 * - 连续 N 次 context loss 视为永久故障,标记 webglBlocked,不再尝试
 * - 用户在设置里切到 DOM 时立即 dispose WebGL 并禁用后续 attach
 * - 切到 WebGL 时重新尝试 attach
 * - DPI 变化时主动调 setDevicePixelRatio + clearTextureAtlas + refresh
 *
 * 返回值 RendererPipeline 暴露 active()/setPreferred()/dispose(),供 TerminalPane
 * 状态栏显示与设置面板联动。
 */

import type { Terminal, IDisposable } from "@xterm/xterm";
import { WebglAddon } from "@xterm/addon-webgl";
import {
  currentDevicePixelRatio,
  watchDevicePixelRatio,
} from "./dpiWatcher";

export type RendererKind = "webgl" | "dom";

export interface RendererPipelineOptions {
  term: Terminal;
  /** 用户偏好:webgl / dom */
  preferred: RendererKind;
  /** 是否允许在 WebGL 失败后自动降级 DOM(默认 true) */
  autoFallback: boolean;
  /** HiDPI 监听开关,默认 true */
  watchDpi: boolean;
  /**
   * 是否用自定义字形绘制 box drawing / powerline / 进度条等字符。
   * xterm 6.1 起 customGlyphs 从 ITerminalOptions 移到 WebglAddon 选项,
   * 由 pipeline 在创建 WebGL addon 时传入。仅对 WebGL 渲染器生效。
   */
  customGlyphs: boolean;
}

export interface RendererPipeline {
  /** 当前实际生效的渲染器 */
  active: () => RendererKind;
  /** 切换用户偏好,会重新 attach/detach */
  setPreferred: (next: RendererKind) => void;
  /** 释放资源 */
  dispose: () => void;
}

const CONTEXT_LOSS_PERMANENT_THRESHOLD = 3;
const CONTEXT_LOSS_RETRY_DELAY_MS = 250;

interface WebglState {
  addon: WebglAddon;
  contextLossDisposable: IDisposable;
}

interface TerminalWithDpi {
  setDevicePixelRatio?: (value: number) => void;
}

export function attachRendererPipeline(
  opts: RendererPipelineOptions,
): RendererPipeline {
  let preferred = opts.preferred;
  let webgl: WebglState | null = null;
  let activeKind: RendererKind = "dom";
  let retryTimer: ReturnType<typeof setTimeout> | null = null;
  let disposed = false;

  // Module-scope 状态:context loss 计数与永久降级标记。
  // 用闭包变量(不挂在 WebglState 上)避免 detachWebgl 后 state
  // 被释放、降级标记丢失,导致后续 attachWebgl 仍会重建已知的坏 webgl。
  let contextLossCount = 0;
  let webglBlocked = false;

  const term = opts.term;
  const autoFallback = opts.autoFallback;

  function refreshAfterRendererChange(): void {
    if (disposed) return;
    try {
      term.refresh(0, Math.max(0, term.rows - 1));
    } catch {
      // renderer 重建期间刷新可能失败
    }
  }

  function detachWebgl(): void {
    if (!webgl) return;
    try {
      webgl.contextLossDisposable.dispose();
    } catch {
      // ignore
    }
    try {
      webgl.addon.dispose();
    } catch {
      // browser may have already released a lost context
    }
    webgl = null;
  }

  function scheduleRetry(): void {
    if (retryTimer !== null) return;
    retryTimer = setTimeout(() => {
      retryTimer = null;
      attachWebgl();
    }, CONTEXT_LOSS_RETRY_DELAY_MS);
  }

  function attachWebgl(): void {
    if (disposed || webgl || preferred !== "webgl") return;
    if (webglBlocked) return;
    let addon: WebglAddon;
    try {
      addon = new WebglAddon({ customGlyphs: opts.customGlyphs });
    } catch {
      // WebGL 初始化失败(无 GPU、驱动 bug、安全上下文)
      if (autoFallback) {
        activeKind = "dom";
      }
      return;
    }
    const state: WebglState = {
      addon,
      contextLossDisposable: { dispose: () => {} } as IDisposable,
    };
    state.contextLossDisposable = addon.onContextLoss(() => {
      // 每次 context loss 都计数;state 是闭包变量,即便 webgl 已被 detach
      // 也能正确累加。重复调用(stale callback)只会多算一次,可忽略。
      contextLossCount += 1;
      detachWebgl();
      if (contextLossCount >= CONTEXT_LOSS_PERMANENT_THRESHOLD) {
        // 连续多次丢失 → 永久降级 DOM,避免反复重建
        webglBlocked = true;
        if (autoFallback) {
          preferred = "dom";
          activeKind = "dom";
        }
        return;
      }
      // 给驱动一点时间恢复,然后再试一次
      scheduleRetry();
    });
    try {
      term.loadAddon(addon);
      webgl = state;
      activeKind = "webgl";
      refreshAfterRendererChange();
    } catch {
      // loadAddon 失败时回退 DOM
      try {
        addon.dispose();
      } catch {
        // ignore
      }
      if (autoFallback) {
        activeKind = "dom";
      }
    }
  }

  function setPreferred(next: RendererKind): void {
    if (disposed || next === preferred) return;
    preferred = next;
    if (next === "webgl") {
      if (webglBlocked) {
        // 用户在永久降级后还想切回 webgl,需要显式重置阻塞标记;
        // 当前实现保守起见直接忽略,避免在已知坏的驱动上反复 attach。
        return;
      }
      attachWebgl();
    } else {
      if (retryTimer !== null) {
        clearTimeout(retryTimer);
        retryTimer = null;
      }
      detachWebgl();
      activeKind = "dom";
      refreshAfterRendererChange();
    }
  }

  // 启动时按 preferred attach
  if (preferred === "webgl") {
    attachWebgl();
  } else {
    activeKind = "dom";
  }

  const termWithDpi = term as unknown as TerminalWithDpi;

  // DPI 监听
  const stopDpi = opts.watchDpi
    ? watchDevicePixelRatio((dpr) => {
        try {
          termWithDpi.setDevicePixelRatio?.(dpr);
          // 重建字符纹理
          if (webgl) {
            try {
              webgl.addon.clearTextureAtlas();
            } catch {
              // ignore
            }
          }
          term.clearTextureAtlas();
          refreshAfterRendererChange();
        } catch {
          // some browsers throw on dispose during refresh
        }
      })
    : () => {};
  // 初始同步一次 dpr
  try {
    termWithDpi.setDevicePixelRatio?.(currentDevicePixelRatio());
  } catch {
    // ignore
  }

  function dispose(): void {
    if (disposed) return;
    disposed = true;
    if (retryTimer !== null) {
      clearTimeout(retryTimer);
      retryTimer = null;
    }
    detachWebgl();
    stopDpi();
  }

  return {
    active: () => activeKind,
    setPreferred,
    dispose,
  };
}