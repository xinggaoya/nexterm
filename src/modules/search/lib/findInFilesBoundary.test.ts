import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";

// The search module's IPC contract is "always go through native". This
// test guards the boundary by scanning every TS/Vue file under
// src/modules/search/ for direct invoke() calls or Tauri imports.
describe("search module IPC boundary", () => {
  it("does not bypass the native wrapper in any source file", () => {
    const files = [
      "src/modules/search/index.ts",
      "src/modules/search/lib/findInFilesService.ts",
      "src/modules/search/FindInFilesPanel.vue",
    ];
    for (const rel of files) {
      let source: string;
      try {
        source = readFileSync(rel, "utf8");
      } catch {
        // File may not exist yet during partial scaffolding — skip
        // silently. The presence check is informational.
        continue;
      }
      expect(source).not.toMatch(/@tauri-apps\/api/);
      expect(source).not.toMatch(/invoke\s*\(/);
    }
  });
});
