import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";

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

  it("uses the approved compact shell dimensions without card gutters", () => {
    const titleBar = readSource("../app/shell/TitleBar.vue");
    expect(titleBar).toContain("h-10");
    expect(titleBar).toContain(
      `:aria-label="t('app.header.openCommandCenter')"`,
    );
    expect(titleBar).toContain(`:aria-label="t('common.settings')"`);
    expect(readSource("../app/shell/ActivityIcons.vue")).toContain("w-11");
    expect(readSource("../app/shell/TabBar.vue")).toContain("h-[34px]");
    expect(readSource("../app/shell/StatusBar.vue")).toContain("h-6");

    const workbench = readSource("../app/shell/Workbench.vue");
    expect(workbench).not.toContain("nexterm-canvas h-full min-h-0 min-w-0 p-2");
    expect(workbench).not.toContain("nexterm-card-elevated");
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
      expect(readSource(path)).toContain("nexterm-overlay");
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
    for (const name of [
      "term-bg",
      "term-fg",
      "term-cursor",
      "term-cursor-accent",
      "term-selection",
      "term-link",
    ]) {
      const declarations = globalsCss.match(
        new RegExp(`--${name}:\\s*([^;]+);`, "g"),
      );
      expect(declarations?.length).toBe(2);
      expect(declarations?.every((value) => !value.includes("var("))).toBe(true);
    }
  });
});
