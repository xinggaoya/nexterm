import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";

const globalsCss = readFileSync(
  new URL("./globals.css", import.meta.url),
  "utf8",
);

describe("terminal scrollbar styles", () => {
  it("separates the hit area from the visible thumb size", () => {
    expect(globalsCss).toContain(
      "--nexterm-terminal-scrollbar-track-size: 6px;",
    );
    expect(globalsCss).toContain(
      "--nexterm-terminal-scrollbar-thumb-size: 4px;",
    );
  });

  it("keeps the xterm 6 slider visually compact", () => {
    expect(globalsCss).toMatch(
      /> \.scrollbar\.vertical\s*{\s*display: block !important;[\s\S]*width: var\(--nexterm-terminal-scrollbar-track-size\) !important;/,
    );
    expect(globalsCss).toMatch(
      /> \.scrollbar\.vertical\s*>\s*\.slider\s*{\s*width: var\(--nexterm-terminal-scrollbar-thumb-size\) !important;[\s\S]*left: auto !important;[\s\S]*right: 1px !important;/,
    );
  });
});
