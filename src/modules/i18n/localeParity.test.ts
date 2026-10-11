import { readdirSync, readFileSync, statSync } from "node:fs";
import { join, relative } from "node:path";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";

import { ALL_COMMAND_SPECS } from "@/modules/commands/commandSpecs";
import enUS from "./locales/en-US";
import zhCN from "./locales/zh-CN";

function flatten(node: unknown, prefix = ""): string[] {
  if (typeof node === "string") return [prefix];
  if (node === null || typeof node !== "object") return [];
  return Object.entries(node as Record<string, unknown>).flatMap(([key, value]) =>
    flatten(value, prefix ? `${prefix}.${key}` : key),
  );
}

function resolveKey(messages: unknown, key: string): string | undefined {
  let cursor: unknown = messages;
  for (const segment of key.split(".")) {
    if (cursor === null || typeof cursor !== "object") return undefined;
    cursor = (cursor as Record<string, unknown>)[segment];
  }
  return typeof cursor === "string" ? cursor : undefined;
}

function walk(dir: string): string[] {
  return readdirSync(dir).flatMap((entry) => {
    const full = join(dir, entry);
    return statSync(full).isDirectory() ? walk(full) : [full];
  });
}

/**
 * i18n 完整性边界。
 *
 * `createI18n` 把 `missingWarn` / `fallbackWarn` 都关掉了
 * （见 ./index.ts），所以 key 漂移在运行时是**完全静默**的：界面直接显示
 * `commads.open` 这样的原始字符串，没有任何警告。这三条把三个静默面封死。
 */
describe("i18n locale parity", () => {
  it("zh-CN declares exactly the en-US key set", () => {
    expect(new Set(flatten(zhCN))).toEqual(new Set(flatten(enUS)));
  });

  it("every command spec titleKey resolves in both locales", () => {
    const missing = ALL_COMMAND_SPECS.filter(
      (spec) => !resolveKey(enUS, spec.titleKey) || !resolveKey(zhCN, spec.titleKey),
    ).map((spec) => `${spec.id}: ${spec.titleKey}`);
    expect(missing).toEqual([]);
  });

  it("every literal t(\"...\") key in src exists in en-US", () => {
    // 静态扫描，覆盖 translate.ts 那个类型安全的严格 t() 抓不到的模板拼接
    // 与 tLoose 调用点。
    const srcRoot = fileURLToPath(new URL("../../", import.meta.url));
    const known = new Set(flatten(enUS));
    const orphans = walk(srcRoot)
      .filter((file) => /\.(ts|vue)$/.test(file))
      .filter((file) => !file.endsWith(".test.ts"))
      .filter((file) => !file.includes(`${join("modules", "i18n")}`))
      .flatMap((file) => {
        const source = readFileSync(file, "utf8");
        return [...source.matchAll(/\bt(?:Loose)?\(\s*"([a-zA-Z][\w.]*)"/g)].map(
          (match) =>
            [
              relative(srcRoot, file).split(/[\\/]/).join("/"),
              match[1],
            ] as const,
        );
      })
      .filter(([, key]) => !known.has(key))
      .map(([file, key]) => `${file}: ${key}`);
    expect(orphans).toEqual([]);
  });
});
