import { describe, expect, it } from "vitest";
import { fuzzyFilter } from "./fuzzyMatch";

type Row = { name: string };

const ROWS: Row[] = [
  { name: "Readme.md" },
  { name: "src" },
  { name: "index.ts" },
];

describe("fuzzyFilter", () => {
  it("returns the original list untouched for an empty query", () => {
    expect(fuzzyFilter(ROWS, "", { keys: ["name"] })).toEqual(ROWS);
    expect(fuzzyFilter(ROWS, "   ", { keys: ["name"] })).toEqual(ROWS);
  });

  it("matches non-contiguous characters", () => {
    expect(fuzzyFilter(ROWS, "rdm", { keys: ["name"] }).map((r) => r.name)).toEqual([
      "Readme.md",
    ]);
  });

  it("ranks the stronger match first", () => {
    const names = fuzzyFilter(ROWS, "readme", { keys: ["name"] }).map(
      (r) => r.name,
    );
    expect(names[0]).toBe("Readme.md");
  });

  it("respects the threshold", () => {
    // 阈值调到 0 时必须精确命中，"rdm" 不再算 "Readme.md"。
    expect(
      fuzzyFilter(ROWS, "rdm", { keys: ["name"], threshold: 0 }),
    ).toEqual([]);
  });

  it("is case insensitive", () => {
    expect(
      fuzzyFilter(ROWS, "README", { keys: ["name"] }).map((r) => r.name),
    ).toEqual(["Readme.md"]);
  });
});
