import { hasTauriInternals } from "@/lib/tauriRuntime";
import type { usePreferencesPiniaStore } from "@/modules/settings/preferencesPinia";
import { generateRemoteToken } from "./remoteUrl";
import {
  startRemoteTerminal,
  stopRemoteTerminal,
  type RemoteServiceStatus,
} from "./remoteNative";

export type PreferencesStore = ReturnType<typeof usePreferencesPiniaStore>;

export async function ensureRemoteTerminalToken(
  prefs: PreferencesStore,
): Promise<string> {
  if (prefs.remoteTerminalToken) return prefs.remoteTerminalToken;
  const token = generateRemoteToken();
  await prefs.updateRemoteTerminalToken(token);
  return token;
}

export async function syncRemoteTerminalService(
  prefs: PreferencesStore,
): Promise<RemoteServiceStatus | null> {
  if (!hasTauriInternals()) return null;
  if (!prefs.remoteTerminalEnabled) {
    return stopRemoteTerminal();
  }
  const token = await ensureRemoteTerminalToken(prefs);
  return startRemoteTerminal({
    token,
    port: prefs.remoteTerminalPort,
  });
}
