import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";

const source = readFileSync(
  fileURLToPath(new URL("./TerminalPane.vue", import.meta.url)),
  "utf8",
);

/**
 * Boundary test:终端中文 IME 输入溢出修复。
 *
 * 根因:@xterm/xterm@6 的 CompositionHelper 在组字期间会按
 * .composition-view 的 getBoundingClientRect().width 重设内部
 * .xterm-helper-textarea 的宽度。候选文本较长时该宽度超过终端列宽,
 * 绝对定位的 textarea/composition-view 把 .xterm 的 scrollWidth 撑大,
 * 传导到外层 flex 布局 → 整体右移超出屏幕。
 *
 * 修复:只给 .terminal-pane-body > .xterm 加 overflow:hidden。
 * .xterm 是 position:relative,加 overflow:hidden 后成为裁剪容器 ——
 * 它裁掉子元素的视觉溢出,但【不改变子元素的 getBoundingClientRect】
 * (父级 overflow 不影响子级布局尺寸测量)。因此 xterm 仍能读到候选文本
 * 的真实宽度,IME 提交逻辑不受干扰。
 *
 * 关键约束:绝不能给 .composition-view 或 .xterm-helper-textarea 本身
 * 加 max-width / overflow —— 那会改它们自己的布局尺寸,让 xterm 读回
 * 错误宽度,导致选中的候选词与实际提交到终端的文本不一致(回归 bug)。
 */
describe("terminal IME overflow boundary", () => {
  it("clamps the xterm host with overflow:hidden so IME geometry cannot expand layout", () => {
    // .terminal-pane-body > .xterm 规则内必须含 overflow: hidden
    const rule = source.match(
      /\.terminal-pane-body\s*>\s*\.xterm\s*\{([^}]*)\}/s,
    );
    expect(rule, ".terminal-pane-body > .xterm rule must exist").not.toBeNull();
    expect(rule![1]).toMatch(/overflow:\s*hidden/);
  });

  it("does NOT constrain .composition-view size (would corrupt IME commit text)", () => {
    // 给 .composition-view 加 max-width / overflow 会改它自己的
    // getBoundingClientRect,让 xterm 读回错误宽度 → 候选词提交不一致。
    expect(source).not.toMatch(
      /\.composition-view[^{}]*\{[^}]*(?:max-width|overflow)/s,
    );
  });

  it("does NOT constrain .xterm-helper-textarea size (would corrupt IME commit text)", () => {
    // 给 .xterm-helper-textarea 加 max-width 会钳制 xterm 运行时设置的
    // inline width,干扰 IME 候选词的提交。
    expect(source).not.toMatch(
      /\.xterm-helper-textarea[^{}]*\{[^}]*(?:max-width)/s,
    );
  });
});
