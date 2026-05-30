import { describe, expect, it } from "vitest";
import {
  isSameRoot,
  normalizeError,
  pushedLabel,
  stageLabel,
  statusTone,
} from "./sourceControlFormat";
import type { SourceControlFileEntry } from "./sourceControlModel";

const t = (key: string) => `t:${key}`;

function entry(overrides: Partial<SourceControlFileEntry>): SourceControlFileEntry {
  return {
    key: "src/main.ts",
    path: "src/main.ts",
    originalPath: null,
    statusCode: "M",
    statusLabel: "Modified",
    group: "modified",
    checkState: "unchecked",
    staged: false,
    unstaged: true,
    untracked: false,
    ...overrides,
  };
}

describe("source control formatting", () => {
  it("normalizes common display labels", () => {
    expect(stageLabel(entry({ checkState: "checked" }), t)).toBe(
      "t:sourceControl.staged",
    );
    expect(stageLabel(entry({ checkState: "indeterminate" }), t)).toBe(
      "t:sourceControl.mixed",
    );
    expect(stageLabel(entry({ checkState: "unchecked" }), t)).toBe(
      "t:sourceControl.unstaged",
    );

    expect(statusTone("A")).toBe("success");
    expect(statusTone("M")).toBe("warning");
    expect(statusTone("D")).toBe("error");
    expect(statusTone("R")).toBe("info");
  });

  it("normalizes action feedback and roots", () => {
    expect(normalizeError("failed", t)).toBe("failed");
    expect(normalizeError({ message: "object failed" }, t)).toBe("object failed");
    expect(normalizeError(null, t)).toBe("t:sourceControl.unknownError");
    expect(pushedLabel("origin", "main")).toBe("origin/main");
    expect(pushedLabel(null, "main")).toBe("main");
    expect(pushedLabel(null, null)).toBe("upstream");
    expect(isSameRoot("/repo/", "/repo")).toBe(true);
    expect(isSameRoot("C:\\repo\\", "C:/repo")).toBe(true);
    expect(isSameRoot(null, "/repo")).toBe(false);
  });
});
