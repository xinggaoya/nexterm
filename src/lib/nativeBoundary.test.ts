import { readdirSync, readFileSync, statSync } from "node:fs";
import { join, relative } from "node:path";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";

const srcRoot = fileURLToPath(new URL("../", import.meta.url));

/**
 * The Tauri IPC boundary: `invoke` and `Channel` must be reached exclusively
 * through `src/lib/native.ts`. Direct imports from `@tauri-apps/api/core`
 * elsewhere explode the blast radius of any backend command rename or
 * payload shape change.
 */
const ipcImportSpecifiers = [
  /\bimport\s+(?:type\s+)?\{[^}]*\binvoke\b[^}]*\}\s+from\s+["']@tauri-apps\/api\/core["']/,
  /\bimport\s+(?:type\s+)?\{[^}]*\bChannel\b[^}]*\}\s+from\s+["']@tauri-apps\/api\/core["']/,
];

const ipcWhitespaceImport = /\bfrom\s+["']@tauri-apps\/api\/core["']/;

/**
 * Whitelist of files that are allowed to touch the Tauri IPC surface
 * directly. Keep this list as small as possible: every new entry should be
 * accompanied by a follow-up to migrate the file through `src/lib/native.ts`.
 *
 * - `src/lib/native.ts` is the only sanctioned re-export of Tauri primitives.
 * - Test files are permitted to mock the IPC layer to drive unit tests.
 */
const whitelist: Record<string, true> = {
  "lib/native.ts": true,
  "lib/native.test.ts": true,
  "lib/launchDir.test.ts": true,
  "modules/editor/lib/documentService.test.ts": true,
  "modules/explorer/lib/fileTreeService.test.ts": true,
  "modules/markdown/lib/markdownDocumentService.test.ts": true,
  "modules/workspace/workspaceEnvPinia.test.ts": true,
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

function isDirectIpcImport(source: string): boolean {
  return (
    ipcImportSpecifiers.some((pattern) => pattern.test(source)) ||
    ipcWhitespaceImport.test(source)
  );
}

describe("Tauri IPC boundary", () => {
  it("keeps invoke/Channel usage contained to native.ts and the whitelisted migrators", () => {
    const offenders = walk(srcRoot)
      .filter((file) => /\.(ts|tsx|vue)$/.test(file))
      .filter((file) => !file.endsWith("nativeBoundary.test.ts"))
      .filter((file) => {
        const rel = toPosix(relative(srcRoot, file));
        if (whitelist[rel]) return false;
        const source = readFileSync(file, "utf8");
        return isDirectIpcImport(source);
      })
      .map((file) => toPosix(relative(srcRoot, file)));

    expect(offenders).toEqual([]);
  });
});
