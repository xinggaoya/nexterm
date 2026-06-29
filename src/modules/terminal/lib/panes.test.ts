import { describe, expect, it } from "vitest";
import {
  isLeaf,
  leafIds,
  nextLeafInDir,
  type PaneNode,
} from "./panes";

function split(dir: "row" | "col", ...children: PaneNode[]): PaneNode {
  return { kind: "split", id: 100 + children.length, dir, children };
}

function leaf(id: number): PaneNode {
  return { kind: "leaf", id };
}

describe("nextLeafInDir", () => {
  it("returns null for a single leaf", () => {
    const tree = leaf(1);
    expect(nextLeafInDir(tree, 1, "left")).toBeNull();
    expect(nextLeafInDir(tree, 1, "right")).toBeNull();
  });

  it("moves between siblings in a row split", () => {
    const tree = split("row", leaf(1), leaf(2), leaf(3));
    expect(nextLeafInDir(tree, 1, "right")).toBe(2);
    expect(nextLeafInDir(tree, 2, "right")).toBe(3);
    expect(nextLeafInDir(tree, 3, "right")).toBeNull();
    expect(nextLeafInDir(tree, 2, "left")).toBe(1);
  });

  it("moves between siblings in a col split", () => {
    const tree = split("col", leaf(1), leaf(2));
    expect(nextLeafInDir(tree, 1, "down")).toBe(2);
    expect(nextLeafInDir(tree, 2, "up")).toBe(1);
    expect(nextLeafInDir(tree, 1, "up")).toBeNull();
  });

  it("walks through same-axis siblings in a 2x2 grid", () => {
    // Outer row split of [left col [a, b], right col [c, d]]
    const innerLeft = split("col", leaf(1), leaf(2));
    const innerRight = split("col", leaf(3), leaf(4));
    const tree = split("row", innerLeft, innerRight);
    // From a, going down should reach b (col siblings).
    expect(nextLeafInDir(tree, 1, "down")).toBe(2);
    expect(nextLeafInDir(tree, 2, "down")).toBeNull();
    // From b, going right should reach c's first leaf (a is at the
    // bottom of the left column, so right from b → top of right column).
    expect(nextLeafInDir(tree, 2, "right")).toBe(3);
  });

  it("clamps at edges", () => {
    const tree = split("row", leaf(1), leaf(2));
    expect(nextLeafInDir(tree, 1, "left")).toBeNull();
    expect(nextLeafInDir(tree, 2, "right")).toBeNull();
  });

  it("isLeaf and leafIds work for nested trees", () => {
    const tree = split("row", leaf(1), split("col", leaf(2), leaf(3)));
    expect(isLeaf(tree)).toBe(false);
    expect(leafIds(tree)).toEqual([1, 2, 3]);
  });
});
