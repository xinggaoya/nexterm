import {
  isPermissionGranted,
  requestPermission,
  sendNotification,
} from "@tauri-apps/plugin-notification";
import { getCurrentWindow } from "@tauri-apps/api/window";
import { readPreferencesSnapshot } from "@/modules/settings/preferencesSnapshot";

let permissionChecked = false;
let permissionGranted = false;

const DEBOUNCE_MS = 2000;
let lastBellTime = 0;

export function useTerminalNotification() {
  async function ensurePermission(): Promise<boolean> {
    if (permissionChecked) return permissionGranted;
    try {
      permissionGranted = await isPermissionGranted();
      if (!permissionGranted) {
        const result = await requestPermission();
        permissionGranted = result === "granted";
      }
    } catch (e) {
      console.warn("[nexterm] notification permission check failed:", e);
      permissionGranted = false;
    }
    permissionChecked = true;
    return permissionGranted;
  }

  async function isWindowFocused(): Promise<boolean> {
    try {
      return await getCurrentWindow().isFocused();
    } catch {
      return true;
    }
  }

  function isEnabled(): boolean {
    return readPreferencesSnapshot().terminalNotificationEnabled;
  }

  function isSoundEnabled(): boolean {
    return readPreferencesSnapshot().terminalNotificationSoundEnabled;
  }

  async function notify(title: string, body: string): Promise<void> {
    if (!isEnabled()) return;
    if (await isWindowFocused()) return;
    if (!(await ensurePermission())) return;

    try {
      sendNotification({
        title,
        body,
        channelId: isSoundEnabled() ? undefined : "silent",
      });
    } catch (e) {
      console.warn("[nexterm] failed to send notification:", e);
    }
  }

  function notifyBell(): void {
    if (!isEnabled()) return;
    const now = Date.now();
    if (now - lastBellTime < DEBOUNCE_MS) return;
    lastBellTime = now;
    void notify("Terminal Bell", "A terminal bell character was received");
  }

  async function notifyCommandComplete(command?: string): Promise<void> {
    await notify(
      "Command Complete",
      command
        ? `Command finished: ${command}`
        : "A terminal command has completed",
    );
  }

  return {
    ensurePermission,
    notify,
    notifyBell,
    notifyCommandComplete,
    isEnabled,
    isSoundEnabled,
  };
}
