// @vitest-environment jsdom
import { describe, expect, it } from "vitest";
import { buildTerminalTheme } from "./theme";

describe("terminal theme", () => {
  it("reads ANSI tokens from CSS variables", () => {
    // jsdom gets the document but our :root tokens are declared at module
    // scope — fall back to an explicit assignment so the test is hermetic.
    const root = document.documentElement;
    root.style.setProperty("--term-bg", "rgb(20, 20, 20)");
    root.style.setProperty("--term-fg", "rgb(230, 230, 230)");
    root.style.setProperty("--term-cursor", "rgb(230, 230, 230)");
    root.style.setProperty("--term-cursor-accent", "rgb(20, 20, 20)");
    root.style.setProperty("--term-selection", "rgba(100, 100, 200, 0.4)");
    root.style.setProperty("--term-black", "rgb(0, 0, 0)");
    root.style.setProperty("--term-red", "rgb(200, 50, 50)");
    root.style.setProperty("--term-green", "rgb(50, 200, 50)");
    root.style.setProperty("--term-yellow", "rgb(200, 200, 50)");
    root.style.setProperty("--term-blue", "rgb(50, 50, 200)");
    root.style.setProperty("--term-magenta", "rgb(200, 50, 200)");
    root.style.setProperty("--term-cyan", "rgb(50, 200, 200)");
    root.style.setProperty("--term-white", "rgb(220, 220, 220)");
    for (const name of [
      "--term-bright-black",
      "--term-bright-red",
      "--term-bright-green",
      "--term-bright-yellow",
      "--term-bright-blue",
      "--term-bright-magenta",
      "--term-bright-cyan",
      "--term-bright-white",
    ]) {
      root.style.setProperty(name, "rgb(240, 240, 240)");
    }

    const theme = buildTerminalTheme();
    expect(theme.background).toBe("rgb(20, 20, 20)");
    expect(theme.foreground).toBe("rgb(230, 230, 230)");
    expect(theme.red).toBe("rgb(200, 50, 50)");
    expect(theme.brightWhite).toBe("rgb(240, 240, 240)");
  });
});
