import { invoke } from "@tauri-apps/api/core";
import type { SettingsTab } from "./tabs";
export type { SettingsTab } from "./tabs";

export async function openSettingsWindow(tab?: SettingsTab): Promise<void> {
  await invoke("open_settings_window", { tab: tab ?? null });
}
