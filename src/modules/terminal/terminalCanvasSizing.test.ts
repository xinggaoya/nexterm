import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";

const source = readFileSync(
  fileURLToPath(new URL("./TerminalPane.vue", import.meta.url)),
  "utf8",
);

describe("terminal canvas sizing boundary", () => {
  it("leaves xterm screen and canvas dimensions under renderer control", () => {
    expect(source).not.toMatch(
      /\.xterm-screen[^{}]*\{[^}]*(?:width|height):\s*100%/s,
    );
    expect(source).not.toMatch(
      /\.xterm-screen\s+canvas[^{}]*\{[^}]*(?:width|height):/s,
    );
  });
});
