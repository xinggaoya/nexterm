import { describe, expect, it } from "vitest";
import type { Tab } from "./tabsTypes";
import {
  describeDirtyEditorTabs,
  dirtyEditorTabs,
  isDirtyEditorTab,
} from "./closeGuards";

const tabs: Tab[] = [
  {
    id: 1,
    kind: "terminal",
    title: "shell",
    paneTree: { kind: "leaf", id: 2 },
    activeLeafId: 2,
  },
  {
    id: 3,
    kind: "editor",
    title: "clean.ts",
    path: "/repo/src/clean.ts",
    dirty: false,
    preview: false,
  },
  {
    id: 4,
    kind: "editor",
    title: "dirty.ts",
    path: "/repo/src/dirty.ts",
    dirty: true,
    preview: false,
  },
  {
    id: 5,
    kind: "markdown",
    title: "README.md",
    path: "/repo/README.md",
  },
  {
    id: 6,
    kind: "editor",
    title: "preview.ts",
    path: "/repo/src/preview.ts",
    dirty: true,
    preview: true,
  },
];

describe("closeGuards", () => {
  it("finds only dirty editor tabs", () => {
    expect(dirtyEditorTabs(tabs).map((tab) => tab.id)).toEqual([4, 6]);
    expect(isDirtyEditorTab(tabs[0])).toBe(false);
    expect(isDirtyEditorTab(tabs[2])).toBe(true);
  });

  it("describes dirty editor tabs for confirmation dialogs", () => {
    expect(describeDirtyEditorTabs([tabs[2]])).toBe("dirty.ts");
    expect(describeDirtyEditorTabs(dirtyEditorTabs(tabs))).toBe(
      "2 unsaved files: dirty.ts, preview.ts",
    );
  });
});
