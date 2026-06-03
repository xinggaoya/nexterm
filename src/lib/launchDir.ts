import { native } from "@/lib/native";
import type { WorkspaceEnv } from "@/modules/workspace/workspaceEnvSnapshot";

export type LaunchWorkspace = {
  path: string;
  env: WorkspaceEnv;
};

let cached: LaunchWorkspace | undefined;

function normalizeDir(dir: string | null | undefined): string | undefined {
  return dir ? dir.replace(/\\/g, "/") : undefined;
}

function launchWorkspaceFromUrl(): LaunchWorkspace | undefined {
  if (typeof window === "undefined") return undefined;
  const params = new URLSearchParams(window.location.search);
  const path = normalizeDir(params.get("workspacePath"));
  if (!path) return undefined;

  if (params.get("workspaceEnv") === "wsl") {
    const distro = params.get("wslDistro")?.trim();
    if (!distro) return undefined;
    return { path, env: { kind: "wsl", distro } };
  }

  return { path, env: { kind: "local" } };
}

export async function initLaunchDir(): Promise<void> {
  const fromUrl = launchWorkspaceFromUrl();
  if (fromUrl) {
    cached = fromUrl;
    return;
  }

  const explicit = normalizeDir(await native.getLaunchDir().catch(() => null));
  cached = explicit ? { path: explicit, env: { kind: "local" } } : undefined;
}

export function getLaunchDir(): string | undefined {
  return cached?.path;
}

export function getLaunchWorkspace(): LaunchWorkspace | undefined {
  return cached;
}
