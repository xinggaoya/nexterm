import { readdirSync, readFileSync, statSync } from "node:fs";
import { join, relative } from "node:path";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";

const srcRoot = fileURLToPath(new URL("../", import.meta.url));

/**
 * Tauri event-bus boundary. Event subscription (`listen`) and emission
 * (`emit`) on the global Tauri bus must funnel through `src/lib/native.ts`
 * so that event-name strings live in one place. Files below either rely on
 * a specialised type import or have a documented migration path.
 */
const eventImportSpecifiers = [
  /\bimport\s+(?:type\s+)?\{[^}]*\blisten\b[^}]*\}\s+from\s+["']@tauri-apps\/api\/event["']/,
  /\bimport\s+(?:type\s+)?\{[^}]*\bemit\b[^}]*\}\s+from\s+["']@tauri-apps\/api\/event["']/,
];

const eventWhitespaceImport = /\bfrom\s+["']@tauri-apps\/api\/event["']/;

/**
 * Files allowed to reach into `@tauri-apps/api/event` directly.
 *
 * - `src/lib/native.ts` is the only sanctioned event-bus surface.
 * - `src/lib/native.test.ts` mocks the event layer for unit tests.
 * - `src/modules/settings/store.ts` is the persistent preferences layer that
 *   also publishes internal change events; this will move behind native
 *   in a later phase.
 * - `src/app/useWorkspaceLifecycle.ts` subscribes to the workspace
 *   filesystem change event for now; will be re-routed through
 *   `native.onWorkspaceFsChanged` in Phase 6.
 * - `src/app/components/UnsavedCloseGuard.vue` only imports the
 *   `UnlistenFn` type; tolerated for now and slated for Phase 6 cleanup.
 */
const whitelist: Record<string, true> = {
  "lib/native.ts": true,
  "lib/native.test.ts": true,
  "modules/settings/store.ts": true,
  "app/useWorkspaceLifecycle.ts": true,
  "app/components/UnsavedCloseGuard.vue": true,
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

function isDirectEventImport(source: string): boolean {
  return (
    eventImportSpecifiers.some((pattern) => pattern.test(source)) ||
    eventWhitespaceImport.test(source)
  );
}

describe("Tauri event boundary", () => {
  it("keeps listen/emit usage contained to native.ts and the whitelisted migrators", () => {
    const offenders = walk(srcRoot)
      .filter((file) => /\.(ts|tsx|vue)$/.test(file))
      .filter((file) => !file.endsWith("eventBoundary.test.ts"))
      .filter((file) => {
        const rel = toPosix(relative(srcRoot, file));
        if (whitelist[rel]) return false;
        const source = readFileSync(file, "utf8");
        return isDirectEventImport(source);
      })
      .map((file) => toPosix(relative(srcRoot, file)));

    expect(offenders).toEqual([]);
  });
});
