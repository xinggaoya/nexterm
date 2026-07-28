/**
 * [临时诊断] IME 候选框坐标偏差诊断工具。
 *
 * 用途:在 Windows 上定位"输入法候选框跑到右边"的根因层。
 * 用完删除本文件即可,不影响生产代码。
 *
 * 用法:在 TerminalPane.vue onMounted 里调用 attachImeDiagnostic(term)。
 * 打开 devtools console (F12),观察输出。
 *
 * 输出三组坐标对比:
 *   A. textarea.getBoundingClientRect() —— 浏览器报给 IME 的真实屏幕坐标
 *   B. 光标预期像素坐标 = cursorX * cellWidth + xterm 容器偏移
 *   C. textarea.style.left/top —— xterm 设置的 CSS 值
 * 若 A 偏右但 B 正确 → xterm textarea 定位对,问题在 getBoundingClientRect/WebView2
 * 若 B 也偏右 → xterm 光标坐标本身就错(TUI park 或 cellWidth 算错)
 * 若 C 是 -9999em → _syncTextArea 没执行
 */
import type { Terminal } from "@xterm/xterm";

export interface ImeDiagnosticSnapshot {
  /** 浏览器视角的 textarea 屏幕坐标(IME 用这个定位候选框) */
  textareaScreenRect: DOMRect | null;
  /** xterm 给 textarea 设的 CSS left/top */
  textareaCssLeft: string;
  textareaCssTop: string;
  /** 光标在 buffer 里的位置 */
  cursorX: number;
  cursorY: number;
  /** 光标是否在 viewport 内 */
  cursorInViewport: boolean;
  /** 是否正在 composition */
  isComposing: boolean;
  /** 单元格尺寸 */
  cellWidth: number;
  cellHeight: number;
  /** .xterm-screen 的屏幕坐标(textarea 定位基准) */
  screenRect: DOMRect | null;
  /** .xterm-helpers 的屏幕坐标(textarea 父容器) */
  helpersRect: DOMRect | null;
  /** 终端列数 */
  cols: number;
  rows: number;
}

export function captureImeDiagnostic(term: Terminal): ImeDiagnosticSnapshot | null {
  const el = term.element;
  if (!el) return null;
  const textarea = el.querySelector<HTMLTextAreaElement>("textarea.xterm-helper-textarea");
  const screen = el.querySelector<HTMLElement>(".xterm-screen");
  const helpers = el.querySelector<HTMLElement>(".xterm-helpers");
  const buf = term.buffer.active;

  return {
    textareaScreenRect: textarea?.getBoundingClientRect() ?? null,
    textareaCssLeft: textarea?.style.left ?? "(none)",
    textareaCssTop: textarea?.style.top ?? "(none)",
    cursorX: buf.cursorX,
    cursorY: buf.cursorY,
    cursorInViewport: buf.baseY + buf.cursorY >= buf.viewportY,
    isComposing: false, // composition 状态由事件追踪,见 attachImeDiagnostic
    cellWidth: 0, // 由 printSnapshot 用 screen.width / cols 现算
    cellHeight: 0,
    screenRect: screen?.getBoundingClientRect() ?? null,
    helpersRect: helpers?.getBoundingClientRect() ?? null,
    cols: term.cols,
    rows: term.rows,
  };
}

/**
 * 挂载周期性诊断输出,返回卸载函数。
 * 每秒在 console 打印一次坐标快照。
 */
export function attachImeDiagnostic(term: Terminal): () => void {
  let composing = false;
  const onCompositionStart = () => {
    composing = true;
    console.log("%c[IME-DIAG] compositionstart 触发", "color:orange;font-weight:bold");
    printSnapshot();
  };
  const onCompositionEnd = () => {
    composing = false;
  };

  const el = term.element;
  const textarea = el?.querySelector<HTMLTextAreaElement>("textarea.xterm-helper-textarea");
  textarea?.addEventListener("compositionstart", onCompositionStart);
  textarea?.addEventListener("compositionend", onCompositionEnd);

  const timer = setInterval(printSnapshot, 1000);

  function printSnapshot(): void {
    const snap = captureImeDiagnostic(term);
    if (!snap) return;
    const t = snap.textareaScreenRect;
    const s = snap.screenRect;
    console.log(
      "%c[IME-DIAG]\n" +
        `  cursor:        x=${snap.cursorX} y=${snap.cursorY} (inViewport=${snap.cursorInViewport}, cols=${snap.cols})\n` +
        `  textarea CSS:  left=${snap.textareaCssLeft} top=${snap.textareaCssTop}\n` +
        `  textarea 屏幕坐标(getBoundingClientRect): left=${t?.left.toFixed(1)} top=${t?.top.toFixed(1)} right=${t?.right.toFixed(1)}\n` +
        `  .xterm-screen 屏幕坐标: left=${s?.left.toFixed(1)} top=${s?.top.toFixed(1)} width=${s?.width.toFixed(1)}\n` +
        `  composing=${composing}`,
      "color:cyan",
    );
    if (s && t && snap.cursorX >= 0) {
      // 粗略估算光标预期屏幕 X = screen.left + cursorX * (screen.width / cols)
      const approxCellWidth = snap.cols > 0 ? s.width / snap.cols : 0;
      const expectedX = s.left + snap.cursorX * approxCellWidth;
      const offset = t.left - expectedX;
      console.log(
        `%c  → 光标预期 X ≈ ${expectedX.toFixed(1)}, textarea 实际 X = ${t.left.toFixed(1)}, 偏差 = ${offset.toFixed(1)}px${Math.abs(offset) > 20 ? " ⚠️ 偏差较大" : " ✓"}`,
        Math.abs(offset) > 20 ? "color:red;font-weight:bold" : "color:green",
      );
    }
  }

  // 立即打印一次
  printSnapshot();

  return () => {
    clearInterval(timer);
    textarea?.removeEventListener("compositionstart", onCompositionStart);
    textarea?.removeEventListener("compositionend", onCompositionEnd);
  };
}
