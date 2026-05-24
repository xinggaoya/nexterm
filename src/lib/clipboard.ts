import {
  readText,
  writeText,
} from "@tauri-apps/plugin-clipboard-manager";

export async function readClipboardText(): Promise<string> {
  try {
    return await readText();
  } catch {
    return "";
  }
}

export async function writeClipboardText(text: string): Promise<void> {
  try {
    await writeText(text);
  } catch {
    // Best-effort; clipboard access can fail if the native runtime is absent.
  }
}
