import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";

describe("editor diff runtime boundary", () => {
  it("uses framework-neutral workspace snapshots instead of the legacy workspace store", () => {
    const diffCache = readFileSync(
      new URL("./lib/diffCache.ts", import.meta.url),
      "utf8",
    );
    const native = readFileSync(
      new URL("../ai/lib/native.ts", import.meta.url),
      "utf8",
    );

    expect(diffCache).not.toContain("@/modules/workspace\"");
    expect(diffCache).not.toContain("@/modules/workspace'");
    expect(native).not.toContain("@/modules/workspace\"");
    expect(native).not.toContain("@/modules/workspace'");
  });
});
