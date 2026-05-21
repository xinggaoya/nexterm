export type WorkspaceEnv =
  | { kind: "local" }
  | { kind: "wsl"; distro: string };

export type WslDistro = {
  name: string;
  default: boolean;
  running: boolean;
};

export const LOCAL_WORKSPACE: WorkspaceEnv = { kind: "local" };

let selectedWorkspaceEnv: WorkspaceEnv = LOCAL_WORKSPACE;

export function setCurrentWorkspaceEnv(env: WorkspaceEnv): void {
  selectedWorkspaceEnv = env;
}

export function currentWorkspaceEnv(): WorkspaceEnv {
  return selectedWorkspaceEnv;
}

export function workspaceScopeKey(env: WorkspaceEnv): string {
  return env.kind === "wsl" ? `wsl:${env.distro}` : "local";
}

export function currentWorkspaceScopeKey(): string {
  return workspaceScopeKey(currentWorkspaceEnv());
}
