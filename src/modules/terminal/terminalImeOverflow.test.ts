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
 * 修复分两层:
 * 1) 结构层:.terminal-pane-body > .xterm 加 overflow:hidden 成为裁剪容器
 *    —— 裁掉子元素视觉溢出,但【不改变子元素的 getBoundingClientRect】
 *    (父级 overflow 不影响子级布局尺寸测量),因此 xterm 仍能读到候选
 *    文本的真实宽度,IME 提交逻辑不受干扰。
 * 2) IME 锚点层:.xterm-helper-textarea 加 max-width:100% 钳制其渲染宽度。
 *    OS 的 IME 候选窗口锚定到该 textarea 的 caret(在 preedit 文本末尾),
 *    把 textarea 渲染宽度钳到 .xterm 内,caret 就不可能溢出屏幕外 → 候选
 *    窗口不会再被 OS 拉回屏幕左缘。这里只动 textarea 不动 .composition-view,
 *    因为 xterm CompositionHelper 读的是后者,改它会污染 IME 提交文本。
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

  it("constrains .xterm-helper-textarea width so IME candidate window stays inside the pane", () => {
    // 该规则内必须有 max-width: 100%。textarea 是 OS 定位 IME 候选窗口
    // 的依据,长候选时若不钳其渲染宽度,caret 会溢出屏幕外,OS 把候选
    // 窗口拉回屏幕左缘。.composition-view 不动(见上一条),所以 xterm
    // 读到的 .composition-view.getBoundingClientRect().width 仍然是自然宽度,
    // IME 提交文本不受影响。
    const rule = source.match(
      /\.terminal-pane-body\s+\.xterm\s+\.xterm-helper-textarea\s*\{([^}]*)\}/,
    );
    expect(
      rule,
      ".terminal-pane-body .xterm .xterm-helper-textarea rule must exist",
    ).not.toBeNull();
    expect(rule![1]).toMatch(/max-width:\s*100\s*%/);
  });
});
