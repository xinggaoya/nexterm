import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";

const globalsCss = readFileSync(
  new URL("./globals.css", import.meta.url),
  "utf8",
);

describe("editor scrollbar styles", () => {
  it("opts Monaco editor panes into compact native scrollbars", () => {
    expect(globalsCss).toContain(
      ".nexterm-editor-scrollbar .monaco-scrollable-element",
    );
    expect(globalsCss).toContain("scrollbar-width: thin !important;");
    expect(globalsCss).toContain(
      "--nexterm-editor-scrollbar-track-size: 8px;",
    );
  });

  it("overrides the app-wide hidden scrollbar policy for Monaco panes", () => {
    expect(globalsCss).toContain("::-webkit-scrollbar");
    expect(globalsCss).toContain(
      "background: var(--nexterm-editor-scrollbar-thumb) !important;",
    );
  });
});
