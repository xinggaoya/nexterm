import { readdirSync, readFileSync, statSync } from "node:fs";
import { join, relative } from "node:path";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";

function walk(dir: string): string[] {
  return readdirSync(dir).flatMap((entry) => {
    const path = join(dir, entry);
    if (statSync(path).isDirectory()) return walk(path);
    return [path];
  });
}

describe("terminal module Vue boundary", () => {
  it("does not keep React terminal components or hooks", () => {
    const root = fileURLToPath(new URL(".", import.meta.url));
    const files = walk(root).filter((file) => /\.(ts|tsx|vue)$/.test(file));
    const offenders = files
      .filter((file) => !file.endsWith("terminalVueBoundary.test.ts"))
      .filter((file) => {
        const rel = relative(root, file);
        const source = readFileSync(file, "utf8");
        return rel.endsWith(".tsx") || /from\s+["']react["']/.test(source);
      })
      .map((file) => relative(root, file));

    expect(offenders).toEqual([]);
  });
});
