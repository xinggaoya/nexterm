import { describe, expect, it } from "vitest";
import { createSimpleStore } from "./simpleStore";

describe("createSimpleStore", () => {
  it("supports selector reads, updates, and subscriptions without React", () => {
    const store = createSimpleStore<{
      count: number;
      inc: () => void;
    }>((set) => ({
      count: 0,
      inc: () => set((state) => ({ count: state.count + 1 })),
    }));
    const snapshots: number[] = [];
    const unsubscribe = store.subscribe((state) => {
      snapshots.push(state.count);
    });

    store.getState().inc();
    store.setState({ count: 4 });
    unsubscribe();
    store.setState({ count: 5 });

    expect(store((state) => state.count)).toBe(5);
    expect(snapshots).toEqual([1, 4]);
  });
});
