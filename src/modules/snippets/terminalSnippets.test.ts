import { describe, expect, it } from "vitest";
import { DEFAULT_TERMINAL_SNIPPETS } from "./terminalSnippets";

describe("DEFAULT_TERMINAL_SNIPPETS", () => {
  it("exposes stable, non-empty snippet commands", () => {
    expect(DEFAULT_TERMINAL_SNIPPETS.length).toBeGreaterThan(0);
    for (const snippet of DEFAULT_TERMINAL_SNIPPETS) {
      expect(snippet.id).toBeTruthy();
      expect(snippet.nameKey).toBeTruthy();
      expect(snippet.command.trim()).not.toBe("");
    }
  });

  it("uses unique ids", () => {
    const ids = DEFAULT_TERMINAL_SNIPPETS.map((s) => s.id);
    expect(new Set(ids).size).toBe(ids.length);
  });
});
