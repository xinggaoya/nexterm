import { readFileSync } from "node:fs";
import { join } from "node:path";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";

const terminalDir = fileURLToPath(new URL(".", import.meta.url));
function readSource(relativePath: string): string {
  return readFileSync(join(terminalDir, relativePath), "utf8");
}

describe("terminal module wiring (source-level contracts)", () => {
  it("wires the resizer's resize/reset events into the pane tree", () => {
    const source = readSource("TerminalTreeNode.vue");
    expect(source).toMatch(/@resize=/);
    expect(source).toMatch(/@reset=/);
    expect(source).toMatch(/emit\("resize"/);
    expect(source).toMatch(/emit\("reset"/);
  });

  it("forwards the pane header's close/split/rename events to the host", () => {
    for (const file of ["TerminalTreeNode.vue", "TerminalWorkspace.vue"]) {
      const source = readSource(file);
      expect(source, file).toMatch(/@close=/);
      expect(source, file).toMatch(/@split=/);
    }
    expect(readSource("TerminalWorkspace.vue")).toMatch(/@rename=/);
    expect(readSource("TerminalPane.vue")).toMatch(/@rename=/);
  });

  it("captures Ctrl+F for the in-terminal find panel", () => {
    const source = readSource("lib/shortcuts.ts");
    expect(source).toMatch(/onFind/);
  });

  it("renders the find panel and drives SearchAddon from the pane", () => {
    // TerminalSearch + SearchAddon 都已存在但零引用 → 终端里 Ctrl+F 根本不工作。
    const pane = readSource("TerminalPane.vue");
    expect(pane).toMatch(/TerminalSearch/);
    expect(pane).toMatch(/renderer\?\.search/);
  });

  it("shows a jump-to-latest affordance when scrolled away from the bottom", () => {
    const pane = readSource("TerminalPane.vue");
    expect(pane).toMatch(/linesFromBottom/);
    expect(pane).toMatch(/data-terminal-scroll-latest/);
  });

  it("routes every terminal context-menu label through i18n", () => {
    // 以前是硬编码的 label: "Copy" / "Paste" / "Select All"，zh-CN 用户看到英文。
    const menu = readSource("TerminalContextMenu.vue");
    expect(menu).not.toMatch(/label:\s*"(Copy|Paste|Select All)"/);
    expect(menu).toMatch(/label: t\(/);
  });

  it("intercepts the paste at term.paste so no entry point can bypass the guard", () => {
    // 只拦右键菜单等于没做：普通 Ctrl+V（xterm 自己的 paste 事件）和中键
    // 主选区同样能触发“一贴就提交”。守卫必须挂在 term.paste 这一层。
    const renderer = readSource("lib/renderer.ts");
    expect(renderer).toMatch(/term\.paste\.bind\(term\)/);
    expect(renderer).toMatch(/setPasteInterceptor/);
    // 右键粘贴不能再自己 readClipboardText 后直写，得回到 term.paste。
    const pane = readSource("TerminalPane.vue");
    expect(pane).toMatch(/term\.paste\(text\)/);
  });
});
