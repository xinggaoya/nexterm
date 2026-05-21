import { readdirSync, readFileSync, statSync } from "node:fs";
import { join, relative } from "node:path";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";

const srcRoot = fileURLToPath(new URL("../", import.meta.url));
const importFrom = (specifier: string) =>
  new RegExp(`from\\s+["']${specifier.replace("/", "\\/")}["']`);

const forbiddenSourcePatterns = [
  importFrom("react"),
  importFrom(["react", "dom"].join("-")),
  importFrom(["@hugeicons", "react"].join("/")),
  importFrom(["motion", "react"].join("/")),
  importFrom(["react", "resizable", "panels"].join("-")),
  importFrom(["@uiw", "react-codemirror"].join("/")),
  importFrom(["zus", "tand"].join("")),
];

function walk(dir: string): string[] {
  return readdirSync(dir).flatMap((entry) => {
    const path = join(dir, entry);
    if (statSync(path).isDirectory()) return walk(path);
    return [path];
  });
}

describe("React source boundary", () => {
  it("does not keep React source files or runtime imports", () => {
    const offenders = walk(srcRoot)
      .filter((file) => /\.(ts|tsx|vue)$/.test(file))
      .filter((file) => !file.endsWith("noReactSourceBoundary.test.ts"))
      .filter((file) => {
        if (file.endsWith(".tsx")) return true;
        const source = readFileSync(file, "utf8");
        return forbiddenSourcePatterns.some((pattern) => pattern.test(source));
      })
      .map((file) => relative(srcRoot, file));

    expect(offenders).toEqual([]);
  });
});
