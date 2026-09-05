/**
 * Workspace environment types and pure helpers.
 *
 * IMPORTANT: This module previously held a process-wide mutable singleton
 * (`selectedWorkspaceEnv`) read implicitly by ~40 `native.*` calls via
 * `currentWorkspaceEnv()`. That singleton was the single biggest blocker to
 * running multiple workspaces concurrently, because whichever workspace last
 * called `setEnv()` would hijack every in-flight native call.
 *
 * It has been removed. Every native call now receives an explicit
 * `workspace: WorkspaceEnv` argument. Only the pure type/constants/helpers
 * remain here.
 */

export type WorkspaceEnv =
  | { kind: "local" }
  | { kind: "wsl"; distro: string }
  | { kind: "ssh"; profileId: string };

export type WslDistro = {
  name: string;
  default: boolean;
  running: boolean;
};

export const LOCAL_WORKSPACE: WorkspaceEnv = { kind: "local" };

/** Stable scope key for a workspace env — used for cache isolation and ids. */
export function workspaceScopeKey(env: WorkspaceEnv): string {
  switch (env.kind) {
    case "wsl":
      return `wsl:${env.distro}`;
    case "ssh":
      return `ssh:${env.profileId}`;
    default:
      return "local";
  }
}

/** Structural equality check for two workspace envs. */
export function sameWorkspaceEnv(a: WorkspaceEnv, b: WorkspaceEnv): boolean {
  if (a.kind !== b.kind) return false;
  if (a.kind === "local") return true;
  if (a.kind === "wsl") return b.kind === "wsl" && a.distro === b.distro;
  return b.kind === "ssh" && a.profileId === b.profileId;
}
