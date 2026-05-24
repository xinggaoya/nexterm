import { beforeEach, describe, expect, it, vi } from "vitest";

const readTextMock = vi.hoisted(() => vi.fn());
const writeTextMock = vi.hoisted(() => vi.fn());

vi.mock("@tauri-apps/plugin-clipboard-manager", () => ({
  readText: readTextMock,
  writeText: writeTextMock,
}));

describe("clipboard adapter", () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it("reads text through the Tauri clipboard plugin", async () => {
    readTextMock.mockResolvedValue("pwd\n");
    const { readClipboardText } = await import("./clipboard");

    await expect(readClipboardText()).resolves.toBe("pwd\n");
    expect(readTextMock).toHaveBeenCalledTimes(1);
  });

  it("writes text through the Tauri clipboard plugin", async () => {
    writeTextMock.mockResolvedValue(undefined);
    const { writeClipboardText } = await import("./clipboard");

    await writeClipboardText("abcdef1");

    expect(writeTextMock).toHaveBeenCalledWith("abcdef1");
  });

  it("returns empty text when clipboard read fails", async () => {
    readTextMock.mockRejectedValue(new Error("clipboard unavailable"));
    const { readClipboardText } = await import("./clipboard");

    await expect(readClipboardText()).resolves.toBe("");
  });

  it("swallows clipboard write failures", async () => {
    writeTextMock.mockRejectedValue(new Error("clipboard unavailable"));
    const { writeClipboardText } = await import("./clipboard");

    await expect(writeClipboardText("ignored")).resolves.toBeUndefined();
  });
});
