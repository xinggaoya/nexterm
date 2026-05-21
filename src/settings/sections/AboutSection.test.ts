import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";

describe("AboutSection.vue", () => {
  it("does not bundle package.json dependency metadata into the settings window", () => {
    const source = readFileSync(
      new URL("./AboutSection.vue", import.meta.url),
      "utf8",
    );

    expect(source).not.toContain("package.json");
  });
});
