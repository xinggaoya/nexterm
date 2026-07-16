// @vitest-environment jsdom
import { describe, expect, it, vi } from "vitest";

vi.mock("monaco-editor", () => import("../../../../tests/monaco-editor-stub"));
vi.mock("@tauri-apps/api/core", () => ({
  Channel: class {},
  invoke: vi.fn().mockResolvedValue(null),
}));

import { attachOrDetachLsp } from "./editorPaneLsp";
import type * as monaco from "monaco-editor";

describe("editorPaneLsp", () => {
  it("skips attachment in builtin mode (no-op)", async () => {
    const editor = {} as monaco.editor.IStandaloneCodeEditor;
    await expect(
      attachOrDetachLsp(editor, "src/main.rs", "builtin"),
    ).resolves.toBeUndefined();
  });

  it("does not throw when given a path with no LSP language match", async () => {
    const editor = {} as monaco.editor.IStandaloneCodeEditor;
    await expect(
      attachOrDetachLsp(editor, "README.md", "lsp"),
    ).resolves.toBeUndefined();
  });
});
