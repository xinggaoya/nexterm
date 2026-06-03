import { readdirSync, readFileSync, statSync } from "node:fs";
import { join, relative } from "node:path";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";

const srcRoot = fileURLToPath(new URL("../../", import.meta.url));

/**
 * Pinia setup-store boundary. AGENTS.md mandates the setup-function style
 * for every Pinia store: `defineStore("name", () => { ... })`. Object-form
 * stores (`defineStore("name", { state, actions, getters })`) lose access
 * to `useEventListener`, `useTemplateRef`, and other composables — and they
 * re-introduce the implicit `this.*` binding that setup stores avoid.
 */
const defineStoreCall = /\bdefineStore\s*\(/g;
const storeFilePattern = /(^|\/)Pinia\.ts$|\/use[A-Z][A-Za-z0-9]*PiniaStore\.ts$/;

const optionsFormSignals = [
  /\bstate\s*:\s*\(/,
  /\bstate\s*:\s*[A-Za-z_$]/,
  /\bgetters\s*:\s*\{/,
  /\bactions\s*:\s*\{/,
];

/**
 * Files known to use the legacy Options API form. The list must shrink as
 * Phase 3 migrates them. The test fails if a new file joins the list (a
 * regression) or if an entry is silently removed (drift between the
 * tolerated set and the migrated state).
 */
const toleratedOptionsFormStores: Record<string, true> = {
  "modules/workspace/workspaceEnvPinia.ts": true,
  "modules/workspace/workspaceRootPinia.ts": true,
};

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

function findDefineStoreSites(source: string): number[] {
  const sites: number[] = [];
  defineStoreCall.lastIndex = 0;
  let match: RegExpExecArray | null;
  while ((match = defineStoreCall.exec(source)) !== null) {
    sites.push(match.index);
  }
  return sites;
}

function looksLikeOptionsForm(source: string): boolean {
  return optionsFormSignals.some((pattern) => pattern.test(source));
}

describe("Pinia setup-store boundary", () => {
  it("uses the setup-function form for every store", () => {
    const offenders: string[] = [];
    const unexpected: string[] = [];

    for (const file of walk(srcRoot)) {
      if (!/\.(ts|tsx)$/.test(file)) continue;
      if (file.endsWith("setupStoreBoundary.test.ts")) continue;
      const rel = toPosix(relative(srcRoot, file));
      if (!storeFilePattern.test("/" + rel)) continue;

      const source = readFileSync(file, "utf8");
      if (findDefineStoreSites(source).length === 0) continue;
      if (!looksLikeOptionsForm(source)) continue;

      if (toleratedOptionsFormStores[rel]) continue;
      unexpected.push(rel);
      offenders.push(rel);
    }

    // 1. No NEW Options-form stores are introduced.
    expect(unexpected).toEqual([]);
  });

  it("does not let new files silently leave the tolerated set", () => {
    // This test pins the tolerated set: changing the list requires a
    // deliberate code review and an accompanying migration commit.
    const expected = [
      "modules/workspace/workspaceEnvPinia.ts",
      "modules/workspace/workspaceRootPinia.ts",
    ];
    expect(Object.keys(toleratedOptionsFormStores).sort()).toEqual(
      expected.sort(),
    );
  });

  it("forbids `this.*` access inside Pinia store files", () => {
    const thisOffenders: string[] = [];
    for (const file of walk(srcRoot)) {
      if (!/\.(ts|tsx)$/.test(file)) continue;
      if (file.endsWith("setupStoreBoundary.test.ts")) continue;
      const rel = toPosix(relative(srcRoot, file));
      if (!storeFilePattern.test("/" + rel)) continue;

      const source = readFileSync(file, "utf8");
      if (findDefineStoreSites(source).length === 0) continue;
      if (!/\bthis\.[A-Za-z_$]/.test(source)) continue;

      thisOffenders.push(rel);
    }
    expect(thisOffenders).toEqual([]);
  });
});
