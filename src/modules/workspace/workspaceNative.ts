import { createNativeForEnv, native } from "@/lib/native";
import type { WorkspaceEnv } from "./workspaceEnvSnapshot";

export function getWslHome(distro: string): Promise<string> {
  return native.getWslHome(distro);
}

export function authorizeWorkspace(
  path: string,
  workspace: WorkspaceEnv,
): Promise<string> {
  return createNativeForEnv(workspace).workspaceAuthorize(path);
}
