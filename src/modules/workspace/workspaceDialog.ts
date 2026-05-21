import { open } from "@tauri-apps/plugin-dialog";

import { normalizeWorkspacePath } from "./workspacePath";

export async function selectWorkspaceDirectory(
  defaultPath?: string,
): Promise<string | null> {
  const selected = await open({
    directory: true,
    multiple: false,
    defaultPath,
  });
  if (Array.isArray(selected)) {
    const first = selected[0];
    return typeof first === "string" ? normalizeWorkspacePath(first) : null;
  }
  return typeof selected === "string" ? normalizeWorkspacePath(selected) : null;
}
