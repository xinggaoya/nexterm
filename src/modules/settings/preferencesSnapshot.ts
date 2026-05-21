import { DEFAULT_PREFERENCES, type Preferences } from "./store";

let snapshot: Preferences = { ...DEFAULT_PREFERENCES };

export function readPreferencesSnapshot(): Preferences {
  return snapshot;
}

export function replacePreferencesSnapshot(next: Preferences): void {
  snapshot = { ...next };
}

export function patchPreferencesSnapshot<K extends keyof Preferences>(
  key: K,
  value: Preferences[K],
): void {
  snapshot = { ...snapshot, [key]: value };
}
