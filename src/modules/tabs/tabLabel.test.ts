import { describe, expect, it } from "vitest";
import { basename, tabLabel } from "./tabLabel";
import type { Tab } from "./tabsTypes";

describe("basename", () => {
  it("returns the last segment for POSIX paths", () => {
    expect(basename("/home/xinggao/dev/rust/nexterm")).toBe("nexterm");
  });

  it("returns the last segment for Windows paths", () => {
    expect(basename("C:\\Users\\xinggao\\dev\\nexterm")).toBe("nexterm");
  });

  it("handles mixed separators", () => {
    expect(basename("/home/xinggao/dev\\nexterm")).toBe("nexterm");
  });

  it('returns "/" for empty input', () => {
    expect(basename("")).toBe("/");
  });
});

describe("tabLabel", () => {
  const terminalWithTitle: Tab = {
    id: 1,
    workspaceId: "test-ws",
    kind: "terminal",
    title: "shell",
    terminalTitle: "MyAgent",
    cwd: "/tmp",
    paneTree: { kind: "leaf", id: 2 },
    activeLeafId: 2,
  };

  const terminalWithCwd: Tab = {
    id: 2,
    workspaceId: "test-ws",
    kind: "terminal",
    title: "shell",
    cwd: "/tmp",
    paneTree: { kind: "leaf", id: 3 },
    activeLeafId: 3,
  };

  const terminalBare: Tab = {
    id: 3,
    workspaceId: "test-ws",
    kind: "terminal",
    title: "shell",
    paneTree: { kind: "leaf", id: 4 },
    activeLeafId: 4,
  };

  const editorTab: Tab = {
    id: 5,
    workspaceId: "test-ws",
    kind: "editor",
    title: "foo.ts",
    path: "/repo/foo.ts",
    dirty: false,
    preview: false,
  };

  const gitHistoryTab: Tab = {
    id: 6,
    workspaceId: "test-ws",
    kind: "git-history",
    title: "feat: add foo",
    repoRoot: "/repo",
    refName: null,
    allRefs: false,
  };

  it("prefers terminalTitle over cwd and title", () => {
    expect(tabLabel(terminalWithTitle)).toBe("MyAgent");
  });

  it("falls back to basename(cwd) when terminalTitle is missing", () => {
    expect(tabLabel(terminalWithCwd)).toBe("tmp");
  });

  it("falls back to title for terminal tabs without title or cwd", () => {
    expect(tabLabel(terminalBare)).toBe("shell");
  });

  it("returns title directly for editor tabs", () => {
    expect(tabLabel(editorTab)).toBe("foo.ts");
  });

  it("returns title directly for git-history tabs", () => {
    expect(tabLabel(gitHistoryTab)).toBe("feat: add foo");
  });
});
