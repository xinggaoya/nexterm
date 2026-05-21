import { describe, expect, it } from "vitest";
import {
  createTerminalSessionHandle,
  getTerminalBuffer,
  getTerminalSelection,
} from "./terminalSessionCore";

describe("terminal session core", () => {
  it("creates a framework-neutral pane handle for a leaf id", () => {
    const handle = createTerminalSessionHandle(999_001);

    expect(typeof handle.write).toBe("function");
    expect(typeof handle.focus).toBe("function");
    expect(typeof handle.getBuffer).toBe("function");
    expect(typeof handle.getSelection).toBe("function");
    expect(typeof handle.applyTheme).toBe("function");
  });

  it("returns null buffer and selection for a leaf without a session", () => {
    expect(getTerminalBuffer(999_002)).toBeNull();
    expect(getTerminalSelection(999_002)).toBeNull();
  });
});
