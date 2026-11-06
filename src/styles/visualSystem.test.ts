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

/**
 * 抽取模板里的 class token。
 *
 * 只看 <template> 段 —— <script> 里同名的普通变量不算。
 * 静态 class 直接按空白切词；动态 class 取其中的字符串字面量
 * （`:class="['rounded', { 'rounded-lg': ok }]"` 这种）。
 */
function collectClassTokens(vueSource: string): string[] {
  const open = /<template[^>]*>/.exec(vueSource);
  if (!open) return [];
  const start = open.index;
  const end = vueSource.lastIndexOf("</template>");
  if (end <= start) return [];
  const template = vueSource.slice(start, end);

  const tokens: string[] = [];
  const attrRe = /(?::|v-bind:)?class\s*=\s*"([^"]*)"/g;
  let match: RegExpExecArray | null;
  while ((match = attrRe.exec(template)) !== null) {
    const value = match[1];
    for (const token of value.split(/\s+/)) {
      if (token) tokens.push(token);
    }
    for (const literal of value.matchAll(/['"`]([^'"`]*)['"`]/g)) {
      for (const token of literal[1].split(/\s+/)) {
        if (token) tokens.push(token);
      }
    }
  }
  return tokens;
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

  it("derives every corner radius from one global base", () => {
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

    const themeStart = globalsCss.indexOf("@theme {");
    expect(themeStart).toBeGreaterThan(-1);
    const themeBlock = globalsCss.slice(
      themeStart,
      globalsCss.indexOf("\n}", themeStart),
    );

    // 唯一的手工值：全局圆角基准。
    expect(themeBlock).toContain("--radius-base: 8px;");

    // 其余 8 个档位全部由基准派生。
    // 倍率组在 base=8px 时全部落成整数像素（2/4/8/12/16/20/24/28）。
    const derived = [
      "--radius-xs: calc(var(--radius-base) * 0.25);",
      "--radius-sm: calc(var(--radius-base) * 0.5);",
      "--radius-md: var(--radius-base);",
      "--radius-lg: calc(var(--radius-base) * 1.5);",
      "--radius-xl: calc(var(--radius-base) * 2);",
      "--radius-2xl: calc(var(--radius-base) * 2.5);",
      "--radius-3xl: calc(var(--radius-base) * 3);",
      "--radius-4xl: calc(var(--radius-base) * 3.5);",
    ];
    const flat = themeBlock.replace(/\s+/g, " ");
    for (const line of derived) {
      expect(flat).toContain(line.replace(/\s+/g, " "));
    }

    // 基准之外不允许再有第二个手工 px 圆角值。
    const radiusDecls = [
      ...themeBlock.matchAll(/--radius-[a-z0-9-]+:\s*([^;]+);/g),
    ].map((m) => m[1].trim());
    expect(radiusDecls.length).toBe(9);
    for (const value of radiusDecls) {
      expect(
        value === "8px" ||
          value === "var(--radius-base)" ||
          value.startsWith("calc(var(--radius-base)"),
      ).toBe(true);
    }

    // 裸 rounded 的兜底值也由基准派生，不再是魔法数。
    expect(globalsCss).toContain("--radius: var(--radius-md);");
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

  it("keeps class-level radii on the shared radius scale", () => {
    const offenders: string[] = [];
    for (const file of collectSourceFiles(SRC_ROOT)) {
      if (!file.endsWith(".vue")) continue;
      const source = readFileSync(file, "utf8");
      for (const token of collectClassTokens(source)) {
        // 任意值圆角（如 rounded-[6px]）必须换成档位工具类。
        if (/^rounded-\[.+\]$/.test(token)) {
          offenders.push(`${file} 任意值圆角 ${token}`);
        }
        // 裸 rounded 等于 var(--radius) = 10px，夹在控件档(6)与容器档(12)之间，
        // 语义模糊，必须显式选档。
        if (token === "rounded") {
          offenders.push(`${file} 裸 rounded 未选档`);
        }
      }
    }
    expect(offenders).toEqual([]);
  });

  it("renders source-control rows with a VS Code style status letter", () => {
    const row = readSource("../modules/source-control/SourceControlChangeRow.vue");
    // 状态用纯文字字母（M / A / D / U）而不是 NTag 胶囊 ——
    // 胶囊在这种行密度下太重，与 VS Code 的 SCM 列表差一个量级。
    expect(row).not.toMatch(/<NTag/);
    expect(row).toContain("data-source-status-code");
    expect(row).toContain("statusClass(entry.statusKind)");
  });

  it("provides a global interaction feedback layer", () => {
    // 1. 键盘焦点必须处处可见 —— 之前只有 .nexterm-row 与
    //    .nexterm-icon-button 有焦点环，其余原生按钮与输入框全都「焦点消失」。
    expect(globalsCss).toMatch(/:focus-visible\s*\{[^}]*outline:/);
    expect(globalsCss).toContain(
      "[tabindex]:not([tabindex=\"-1\"])",
    );

    // 2. 按压反馈：点下去要有「被按下」的感觉。
    expect(globalsCss).toContain(".nexterm-icon-button:active");
    expect(globalsCss).toContain(".nexterm-row:active");
    expect(globalsCss).toContain(".n-button:not(.n-button--disabled):active");

    // 3. 过渡全部走 token —— prefers-reduced-motion 才能压平。
    expect(globalsCss).toContain("transition-property:");
    expect(globalsCss).toContain("var(--dur-fast)");
    expect(globalsCss).toContain("var(--ease-out)");
  });

  it("offers a neutral accent preset alongside the coloured ones", () => {
    // VS Code Dark Modern 式的无色相中性灰。
    expect(ACCENT_PRESETS).toContain("neutral");
    expect(globalsCss).toContain('html[data-accent="neutral"]');
    expect(globalsCss).toContain('.dark[data-accent="neutral"]');
  });

  it("wires the motion primitives to the surfaces that actually switch", () => {
    // 动效原语之前是「建好未接线」：v2-fade / v2-anim-* 的使用数为 0。
    // 下面把它们接到真正会切换的表面上。
    //
    // 1. 画布内容层（终端 / 编辑器 / 预览 / Markdown）——用 CSS 淡入淡出，
    //    不动 v-show / .invisible 机制，避免动到 xterm 与 CodeMirror 的常驻实例。
    expect(globalsCss).toContain("[data-tab-layer]");
    expect(globalsCss).toMatch(/\[data-tab-layer\][\s\S]*?opacity:/);

    // 2. 侧边停靠面板开合 —— <Transition> + v-show，面板不会重建。
    expect(globalsCss).toContain(".v2-slide-left-enter-from");
    expect(globalsCss).toContain(".v2-slide-right-enter-from");
    const host = readSource("../app/shell/WorkspaceHost.vue");
    expect(host).toContain('name="v2-slide-left"');
    expect(host).toContain('name="v2-slide-right"');

    // 3. 设置面板分类切换。
    const settings = readSource("../settings/SettingsPanel.vue");
    expect(settings).toContain('name="v2-fade"');
  });

  it("opens settings in a centered modal instead of a drawer", () => {
    const mainApp = readSource("../app/MainApp.vue");
    // 弹窗：抽屉从右侧滑入会占满半个屏幕并把画布推到左边。
    expect(mainApp).toContain("<NModal");
    expect(mainApp).not.toContain("<NDrawer");
    // Naive 自带的标题栏要去掉，否则与设置面板自己的标题栏叠成两层。
    expect(mainApp).toContain(':closable="false"');
    // 内容多时不能顶出窗口：弹窗与面板都要有高度上限。
    expect(mainApp).toContain("SETTINGS_MODAL_MAX_HEIGHT");
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

    expect(readSource("../app/shell/SessionStrip.vue")).toContain("h-9");
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

  it("renders the session strip as rounded-rectangle tabs with a calm active state", () => {
    const strip = readSource("../app/shell/SessionStrip.vue");

    // 圆角要克制：胶囊（rounded-full）太圆，顶端切角太锐。
    // 用全局基准档的 rounded-md（8px），与按钮/输入框一致。
    const shape = strip.match(/TAB_SHAPE_CLASS\s*=\s*\n?\s*"([^"]+)"/)?.[1] ?? "";
    expect(shape).toContain("rounded-md");
    expect(shape).not.toContain("rounded-full");
    expect(shape).not.toContain("rounded-t-sm");

    // 激活态用中性底色 + 顶部主色条 —— 实心主色块太刺眼。
    const active = strip.match(/TAB_ACTIVE_CLASS\s*=\s*\n?\s*"([^"]+)"/)?.[1] ?? "";
    expect(active).toContain("bg-accent");
    expect(active).not.toContain("bg-primary");
    expect(strip).toContain("data-tab-active-indicator");
  });

  it("moves the new-tab and split actions into the tab strip, keeping the title bar draggable", () => {
    const topBar = readSource("../app/shell/TopBar.vue");
    const strip = readSource("../app/shell/SessionStrip.vue");

    // 顶栏中段必须是窗口拖拽区 —— 会话条拆出去后不能把拖拽能力一起弄丢。
    expect(topBar).toContain("data-window-drag-region");
    expect(topBar).toContain("startWindowDrag");

    // 新建终端 / 分屏归到标签行末尾（JetBrains 的标签行动作区）。
    expect(strip).toContain("data-new-terminal");
    expect(strip).toContain("data-split-terminal");
    expect(topBar).not.toContain("data-new-terminal");
    expect(topBar).not.toContain("data-split-terminal");
  });

  it("keeps the minimal cwd chip and the tab rows on one visual language", () => {
    const strip = readSource("../app/shell/SessionStrip.vue");

    // 单终端的 cwd chip 与多标签必须共用同一套形状与配色 ——
    // 否则单终端 ↔ 多标签切换时整行会跳变。
    expect(strip).toContain("TAB_SHAPE_CLASS");
    expect(strip).not.toContain("bg-accent/50");

    // 两处激活指示都要在（chip 也是激活态）。
    const indicators = strip.match(/data-tab-active-indicator/g) ?? [];
    expect(indicators.length).toBe(2);
  });

  it("keeps tab close reachable without hover and exposes an overflow menu", () => {
    const strip = readSource("../app/shell/SessionStrip.vue");

    // 关闭按钮不能只靠 hover 出现：键盘聚焦与触屏都要拿得到。
    expect(strip).toContain("group-focus-within:opacity-100");
    expect(strip).toContain("[@media(hover:none)]:opacity-60");

    // 溢出用下拉菜单，不再用左右翻页箭头。
    expect(strip).not.toContain("data-strip-scroll-left");
    expect(strip).not.toContain("data-strip-scroll-right");
    expect(strip).toContain("data-strip-overflow");
  });

  it("docks the session strip inside the center column, not across the side panels", () => {
    // 标签行只覆盖中间内容面板 —— 两侧停靠面板与它同高（VS Code 的布局）。
    // 标签再多也不会把顶栏的身份区与右侧动作按钮挤出屏幕。
    const host = readSource("../app/shell/WorkspaceHost.vue");
    const topBar = readSource("../app/shell/TopBar.vue");

    expect(host).not.toContain("<template #center>");
    expect(topBar).not.toContain('name="center"');
    // TopBar 自闭合（无 </TopBar>）→ 标签条不可能是它的子节点。
    expect(host).not.toContain("</TopBar>");
    const topBarIdx = host.indexOf("<TopBar");
    const stripIdx = host.indexOf("<SessionStrip");
    const leftIdx = host.indexOf('side="left"');
    const rightIdx = host.indexOf('side="right"');
    expect(topBarIdx).toBeGreaterThan(-1);
    // 标签条夹在左右面板之间：它在中间列里，不横跨整个窗口。
    expect(stripIdx).toBeGreaterThan(leftIdx);
    expect(stripIdx).toBeLessThan(rightIdx);
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
