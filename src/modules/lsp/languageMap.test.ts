import { describe, expect, it } from "vitest";
import { detectLspLanguage } from "./languageMap";

describe("detectLspLanguage", () => {
  it("maps common extensions", () => {
    expect(detectLspLanguage("src/main.rs")).toBe("rust");
    expect(detectLspLanguage("a.ts")).toBe("typescript");
    expect(detectLspLanguage("a.py")).toBe("python");
    expect(detectLspLanguage("a.go")).toBe("go");
    expect(detectLspLanguage("a.js")).toBe("javascript");
    expect(detectLspLanguage("a.jsx")).toBe("javascript");
  });

  it("returns null for unknown", () => {
    expect(detectLspLanguage("a.md")).toBeNull();
    expect(detectLspLanguage("a.txt")).toBeNull();
  });

  it("respects filename overrides", () => {
    expect(detectLspLanguage("Cargo.lock")).toBeNull();
  });
});
