import { existsSync, readFileSync } from "node:fs";
import { join } from "node:path";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";

const repoRoot = fileURLToPath(new URL("../../", import.meta.url));

describe("remote terminal boundary", () => {
  it("does not keep the removed remote terminal entrypoints", () => {
    const removedPaths = [
      "remote.html",
      "src/remote",
      "src/modules/remote",
      "src-tauri/src/modules/remote",
    ];

    const remaining = removedPaths.filter((path) =>
      existsSync(join(repoRoot, path)),
    );

    expect(remaining).toEqual([]);
  });

  it("does not register remote terminal commands or Vite entries", () => {
    const viteConfig = readFileSync(join(repoRoot, "vite.config.ts"), "utf8");
    const tauriLib = readFileSync(
      join(repoRoot, "src-tauri", "src", "lib.rs"),
      "utf8",
    );

    expect(viteConfig).not.toContain("remote.html");
    expect(tauriLib).not.toContain("remote_terminal_");
  });
});
