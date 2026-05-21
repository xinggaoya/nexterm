import { existsSync, readdirSync, readFileSync, statSync } from "node:fs";
import { join, relative } from "node:path";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";

const repoRoot = fileURLToPath(new URL("../../", import.meta.url));
const srcRoot = join(repoRoot, "src");
const tauriRoot = join(repoRoot, "src-tauri");

const forbiddenSourceFragments = [
  "@/modules/ai",
  "@/modules/shortcuts",
  "ai-diff",
  "AiDiff",
  "secrets_get",
  "secrets_set",
  "secrets_delete",
  "ai_http_request",
  "ai_http_stream",
  "lm_ping",
];

const forbiddenPackages = [
  "ai",
  "tokenlens",
  "@ai-sdk/anthropic",
  "@ai-sdk/cerebras",
  "@ai-sdk/google",
  "@ai-sdk/groq",
  "@ai-sdk/openai",
  "@ai-sdk/openai-compatible",
  "@ai-sdk/xai",
];

function walk(dir: string): string[] {
  return readdirSync(dir).flatMap((entry) => {
    const path = join(dir, entry);
    if (statSync(path).isDirectory()) return walk(path);
    return [path];
  });
}

describe("AI and shortcuts removal boundary", () => {
  it("does not keep AI or shortcuts source modules", () => {
    expect(existsSync(join(srcRoot, "modules", "ai"))).toBe(false);
    expect(existsSync(join(srcRoot, "modules", "shortcuts"))).toBe(false);
    expect(existsSync(join(tauriRoot, "src", "modules", "secrets.rs"))).toBe(
      false,
    );
  });

  it("does not import or invoke removed AI and shortcut features", () => {
    const offenders = [...walk(srcRoot), ...walk(join(tauriRoot, "src"))]
      .filter((file) => /\.(ts|vue|rs)$/.test(file))
      .filter((file) => !file.endsWith("noAiFeaturesBoundary.test.ts"))
      .filter((file) => {
        const source = readFileSync(file, "utf8");
        return forbiddenSourceFragments.some((fragment) =>
          source.includes(fragment),
        );
      })
      .map((file) => relative(repoRoot, file));

    expect(offenders).toEqual([]);
  });

  it("does not keep AI SDK packages", () => {
    const pkg = JSON.parse(
      readFileSync(join(repoRoot, "package.json"), "utf8"),
    ) as {
      dependencies?: Record<string, string>;
      devDependencies?: Record<string, string>;
    };
    const installed = {
      ...pkg.dependencies,
      ...pkg.devDependencies,
    };

    const remaining = forbiddenPackages.filter((name) => name in installed);

    expect(remaining).toEqual([]);
  });
});
