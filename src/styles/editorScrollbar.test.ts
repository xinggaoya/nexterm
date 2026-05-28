import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";

const globalsCss = readFileSync(
  new URL("./globals.css", import.meta.url),
  "utf8",
);

function rulesForSelector(selector: string): string[] {
  const escaped = selector.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
  const matches = globalsCss.matchAll(
    new RegExp(`(^|\\n)${escaped}\\s*{[^}]*}`, "g"),
  );
  return Array.from(matches, ([rule]) => rule);
}

describe("editor scrollbar styles", () => {
  it("opts CodeMirror panes into compact native scrollbars", () => {
    expect(globalsCss).toContain(".nexterm-editor-scrollbar .cm-scroller");
    expect(globalsCss).toContain("scrollbar-width: thin !important;");
    expect(globalsCss).toContain(
      "--nexterm-editor-scrollbar-track-size: 8px;",
    );
  });

  it("overrides the app-wide hidden scrollbar policy for CodeMirror", () => {
    expect(globalsCss).toMatch(
      /\.nexterm-editor-scrollbar \.cm-scroller::-webkit-scrollbar\s*{[\s\S]*height: var\(--nexterm-editor-scrollbar-track-size\) !important;[\s\S]*display: block !important;/,
    );
    expect(rulesForSelector(".cm-scroller::-webkit-scrollbar")).toEqual([]);
  });
});
