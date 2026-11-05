import { describe, expect, it } from "vitest";
import { resolvePanelTabToggle } from "./panelVisibility";

describe("resolvePanelTabToggle", () => {
  it("面板可见时:同一个视图连按两次来回切,不同视图直接切过去", () => {
    expect(resolvePanelTabToggle("explorer", "explorer", true)).toBe("changes");
    expect(resolvePanelTabToggle("changes", "changes", true)).toBe("explorer");
    expect(resolvePanelTabToggle("changes", "explorer", true)).toBe("explorer");
    expect(resolvePanelTabToggle("explorer", "changes", true)).toBe("changes");
  });

  it("面板收起时:切到指定视图(由调用方展开面板)", () => {
    expect(resolvePanelTabToggle("explorer", "explorer", false)).toBe("explorer");
    expect(resolvePanelTabToggle("changes", "explorer", false)).toBe("explorer");
    expect(resolvePanelTabToggle("explorer", "changes", false)).toBe("changes");
  });
});
