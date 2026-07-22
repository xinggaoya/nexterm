import { describe, expect, it } from "vitest";
import {
  LOCAL_WORKSPACE,
  sameWorkspaceEnv,
  workspaceScopeKey,
} from "./workspaceEnvSnapshot";

// 全局可变 env 单例 (currentWorkspaceEnv / setCurrentWorkspaceEnv /
// currentWorkspaceScopeKey) 已移除, 仅保留纯类型/常量/纯函数。
// 这里只验证保留的纯函数与常量。

describe("workspace environment snapshot", () => {
  it("exposes the local workspace constant", () => {
    expect(LOCAL_WORKSPACE).toEqual({ kind: "local" });
  });

  it("derives stable scope keys for explicit environments", () => {
    expect(workspaceScopeKey({ kind: "local" })).toBe("local");
    expect(workspaceScopeKey({ kind: "wsl", distro: "Debian" })).toBe(
      "wsl:Debian",
    );
  });

  it("compares workspace envs structurally via sameWorkspaceEnv", () => {
    // 两个 local 视作相等
    expect(sameWorkspaceEnv(LOCAL_WORKSPACE, { kind: "local" })).toBe(true);

    // 同一 distro 的 WSL 视作相等
    expect(
      sameWorkspaceEnv(
        { kind: "wsl", distro: "Ubuntu-24.04" },
        { kind: "wsl", distro: "Ubuntu-24.04" },
      ),
    ).toBe(true);

    // 不同 distro 视作不等
    expect(
      sameWorkspaceEnv(
        { kind: "wsl", distro: "Ubuntu-24.04" },
        { kind: "wsl", distro: "Debian" },
      ),
    ).toBe(false);

    // local 与 wsl 视作不等
    expect(
      sameWorkspaceEnv({ kind: "local" }, { kind: "wsl", distro: "Ubuntu" }),
    ).toBe(false);
  });
});
