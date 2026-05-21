import { invoke } from "@tauri-apps/api/core";
import { currentWorkspaceEnv } from "./workspaceEnvSnapshot";

export function getWslHome(distro: string): Promise<string> {
  return invoke<string>("wsl_home", { distro });
}

export function authorizeWorkspace(path: string): Promise<string> {
  return invoke<string>("workspace_authorize", {
    path,
    workspace: currentWorkspaceEnv(),
  });
}
