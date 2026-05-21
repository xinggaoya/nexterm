import { invoke } from "@tauri-apps/api/core";

let cached: string | undefined;

function normalizeDir(dir: string | null | undefined): string | undefined {
  return dir ? dir.replace(/\\/g, "/") : undefined;
}

export async function initLaunchDir(): Promise<void> {
  const explicit = normalizeDir(
    await invoke<string | null>("get_launch_dir").catch(() => null),
  );
  cached = explicit;
}

export function getLaunchDir(): string | undefined {
  return cached;
}
