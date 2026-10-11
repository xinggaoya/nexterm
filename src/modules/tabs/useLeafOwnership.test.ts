import { describe, expect, it } from "vitest";

import { useLeafOwnership } from "./useLeafOwnership";

describe("leaf ownership", () => {
  it("registers and resolves a leaf owner in O(1)", () => {
    const { register, ownerOf } = useLeafOwnership();
    register("ws", 7, 70);
    expect(ownerOf("ws", 70)).toBe(7);
  });

  it("keeps workspaces isolated", () => {
    const { register, ownerOf } = useLeafOwnership();
    register("a", 1, 10);
    register("b", 2, 10);
    expect(ownerOf("a", 10)).toBe(1);
    expect(ownerOf("b", 10)).toBe(2);
    expect(ownerOf("c", 10)).toBeUndefined();
  });

  it("unregister removes a single leaf", () => {
    const { register, unregister, ownerOf, snapshot } = useLeafOwnership();
    register("ws", 1, 10);
    register("ws", 1, 11);
    unregister("ws", 10);

    expect(ownerOf("ws", 10)).toBeUndefined();
    expect(snapshot("ws")).toEqual({ 11: 1 });
  });

  it("unregister on an unknown leaf is a no-op", () => {
    const { unregister, snapshot } = useLeafOwnership();
    unregister("ws", 99);
    expect(snapshot("ws")).toEqual({});
  });

  it("clearForTab drops every leaf owned by that tab only", () => {
    const { register, clearForTab, snapshot } = useLeafOwnership();
    register("ws", 1, 10);
    register("ws", 1, 11);
    register("ws", 2, 12);

    clearForTab("ws", 1);
    expect(snapshot("ws")).toEqual({ 12: 2 });
  });

  it("clearWorkspace drops the whole bucket", () => {
    const { register, clearWorkspace, snapshot } = useLeafOwnership();
    register("ws", 1, 10);
    clearWorkspace("ws");
    expect(snapshot("ws")).toEqual({});
  });
});
