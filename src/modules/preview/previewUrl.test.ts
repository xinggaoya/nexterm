import { describe, expect, it } from "vitest";
import { isLocalPreviewUrl, normalizePreviewUrl } from "./previewUrl";

describe("preview url helpers", () => {
  it("normalizes common address bar inputs", () => {
    expect(normalizePreviewUrl(" localhost:5173 ")).toBe("http://localhost:5173");
    expect(normalizePreviewUrl("127.0.0.1:3000")).toBe("http://127.0.0.1:3000");
    expect(normalizePreviewUrl("example.com/docs")).toBe("https://example.com/docs");
    expect(normalizePreviewUrl("https://example.com")).toBe("https://example.com");
    expect(normalizePreviewUrl("")).toBeNull();
  });

  it("detects local preview origins for embed warnings", () => {
    expect(isLocalPreviewUrl("http://localhost:5173")).toBe(true);
    expect(isLocalPreviewUrl("http://127.0.0.1:3000")).toBe(true);
    expect(isLocalPreviewUrl("http://app.localhost:5173")).toBe(true);
    expect(isLocalPreviewUrl("https://example.com")).toBe(false);
    expect(isLocalPreviewUrl("not a url")).toBe(false);
  });
});
