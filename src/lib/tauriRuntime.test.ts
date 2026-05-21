import { describe, expect, it } from "vitest";
import { hasTauriInternals } from "./tauriRuntime";

describe("tauri runtime detection", () => {
  it("detects whether Tauri internals are available", () => {
    expect(hasTauriInternals({})).toBe(false);
    expect(hasTauriInternals({ __TAURI_INTERNALS__: { invoke: () => null } })).toBe(true);
  });
});
