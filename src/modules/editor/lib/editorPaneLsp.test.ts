// @vitest-environment jsdom
import { describe, expect, it, vi } from "vitest";

vi.mock("@tauri-apps/api/core", () => ({
  Channel: class {},
  invoke: vi.fn().mockResolvedValue(null),
}));

import type { EditorView } from "@codemirror/view";
import { attachOrDetachLsp } from "./editorPaneLsp";

describe("editorPaneLsp", () => {
  it("skips attachment in builtin mode (no-op)", async () => {
    const editor = {} as EditorView;
    await expect(
      attachOrDetachLsp(editor, "src/main.rs", "builtin"),
    ).resolves.toBeUndefined();
  });

  it("does not throw when given a path with no LSP language match", async () => {
    const editor = {} as EditorView;
    await expect(
      attachOrDetachLsp(editor, "README.md", "lsp"),
    ).resolves.toBeUndefined();
  });
});
