import { readdirSync, readFileSync, statSync } from "node:fs";
import { join, relative } from "node:path";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";

const srcRoot = fileURLToPath(new URL("../", import.meta.url));

/**
 * Translation-traces boundary. The codebase was originally translated from
 * a React-flavoured prototype; a few React-style names slipped into the
 * modules. This test pins the contract: no `.ts`/`.vue` source under
 * `src/` may import React-only or React-flavoured type aliases.
 *
 * Whitelist (none): the test fails on any occurrence so a regression
 * during migration is caught immediately.
 */
const forbiddenSymbolPatterns: RegExp[] = [
  // React-flavoured type aliases we explicitly removed
  /\bReadableRef\b/,
  // React hooks / patterns that should not appear in a Vue codebase
  /\buseState\b/,
  /\buseEffect\b/,
  /\buseMemo\b/,
  /\buseCallback\b/,
  /\buseReducer\b/,
  /\buseContext\b/,
  /\buseRef\b/,
  /\bReact\.[A-Z]/,
];

const forbiddenImportPatterns: RegExp[] = [
  /from\s+["']react["']/,
  /from\s+["']react-dom["']/,
];

function walk(dir: string): string[] {
  return readdirSync(dir).flatMap((entry) => {
    const path = join(dir, entry);
    if (statSync(path).isDirectory()) return walk(path);
    return [path];
  });
}

function toPosix(path: string): string {
  return path.split(/[\\/]/).join("/");
}

describe("translation traces", () => {
  it("does not keep React-style names in the Vue source tree", () => {
    const offenders: string[] = [];
    for (const file of walk(srcRoot)) {
      if (!/\.(ts|tsx|vue)$/.test(file)) continue;
      if (file.endsWith("translationTraces.test.ts")) continue;
      const rel = toPosix(relative(srcRoot, file));
      const source = readFileSync(file, "utf8");
      const hit =
        forbiddenSymbolPatterns.some((pattern) => pattern.test(source)) ||
        forbiddenImportPatterns.some((pattern) => pattern.test(source));
      if (hit) offenders.push(rel);
    }
    expect(offenders).toEqual([]);
  });
});
