import { describe, expect, it } from "vitest";

import {
  isUnderPath,
  normalizePathPrefix,
  remapUnderPath,
} from "./pathRemap";

describe("path remap", () => {
  it("remaps an exact match", () => {
    expect(remapUnderPath("/repo/src", "/repo/src", "/repo/lib")).toBe("/repo/lib");
  });

  it("remaps a descendant and preserves the relative tail", () => {
    expect(remapUnderPath("/repo/src/a/b.ts", "/repo/src", "/repo/lib")).toBe(
      "/repo/lib/a/b.ts",
    );
  });

  it("does not match a sibling with a shared string prefix", () => {
    // 回归护栏：`/repo/src-legacy/a.ts`.startsWith("/repo/src") 是 true，
    // 搬走 src 时会把 src-legacy 一起改掉 —— 那正是要避免的误伤。
    expect(remapUnderPath("/repo/src-legacy/a.ts", "/repo/src", "/repo/lib")).toBeNull();
    expect(remapUnderPath("/repo/srcx", "/repo/src", "/repo/lib")).toBeNull();
  });

  it("normalizes separators and trailing slashes on both sides", () => {
    expect(remapUnderPath("C:\\repo\\src\\a.ts", "C:\\repo\\src\\", "C:/repo/lib")).toBe(
      "C:/repo/lib/a.ts",
    );
    expect(normalizePathPrefix("/repo/src///")).toBe("/repo/src");
  });

  it("treats a nested path outside the root as unrelated", () => {
    expect(remapUnderPath("/other/a.ts", "/repo/src", "/repo/lib")).toBeNull();
    expect(remapUnderPath("/repo/other/a.ts", "/repo/src", "/repo/lib")).toBeNull();
  });

  it("isUnderPath includes the root itself", () => {
    expect(isUnderPath("/repo/src", "/repo/src")).toBe(true);
    expect(isUnderPath("/repo/src/a.ts", "/repo/src")).toBe(true);
    expect(isUnderPath("/repo/src-legacy", "/repo/src")).toBe(false);
  });
});
