export {
  LOCAL_WORKSPACE,
  workspaceScopeKey,
  sameWorkspaceEnv,
  type WorkspaceEnv,
  type WslDistro,
} from "./workspaceEnvSnapshot";
export { authorizeWorkspace, getWslHome } from "./workspaceNative";
export { useWorkspaceEnvPiniaStore } from "./workspaceEnvPinia";
export {
  RECENT_WORKSPACE_LIMIT,
  normalizeWorkspacePath,
  isSameWorkspaceRoot,
  type LaunchWorkspace,
  type WorkspaceSelection,
  useWorkspaceRootPiniaStore,
} from "./workspaceRootPinia";
export {
  useWorkspacesPiniaStore,
  type WorkspaceInstance,
  type PersistedWorkspace,
  type AddWorkspaceResult,
} from "./workspacesPinia";
export { openWorkspaceInNewWindow } from "./workspaceWindow";
