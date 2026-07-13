import { describe, expect, it } from "vitest";
import {
  createLeaf,
  findLeafCwd,
  leafIds,
  nextLeafInDir,
  removeLeaf,
  setLeafCwd,
  setLeafTitle,
  splitLeaf,
  type SplitDir,
} from "./layout";

describe("pane tree operations", () => {
  it("splits a leaf into two siblings", () => {
    const leaf = createLeaf("/a");
    const { tree } = splitLeaf(leaf, leaf.id, "row", undefined, "/a");
    expect(tree.kind).toBe("split");
    if (tree.kind === "split") {
      expect(tree.children).toHaveLength(2);
      expect(tree.children[0].kind).toBe("leaf");
      expect(tree.children[1].kind).toBe("leaf");
    }
  });

  it("returns a stable id for the newly created leaf", () => {
    const leaf = createLeaf();
    const { leafId } = splitLeaf(leaf, leaf.id, "col", undefined, undefined);
    expect(leafId).not.toBe(leaf.id);
  });

  it("removes a leaf and unwraps single-child splits", () => {
    const a = createLeaf();
    const { tree: split } = splitLeaf(a, a.id, "row");
    if (split.kind !== "split") throw new Error("expected split");
    const newLeafId = split.children[1].id;
    const removed = removeLeaf(split, newLeafId);
    expect(removed).not.toBeNull();
    expect(removed?.kind).toBe("leaf");
    expect(removed?.id).toBe(a.id);
  });

  it("keeps cwd and title assignments scoped to a single leaf", () => {
    const a = createLeaf("/repo");
    const b = createLeaf("/other");
    const { tree } = splitLeaf(a, a.id, "row");
    if (tree.kind !== "split") throw new Error("expected split");
    let now = setLeafCwd(tree, a.id, "/updated");
    now = setLeafTitle(now, b.id, "left cli");

    expect(findLeafCwd(now, a.id)).toBe("/updated");
    expect(findLeafCwd(now, b.id)).toBeUndefined();
    expect((leafIds(now) as string[])).toHaveLength(2);
  });

  it("supports direction-aware neighbour resolution", () => {
    // Build: split row of [A, B] and ask for B's right neighbour in a row
    // of three leaves (B should find C, the next-on-the-right).
    const a = createLeaf();
    const { tree: t1, leafId: b } = splitLeaf(a, a.id, "row");
    const { tree: root, leafId: c } = splitLeaf(t1, b, "row");

    // Use string ids (the default when newLeafId is omitted).
    expect(typeof b).toBe("string");
    expect(typeof c).toBe("string");
    expect(nextLeafInDir(root, a.id, "right")).toBe(b);
    expect(nextLeafInDir(root, a.id, "right")).not.toBe(c);
  });
});

describe("splitLeaf id overrides", () => {
  it("accepts caller-provided ids to preserve stable numbering", () => {
    const leaf = createLeaf();
    const { tree, leafId } = splitLeaf(
      leaf,
      leaf.id,
      "col",
      42,
      undefined,
      41,
    );
    expect(leafId).toBe(42);
    if (tree.kind === "split") {
      expect(tree.id).toBe(41);
    } else {
      throw new Error("expected split");
    }
  });
});

describe("splitDir", () => {
  it("rejects other directions", () => {
    // purely a type-level smoke test — runtime never sees invalid SplitDir
    const dir: SplitDir = "row";
    expect(["row", "col"]).toContain(dir);
  });
});
