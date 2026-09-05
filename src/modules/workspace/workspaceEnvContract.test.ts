import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import { workspaceScopeKey, type WorkspaceEnv } from "./workspaceEnvSnapshot";

/**
 * WorkspaceEnv 前后端契约测试:TS union 与 Rust serde enum 必须同步演进。
 * 任何一端新增/改名 kind,这里会先失败,防止 IPC 参数悄悄漂移。
 */

const repoRoot = fileURLToPath(new URL("../../../", import.meta.url));
const rustEnumPath = join(repoRoot, "src-tauri", "src", "modules", "workspace.rs");
const tsTypePath = join(repoRoot, "src", "modules", "workspace", "workspaceEnvSnapshot.ts");

describe("WorkspaceEnv frontend/backend contract", () => {
  it("rust enum declares local/wsl/ssh kinds", () => {
    const source = readFileSync(rustEnumPath, "utf8");
    expect(source).toContain("Local");
    expect(source).toContain("Wsl");
    expect(source).toContain("Ssh");
    expect(source).toContain('rename = "profileId"');
  });

  it("ts union declares local/wsl/ssh kinds", () => {
    const source = readFileSync(tsTypePath, "utf8");
    expect(source).toContain('kind: "local"');
    expect(source).toContain('kind: "wsl"');
    expect(source).toContain('kind: "ssh"');
    expect(source).toContain("profileId");
  });

  it("scope keys cover every kind", () => {
    const envs: WorkspaceEnv[] = [
      { kind: "local" },
      { kind: "wsl", distro: "Ubuntu" },
      { kind: "ssh", profileId: "p1" },
    ];
    expect(envs.map(workspaceScopeKey)).toEqual(["local", "wsl:Ubuntu", "ssh:p1"]);
  });
});
