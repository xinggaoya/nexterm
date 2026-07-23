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
 * 三道防线必须同时存在,任一被误删即回归:
 * 1. .terminal-pane-body > .xterm 加 overflow:hidden → 结构层裁剪
 * 2. .composition-view 加 max-width:100% → 视觉层钳制(让 xterm 读回有界宽度)
 * 3. .xterm-helper-textarea 加 max-width:100% → 防御层兜底
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

  it("constrains .composition-view width so xterm reads back bounded geometry", () => {
    const rule = source.match(
      /\.terminal-pane-body\s+\.xterm\s+\.composition-view\s*\{([^}]*)\}/s,
    );
    expect(rule, ".composition-view rule must exist").not.toBeNull();
    expect(rule![1]).toMatch(/max-width:\s*100%/);
    expect(rule![1]).toMatch(/overflow:\s*hidden/);
  });

  it("caps .xterm-helper-textarea max-width as a defensive fallback", () => {
    const rule = source.match(
      /\.terminal-pane-body\s+\.xterm\s+\.xterm-helper-textarea\s*\{([^}]*)\}/s,
    );
    expect(rule, ".xterm-helper-textarea rule must exist").not.toBeNull();
    expect(rule![1]).toMatch(/max-width:\s*100%/);
  });
});
