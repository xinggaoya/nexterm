import { readdirSync, readFileSync, statSync } from "node:fs";
import { join, relative } from "node:path";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";

const srcRoot = fileURLToPath(new URL("../", import.meta.url));

/**
 * No-Options-API boundary. The whole codebase uses the Composition API
 * with `<script setup lang="ts">`. This test asserts that no `.vue` file
 * regresses to a default-export Options API object, and that no Pinia
 * store regresses to the `defineStore("name", { ... })` form.
 */
const vueOptionsApiExport = /<script(?![^>]*\bsetup\b)[^>]*>\s*export\s+default\s*\{/;
const piniaOptionsForm = /\bdefineStore\s*\(\s*["'][^"']+["']\s*,\s*\{/;

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

describe("no Options API boundary", () => {
  it("does not regress Vue components to Options API", () => {
    const offenders: string[] = [];
    for (const file of walk(srcRoot)) {
      if (!file.endsWith(".vue")) continue;
      if (file.endsWith("noOptionsApiBoundary.test.ts")) continue;
      const source = readFileSync(file, "utf8");
      if (vueOptionsApiExport.test(source)) {
        offenders.push(toPosix(relative(srcRoot, file)));
      }
    }
    expect(offenders).toEqual([]);
  });

  it("does not regress Pinia stores to the object form", () => {
    const offenders: string[] = [];
    for (const file of walk(srcRoot)) {
      if (!/\.(ts|tsx)$/.test(file)) continue;
      if (file.endsWith("noOptionsApiBoundary.test.ts")) continue;
      if (!/Pinia\.ts$|PiniaStore\.ts$/.test(file)) continue;
      const source = readFileSync(file, "utf8");
      if (piniaOptionsForm.test(source)) {
        offenders.push(toPosix(relative(srcRoot, file)));
      }
    }
    expect(offenders).toEqual([]);
  });
});
