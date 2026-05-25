import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";

const globalsCss = readFileSync(
  new URL("./globals.css", import.meta.url),
  "utf8",
);

describe("window chrome styles", () => {
  it("removes custom border clipping when the native window is edge-to-edge", () => {
    expect(globalsCss).toContain(
      'html[data-chrome="borderless"][data-window-edge-to-edge="true"] #root',
    );
    expect(globalsCss).toMatch(
      /data-window-edge-to-edge="true"\]\s+#root\s*{[\s\S]*border-radius:\s*0;[\s\S]*border:\s*0;/,
    );
  });
});
