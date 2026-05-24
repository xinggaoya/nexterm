import { beforeEach, describe, expect, it, vi } from "vitest";
import { copyToClipboard, relativePath } from "./contextActions";
import { writeClipboardText } from "@/lib/clipboard";

vi.mock("@tauri-apps/plugin-opener", () => ({
  revealItemInDir: vi.fn(),
}));

vi.mock("@/lib/clipboard", () => ({
  writeClipboardText: vi.fn(async () => undefined),
}));

describe("explorer context actions", () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it("copies text through the shared clipboard adapter", async () => {
    await copyToClipboard("/repo/src/main.ts");

    expect(writeClipboardText).toHaveBeenCalledWith("/repo/src/main.ts");
  });

  it("creates relative paths from the workspace root", () => {
    expect(relativePath("/repo", "/repo/src/main.ts")).toBe("src/main.ts");
    expect(relativePath("/repo", "/repo")).toBe(".");
  });
});
