import { readdirSync, readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import { ACCENT_PRESETS } from "@/modules/settings/store";

const globalsCss = readFileSync(
  new URL("./globals.css", import.meta.url),
  "utf8",
);

const SRC_ROOT = fileURLToPath(new URL("../", import.meta.url));

/**
 * 自绘 window chrome 的窗口外框圆角是「操作系统窗口的形状」，
 * 不属于 UI 圆角档位体系（它要跟着操作系统走，不跟主题走），
 * 因此从圆角契约里排除。
 */
const cssWithoutWindowChrome = globalsCss.replace(
  /html\[data-chrome="borderless"\]\s*#root\s*\{[^}]*\}/,
  "",
);

function readSource(path: string): string {
  return readFileSync(new URL(path, import.meta.url), "utf8");
}

/** 收集 src/ 下参与圆角契约的源码文件（跳过测试文件自身）。 */
function collectSourceFiles(dir: string, out: string[] = []): string[] {
  for (const entry of readdirSync(dir, { withFileTypes: true })) {
    const full = join(dir, entry.name);
    if (entry.isDirectory()) {
      collectSourceFiles(full, out);
      continue;
    }
    if (!/\.(vue|ts)$/.test(entry.name)) continue;
    if (/\.(test|spec)\.(ts|tsx)$/.test(entry.name)) continue;
    out.push(full);
  }
  return out;
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

  it("declares corner radii on the shared two-tier scale", () => {
    // 圆角定义必须落在普通 @theme 块（变量真实输出到 :root），
    // 而不能留在 @theme inline 里 —— inline 会把值烘焙成字面量，
    // Tailwind 工具类 / 手写 CSS / Naive themeOverrides 就无法共用同一份数值。
    const inlineStart = globalsCss.indexOf("@theme inline {");
    expect(inlineStart).toBeGreaterThan(-1);
    const inlineBlock = globalsCss.slice(
      inlineStart,
      globalsCss.indexOf("\n}", inlineStart),
    );
    expect(inlineBlock).not.toMatch(/--radius-/);

    // 普通 @theme 块承载 8 个档位。
    // 控件档 xs/sm/md 数值紧凑，容器档 lg 起明显放大。
    const themeStart = globalsCss.indexOf("@theme {");
    expect(themeStart).toBeGreaterThan(-1);
    const themeBlock = globalsCss.slice(
      themeStart,
      globalsCss.indexOf("\n}", themeStart),
    );
    expect(themeBlock).toContain("--radius-xs: 2px;");
    expect(themeBlock).toContain("--radius-sm: 4px;");
    expect(themeBlock).toContain("--radius-md: 6px;");
    expect(themeBlock).toContain("--radius-lg: 12px;");
    expect(themeBlock).toContain("--radius-xl: 16px;");
    expect(themeBlock).toContain("--radius-2xl: 20px;");
    expect(themeBlock).toContain("--radius-3xl: 24px;");
    expect(themeBlock).toContain("--radius-4xl: 28px;");

    // 裸 rounded 的兜底值保留在 unlayered :root，优先级高于 @layer theme。
    expect(globalsCss).toContain("--radius: 10px;");
  });

  it("keeps hand-written radii on the shared radius scale", () => {
    // 手写 CSS 里的圆角必须引用 token，不再出现字面量 px。
    // 0（去框）、999px（胶囊）、50%（椭圆）是刻意的例外。
    const cssRadius = [
      ...cssWithoutWindowChrome.matchAll(/border-radius:\s*([^;]+);/g),
    ].map((m) => m[1].trim().replace(/\s*!important$/, ""));
    expect(cssRadius.length).toBeGreaterThan(0);
    for (const value of cssRadius) {
      expect(value).toMatch(/^(0|999px|50%|var\(--radius-[a-z0-9-]+\))$/);
    }
  });

  it("keeps style-block radii on the shared radius scale", () => {
    // 组件 <style> 块里的字面量 px 圆角必须换成 token。
    // 999px（圆形）是刻意的例外。
    const offenders: string[] = [];
    for (const file of collectSourceFiles(SRC_ROOT)) {
      const source = readFileSync(file, "utf8");
      source.split("\n").forEach((line, index) => {
        const hit = line.match(/border-radius:\s*(\d+)px/);
        if (hit && hit[1] !== "999") {
          offenders.push(`${file}:${index + 1} 字面量圆角 ${hit[1]}px`);
        }
      });
    }
    expect(offenders).toEqual([]);
  });

  it("provides shared surface, toolbar, row, icon button and overlay rules", () => {
    expect(globalsCss).toContain(".nexterm-surface");
    expect(globalsCss).toContain(".nexterm-toolbar");
    expect(globalsCss).toContain(".nexterm-row");
    expect(globalsCss).toContain(".nexterm-icon-button");
    expect(globalsCss).toContain(".nexterm-overlay");
  });

  it("uses the terminal-first shell dimensions (top bar / status dock)", () => {
    // 终端优先壳层 v3.2:44px 顶栏 + 停靠工作区面板 + 24px 状态坞。
    // 全局侧栏已下线 —— 工作区切换器改为顶栏左端的弹出浮层。
    expect(() =>
      readFileSync(new URL("../app/shell/Sidebar.vue", import.meta.url), "utf8"),
    ).toThrow();

    const topBar = readSource("../app/shell/TopBar.vue");
    expect(topBar).toContain("h-11");
    expect(topBar).toContain(`:aria-label="t('app.header.openCommandCenter')"`);
    expect(topBar).toContain(`:aria-label="t('common.settings')"`);
    // 工作区切换器与两侧面板控制簇都挂在顶栏上。
    expect(topBar).toContain("WorkspaceSwitcher");
    expect(topBar).toContain("PanelControlCluster");
    expect(topBar).toContain('side="left"');
    expect(topBar).toContain('side="right"');
    // 控制簇自身：只提供只读的视图指示与折叠按钮。
    const cluster = readSource("../app/shell/PanelControlCluster.vue");
    expect(cluster).toContain("data-panel-view-indicator");
    expect(cluster).toContain("data-toggle-panel");
    // 换视图只在设置页 —— 顶栏不再提供第二个改布局的入口。
    expect(cluster).not.toContain("data-panel-tab=");
    expect(topBar).not.toContain("update:panel-layout");

    expect(readSource("../app/shell/SessionStrip.vue")).toContain("h-7");
    expect(readSource("../app/shell/StatusDock.vue")).toContain("h-6");

    // 单终端极简模式:会话条退化为面包屑芯片。
    const strip = readSource("../app/shell/SessionStrip.vue");
    expect(strip).toContain("data-session-minimal");
    expect(strip).toContain("data-session-strip");
  });

  it("左右面板分配只有一个写入口:设置页", () => {
    // 同一个设置有两个入口，用户会分不清「顶栏那个按钮改了以后
    // 设置里的值也跟着变吗」。左右分配只在设置页改。
    const settings = readSource("../settings/sections/GeneralSection.vue");
    const host = readSource("../app/shell/WorkspaceHost.vue");
    const topBar = readSource("../app/shell/TopBar.vue");

    expect(settings).toContain("updatePanelLayout");
    // 壳层只读不写。
    expect(topBar).not.toContain("updatePanelLayout");
    expect(host).not.toContain("updatePanelLayout");
    expect(host).not.toContain("prefs.panelLayout =");
  });

  it("docks the workspace panel on the right of the canvas without its own header", () => {
    const host = readSource("../app/shell/WorkspaceHost.vue");
    const panel = readSource("../app/shell/WorkspacePanel.vue");
    const canvas = readSource("../app/shell/Canvas.vue");

    // Host 组合:顶栏(含工作区切换器与会话条) → 左面板 | 画布 | 右面板 → 状态坞。
    expect(host).toMatch(/<TopBar[\s\S]*?<SessionStrip/);
    expect(host).toMatch(/<WorkspacePanel[\s\S]*?<Canvas[\s\S]*?<WorkspacePanel[\s\S]*?<StatusDock/);
    // 常驻左栏已下线：壳层里不再有侧栏。
    expect(host).not.toContain("<Sidebar");
    // 两侧各一个面板，各自选自己的视图。
    expect(host).toContain('side="left"');
    expect(host).toContain('side="right"');

    // 面板停靠在画布右侧(非浮层):双标签内容全部挂载在面板内,
    // 拖宽手柄在面板左缘(向左拖加宽)。
    expect(panel).toContain("data-workspace-panel-right");
    expect(panel).toMatch(/data-panel-resizer[\s\S]*?left-0/);
    expect(panel).toMatch(/<FileExplorer/);
    expect(panel).toMatch(/<SourceControlPanel/);
    expect(panel).not.toContain("<TaskConsole");
    // 面板头(文件树/更改 标签组 + 分支徽标)已并入顶栏,面板本体不再有头部。
    expect(panel).not.toContain("data-panel-tab=");
    expect(panel).not.toContain("data-panel-branch");

    // 画布是纯内容层:终端铺满中间区域,不再承载任何浮层/面板。
    expect(canvas).toMatch(/<TerminalWorkspace/);
    expect(canvas).not.toContain("OverlayPanel");
    expect(canvas).not.toContain("FileExplorer");
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

  it("keeps file type icons legible in the light theme", () => {
    // Catppuccin 图标内置 Latte 浅色调色板，浅色主题下必须压暗提亮，
    // 否则文件图标几乎与背景同色（深色主题无需处理）。
    expect(globalsCss).toContain(".nexterm-file-icon");
    expect(globalsCss).toMatch(
      /\.light\s+\.nexterm-file-icon\s*{[^}]*filter:/,
    );

    // 每个展示文件类型图标的面都必须挂上这个钩子。
    for (const path of [
      "../app/shell/SessionStrip.vue",
      "../modules/commands/CommandPalette.vue",
      "../modules/editor/EditorStatusBar.vue",
      "../modules/editor/EditorToolbar.vue",
      "../modules/editor/GitDiffPane.vue",
      "../modules/explorer/ExplorerSearch.vue",
      "../modules/explorer/FileExplorer.vue",
      "../modules/explorer/FileTreeRow.vue",
      "../modules/git-history/GitHistoryPane.vue",
      "../modules/markdown/MarkdownPreviewPane.vue",
      "../modules/picker/FilePickerDialog.vue",
      "../modules/search/FindInFilesPanel.vue",
      "../settings/sections/AboutSection.vue",
      "../settings/sections/TerminalBehaviorSection.vue",
      "../modules/source-control/SourceControlChangeRow.vue",
    ]) {
      expect(readSource(path)).toContain("nexterm-file-icon");
    }
  });

  it("routes every file type icon through the icons module", () => {
    // 文件 / 语言 / 品牌图标只能从 @/modules/icons 取，避免各模块各写一套。
    for (const path of [
      "../app/shell/SessionStrip.vue",
      "../modules/commands/CommandPalette.vue",
      "../modules/editor/EditorPane.vue",
      "../modules/editor/EditorToolbar.vue",
      "../modules/editor/GitDiffPane.vue",
      "../modules/explorer/ExplorerSearch.vue",
      "../modules/explorer/FileExplorer.vue",
      "../modules/explorer/FileTreeRow.vue",
      "../modules/git-history/GitHistoryPane.vue",
      "../modules/markdown/MarkdownPreviewPane.vue",
      "../modules/picker/FilePickerDialog.vue",
      "../modules/search/FindInFilesPanel.vue",
      "../settings/sections/AboutSection.vue",
      "../settings/sections/TerminalBehaviorSection.vue",
      "../modules/source-control/SourceControlChangeRow.vue",
    ]) {
      expect(readSource(path)).toContain("@/modules/icons");
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
