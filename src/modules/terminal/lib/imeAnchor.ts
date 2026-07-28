/**
 * IME 候选框锚点启发式 —— 把 xterm.js 的 IME 元素重定位到 TUI 的可见光标。
 *
 * 背景:Ink/React 风格的 TUI(Claude Code / Codex / Kimi Code 等)渲染完整帧后,
 * 把终端的"硬件光标"留在状态栏或输出区末尾,而在输入行单独用反相视频(SGR 7)
 * 画一个"软件光标"。xterm.js 的 IME 候选框锚定在硬件光标位置,于是候选框跑到
 * 输出区而非输入框。原生终端(Windows Terminal / iTerm2)能自行把候选框定位
 * 到真实屏幕坐标,不受此影响;web 终端(xterm.js)受浏览器沙箱限制做不到。
 *
 * 解法:compositionstart 时扫描可见 buffer,找单个反相视频单元格(即 TUI 的可见
 * 光标),把 .xterm-helper-textarea(浏览器据此定位候选框)和 .composition-view
 * (显示未确定文字)用 !important 钉到该单元格的像素坐标。用 MutationObserver
 * 对抗 xterm 内部 setTimeout 对样式的覆盖,用 onRender 跟踪 partial-commit 重绘。
 * 找不到反相单元格时(普通 shell / htop / vim insert)不做任何事,让 xterm 默认
 * 行为生效 —— 因为这些场景下硬件光标本来就停在 prompt 处。
 *
 * 算法吸收自 xterm-ime-anchor(msd.shsk, MIT)。该库未发布到 npm 且无第三方
 * 验证,故吸收为自有模块以便维护、加平台判断与调试钩子。
 *
 * Copyright (c) 2026 msd.shsk <msd.shsk@gmail.com>
 * Copyright (c) 2026 Nexterm contributors
 * SPDX-License-Identifier: MIT
 *
 * 相关上游追踪:
 * - xterm.js #5454 "Chinese IME shows input far from cursor when using AI CLIs"
 * - xterm.js #5734 / #5839 (IME 候选框定位)
 * - claude-code #25186 / #19207 (TUI 隐藏真光标导致 IME 错位)
 */

import type { Terminal } from "@xterm/xterm";

/** 锚点来源:heuristic = 找到反相单元格;hardware = 未找到,回退 xterm 默认。 */
export type ImeAnchorSource = "heuristic" | "hardware";

export interface ImeAnchor {
  source: ImeAnchorSource;
  /** 锚定的单元格列(0-based,视口内) */
  col: number;
  /** 锚定的单元格行(0-based,视口内) */
  row: number;
}

export interface AttachImeAnchorOptions {
  /**
   * 每次锚点计算后回调(成功或回退都会触发)。用于调试 / 遥测。
   */
  onAnchor?: (anchor: ImeAnchor) => void;
  /**
   * 若候选反相单元格的左右邻居也都是反相,通常是选中的菜单行高亮而非单格光标,
   * 应跳过。默认 true。
   */
  requireIsolatedCell?: boolean;
}

export interface ImeAnchorHandle {
  /** 卸载:移除所有监听与 observer,恢复 xterm 默认行为 */
  detach: () => void;
}

/**
 * 把 IME 锚点启发式挂到已 open 的 Terminal 上。
 *
 * term.element 必须已存在(term.open 之后)。若前置 DOM 元素缺失,返回一个
 * no-op handle,因此可在任何终端上无条件调用。
 */
