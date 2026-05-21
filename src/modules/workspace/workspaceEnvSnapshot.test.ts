import { afterEach, describe, expect, it } from "vitest";
import {
  currentWorkspaceEnv,
  currentWorkspaceScopeKey,
  LOCAL_WORKSPACE,
  setCurrentWorkspaceEnv,
  workspaceScopeKey,
} from "./workspaceEnvSnapshot";

describe("workspace environment snapshot", () => {
  afterEach(() => {
    setCurrentWorkspaceEnv(LOCAL_WORKSPACE);
  });

  it("defaults to the local workspace without depending on a UI store", () => {
    expect(currentWorkspaceEnv()).toEqual({ kind: "local" });
    expect(currentWorkspaceScopeKey()).toBe("local");
  });

  it("tracks the selected workspace environment for framework-neutral callers", () => {
    setCurrentWorkspaceEnv({ kind: "wsl", distro: "Ubuntu-24.04" });

    expect(currentWorkspaceEnv()).toEqual({
      kind: "wsl",
      distro: "Ubuntu-24.04",
    });
    expect(currentWorkspaceScopeKey()).toBe("wsl:Ubuntu-24.04");
  });

  it("derives stable scope keys for explicit environments", () => {
    expect(workspaceScopeKey({ kind: "local" })).toBe("local");
    expect(workspaceScopeKey({ kind: "wsl", distro: "Debian" })).toBe(
      "wsl:Debian",
    );
  });
});
