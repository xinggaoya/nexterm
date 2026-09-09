import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";
import { ACCENT_PRESETS } from "@/modules/settings/store";

const globalsCss = readFileSync(
  new URL("./globals.css", import.meta.url),
  "utf8",
);

function readSource(path: string): string {
  return readFileSync(new URL(path, import.meta.url), "utf8");
}

describe("visual system contract", () => {
  it("declares semantic workbench and status tokens for both themes", () => {
    expect(globalsCss).toContain("--shell-bg:");
    expect(globalsCss).toContain("--surface-subtle:");
    expect(globalsCss).toContain("--surface-hover:");
    expect(globalsCss).toContain("--success:");
    expect(globalsCss).toContain("--warning:");
    expect(globalsCss).toContain("--info:");

    const darkTheme = globalsCss.slice(globalsCss.indexOf(".dark {"));
    expect(darkTheme).toContain("--shell-bg:");
    expect(darkTheme).toContain("--success:");
    expect(darkTheme).toContain("--warning:");
  });

  it("provides shared surface, toolbar, row, icon button and overlay rules", () => {
    expect(globalsCss).toContain(".nexterm-surface");
    expect(globalsCss).toContain(".nexterm-toolbar");
    expect(globalsCss).toContain(".nexterm-row");
    expect(globalsCss).toContain(".nexterm-icon-button");
    expect(globalsCss).toContain(".nexterm-overlay");
  });

  it("uses the terminal-first shell dimensions (rail / top bar / status dock)", () => {
    // 终端优先壳层:52px 工作区轨道 + 44px 单一顶栏 + 24px 状态坞。
    const rail = readSource("../app/shell/Rail.vue");
    expect(rail).toContain("w-[52px]");
    expect(rail).toContain("data-workspace-rail");

    const topBar = readSource("../app/shell/TopBar.vue");
    expect(topBar).toContain("h-11");
    expect(topBar).toContain(`:aria-label="t('app.header.openCommandCenter')"`);
    expect(topBar).toContain(`:aria-label="t('common.settings')"`);

    expect(readSource("../app/shell/SessionStrip.vue")).toContain("h-7");
    expect(readSource("../app/shell/StatusDock.vue")).toContain("h-6");

    // 单终端极简模式:会话条退化为面包屑芯片。
    const strip = readSource("../app/shell/SessionStrip.vue");
    expect(strip).toContain("data-session-minimal");
    expect(strip).toContain("data-session-strip");
  });

  it("keeps the terminal canvas full-bleed with floating glass overlays", () => {
    const host = readSource("../app/shell/WorkspaceHost.vue");
    const canvas = readSource("../app/shell/Canvas.vue");

    // Host 组合:轨道 → 顶栏(内嵌会话条) → 画布 → 状态坞。
    expect(host).toMatch(/<Rail[\s\S]*?<TopBar[\s\S]*?<SessionStrip/);
    expect(host).toMatch(/<Canvas[\s\S]*?<StatusDock/);

    // 画布:终端层铺满,浮层玻璃容器挂在画布内。
    expect(canvas).toMatch(/<TerminalWorkspace/);
    expect(canvas).toMatch(/<OverlayPanel[\s\S]*?<FileExplorer/);
    expect(canvas).toMatch(/<OverlayPanel[\s\S]*?<SourceControlPanel/);
    expect(canvas).toMatch(/<OverlayPanel[\s\S]*?<TaskConsole/);

    // 浮层使用玻璃令牌,而不是实心卡片。
    const overlay = readSource("../app/shell/OverlayPanel.vue");
    expect(overlay).toContain("v2-glass");
    expect(overlay).toContain("nexterm-overlay-panel");
  });

  it("forces Naive UI settings cards into unframed groups", () => {
    expect(globalsCss).toMatch(
      /\.nexterm-settings-group\.n-card\s*{[\s\S]*border:\s*0\s*!important;[\s\S]*border-radius:\s*0\s*!important;/,
    );
  });

  it("keeps overlays and module status colors on the shared semantic system", () => {
    for (const path of [
      "../app/shell/TabContextMenu.vue",
      "../modules/explorer/ExplorerContextMenu.vue",
      "../modules/commands/CommandPalette.vue",
    ]) {
      // 重做后的右键菜单(TerminalContextMenu / ExplorerContextMenu)使用
      // Naive UI 的 NDropdown 替代手写的 nexterm-overlay 容器;这里接受
      // 任一形态以便菜单重构滚动进行。
      const source = readSource(path);
      expect(
        source.includes("nexterm-overlay") || source.includes("NDropdown"),
      ).toBe(true);
    }

    for (const path of [
      "../modules/editor/EditorToolbar.vue",
      "../modules/editor/GitDiffPane.vue",
      "../modules/explorer/FileTreeRow.vue",
      "../modules/git-history/GitHistoryPane.vue",
      "../modules/preview/PreviewPane.vue",
      "../modules/preview/PreviewAddressBar.vue",
      "../modules/source-control/SourceControlPanel.vue",
    ]) {
      expect(readSource(path)).not.toMatch(
        /(?:text|bg|border)-(?:amber|emerald|rose)-/,
      );
    }
  });

  it("uses continuous surfaces for editor-adjacent content panes", () => {
    for (const path of [
      "../modules/editor/GitDiffPane.vue",
      "../modules/markdown/MarkdownPreviewPane.vue",
      "../modules/preview/PreviewPane.vue",
    ]) {
      const source = readSource(path);
      expect(source).toContain("nexterm-surface");
      expect(source).not.toContain("rounded-md border border-border/60");
    }
  });

  it("keeps xterm-consumed custom properties concrete", () => {
    // `--term-bg` / `--term-fg` are only declared once per mode (no accent
    // overrides — they belong to the neutral surface). The rest are also
    // overridden by every accent preset in both modes.
    const expectedCounts: Record<string, number> = {
      "term-bg": 2,
      "term-fg": 2,
      "term-cursor": 2 + ACCENT_PRESETS.length * 2,
      "term-cursor-accent": 2 + ACCENT_PRESETS.length * 2,
      "term-selection": 2 + ACCENT_PRESETS.length * 2,
      "term-link": 2 + ACCENT_PRESETS.length * 2,
    };
    for (const [name, expected] of Object.entries(expectedCounts)) {
      const declarations = globalsCss.match(
        new RegExp(`--${name}:\\s*([^;]+);`, "g"),
      );
      expect(declarations?.length).toBe(expected);
      expect(declarations?.every((value) => !value.includes("var("))).toBe(true);
    }
  });

  it("declares an accent override block for every preset in both modes", () => {
    for (const preset of ACCENT_PRESETS) {
      const lightRegex = new RegExp(
        `html\\[data-accent="${preset}"\\][\\s\\S]*?--primary:[\\s\\S]*?--term-cursor:`,
      );
      const darkRegex = new RegExp(
        `\\.dark\\[data-accent="${preset}"\\][\\s\\S]*?--primary:[\\s\\S]*?--term-cursor:`,
      );
      expect(globalsCss).toMatch(lightRegex);
      expect(globalsCss).toMatch(darkRegex);
    }
  });
});
