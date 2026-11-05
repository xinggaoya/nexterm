import { readdirSync, readFileSync, statSync } from "node:fs";
import { join, relative } from "node:path";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";

const SRC = fileURLToPath(new URL("../../", import.meta.url));

function walk(dir: string): string[] {
  return readdirSync(dir).flatMap((entry) => {
    const path = join(dir, entry);
    if (statSync(path).isDirectory()) return walk(path);
    return [path];
  });
}

function relativeToSrc(path: string): string {
  return relative(SRC, path).replace(/\\/g, "/");
}

describe("icons module boundary", () => {
  it("keeps the icon implementation out of the explorer module", () => {
    // 图标实现曾寄居在 explorer/lib 下，被五个模块反向依赖；迁移后
    // explorer 不得再持有任何图标解析代码。
    const explorerLib = join(SRC, "modules/explorer/lib");
    const offenders = readdirSync(explorerLib).filter((file) =>
      /icon/i.test(file),
    );

    expect(offenders).toEqual([]);
  });

  it("is consumed through the module barrel only", () => {
    // 其它模块只能从 `@/modules/icons` 取图标，不能伸进 lib/ 内部实现。
    const offenders = walk(SRC)
      .filter((file) => /\.(ts|tsx|vue)$/.test(file))
      .filter((file) => !file.endsWith("iconsBoundary.test.ts"))
      .filter((file) => {
        const source = readFileSync(file, "utf8");
        return /from\s+["'][^"']*modules\/icons\/(lib\/)?(iconSet|fileIcons|folderIcons|languageIds|fileIcon)["']/.test(
          source,
        );
      })
      .map((file) => relativeToSrc(file));

    expect(offenders).toEqual([]);
  });

  it("owns the icon mapping tables", () => {
    const iconsLib = join(SRC, "modules/icons/lib");
    const expected = [
      "fileIcons.ts",
      "folderIcons.ts",
      "iconSet.ts",
      "languageIds.ts",
    ];

    expect(readdirSync(iconsLib).sort()).toEqual(expected);
  });
});