export function attachImeAnchor(
  terminal: Terminal,
  options: AttachImeAnchorOptions = {},
): ImeAnchorHandle {
  const { onAnchor, requireIsolatedCell = true } = options;

  const root = terminal.element;
  if (!root) return noopHandle();

  // xterm.js 自 4.x 起稳定的 DOM 结构:
  //   .xterm > .xterm-screen > .xterm-helpers
  //     textarea.xterm-helper-textarea  (隐藏输入,浏览器据此定位 IME 候选框)
  //     .composition-view               (显示未确定/preedit 文本的可见 div)
  const textarea = root.querySelector<HTMLTextAreaElement>(
    "textarea.xterm-helper-textarea",
  );
  const screen = root.querySelector<HTMLElement>(".xterm-screen");
  const compositionView = root.querySelector<HTMLElement>(".composition-view");
  if (!textarea || !screen || !compositionView) return noopHandle();

  let composing = false;
  let pinned: { left: string; top: string } | null = null;
  let renderDisposable: { dispose: () => void } | null = null;

  // 单个 MutationObserver 挂在每个元素上 —— 只要 xterm 的递归 setTimeout 把
  // 硬件光标坐标写回去,就立刻重新钉回我们的锚点。
  const reapply = (el: HTMLElement): void => {
    if (!composing || !pinned) return;
    if (el.style.getPropertyValue("left") === pinned.left) return;
    el.style.setProperty("left", pinned.left, "important");
    el.style.setProperty("top", pinned.top, "important");
  };
  const moTextarea = new MutationObserver(() => reapply(textarea));
  const moComposition = new MutationObserver(() => reapply(compositionView));

  /** 由 .xterm-screen 实际几何尺寸反算单元格像素大小,适配任意字号/字宽。 */
  function computeCellSize(): { w: number; h: number } {
    const rect = screen!.getBoundingClientRect();
    return {
      w: rect.width / Math.max(terminal.cols, 1),
      h: rect.height / Math.max(terminal.rows, 1),
    };
  }

  /**
   * 在可见 buffer 里从右到左、自底向上扫描,找首个孤立的 isInverse() 单元格。
   * 自底向上 + 从右到左:让靠后的光标指示优先于更早的装饰性反相段(如状态条)。
   */
  function findInverseCell(): { col: number; row: number } | null {
    const buf = terminal.buffer.active;
    const startY = buf.baseY;
    const endY = startY + terminal.rows;
    for (let y = endY - 1; y >= startY; y -= 1) {
      const line = buf.getLine(y);
      if (!line) continue;
      for (let x = line.length - 1; x >= 0; x -= 1) {
        const cell = line.getCell(x);
        if (!cell) continue;
        // isInverse() 返回 number(0/1),非 0 即反相
        if (!cell.isInverse()) continue;

        if (requireIsolatedCell) {
          const left = x > 0 ? line.getCell(x - 1) : null;
          const right = x + 1 < line.length ? line.getCell(x + 1) : null;
          const leftInv = !!left && !!left.isInverse();
          const rightInv = !!right && !!right.isInverse();
          // 左右邻居都反相 → 选中行高亮,跳过
          if (leftInv && rightInv) continue;
        }

        return { col: x, row: y - startY };
      }
    }
    return null;
  }

  /** 把锚点像素坐标钉到两个 IME 元素上。 */
  function applyPin(left: string, top: string): void {
    pinned = { left, top };
    textarea!.style.setProperty("left", left, "important");
    textarea!.style.setProperty("top", top, "important");
    compositionView!.style.setProperty("left", left, "important");
    compositionView!.style.setProperty("top", top, "important");
  }

  /**
   * 重新扫描并更新锚点。在 compositionstart 与 composing 期间的每次 render 都调用。
   * 后者用于 IME partial-commit:用户持续输入时浏览器会触发 compositionend +
   * compositionstart 对,此刻 TUI 还没重绘(刚提交的文本还在去 PTY 的路上),
   * 光标的反相单元格仍在旧位置;几个 render tick 后 TUI 重绘出新光标,
   * 此 handler 会跟随上去。
   */
  function recomputeAndPin(): void {
    if (!composing) return;
    const hit = findInverseCell();
    if (!hit) {
      // 不重置 pinned:partial-commit 的渲染间隙可能瞬时丢失反相单元格
      // (TUI 先清后画),保留上一个已知锚点直到 composition 结束或找到新单元格。
      return;
    }
    const { w, h } = computeCellSize();
    const left = `${Math.round(hit.col * w)}px`;
    const top = `${Math.round(hit.row * h)}px`;
    if (pinned && pinned.left === left && pinned.top === top) return;
    applyPin(left, top);
    onAnchor?.({ source: "heuristic", col: hit.col, row: hit.row });
  }

  function onCompositionStart(): void {
    composing = true;
    const buf = terminal.buffer.active;
    // 启发式仅在 alternate buffer(TUI 模式)启用。普通 shell(normal buffer)
    // 用硬件光标,xterm 默认锚点本就正确;若此时 buffer 里残留 TUI 的反相
    // 元素(如输入框边框、状态条),启发式会误锁到残留位置。故 normal buffer
    // 直接回退 xterm 默认行为。
    if (buf.type !== "alternate") {
      pinned = null;
      onAnchor?.({
        source: "hardware",
        col: buf.cursorX,
        row: buf.cursorY,
      });
      return;
    }
    const hit = findInverseCell();
    if (!hit) {
      // 没有反相单元格 → 普通场景,让 xterm 默认硬件光标锚点生效。
      pinned = null;
      onAnchor?.({
        source: "hardware",
        col: buf.cursorX,
        row: buf.cursorY,
      });
      return;
    }
    const { w, h } = computeCellSize();
    applyPin(`${Math.round(hit.col * w)}px`, `${Math.round(hit.row * h)}px`);
    onAnchor?.({ source: "heuristic", col: hit.col, row: hit.row });
    // 跟踪后续 render —— 捕捉 partial-commit 时 TUI 重绘光标的场景。
    renderDisposable = terminal.onRender(() => recomputeAndPin());
  }

  function onCompositionEnd(): void {
    composing = false;
    pinned = null;
    renderDisposable?.dispose();
    renderDisposable = null;
    // 让 xterm 在下一次光标 tick 恢复自然定位。
  }

  textarea.addEventListener("compositionstart", onCompositionStart);
  textarea.addEventListener("compositionend", onCompositionEnd);
  moTextarea.observe(textarea, { attributes: true, attributeFilter: ["style"] });
  moComposition.observe(compositionView, {
    attributes: true,
    attributeFilter: ["style"],
  });

  return {
    detach(): void {
      composing = false;
      pinned = null;
      renderDisposable?.dispose();
      renderDisposable = null;
      textarea.removeEventListener("compositionstart", onCompositionStart);
      textarea.removeEventListener("compositionend", onCompositionEnd);
      moTextarea.disconnect();
      moComposition.disconnect();
    },
  };
}

function noopHandle(): ImeAnchorHandle {
  return { detach: () => {} };
}
