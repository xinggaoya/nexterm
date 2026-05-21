import type { ProviderInfo } from "@/modules/ai/config";

export function maskProviderKey(key: string): string {
  if (key.length <= 8) return "•".repeat(key.length);
  return `${key.slice(0, 4)}${"•".repeat(8)}${key.slice(-4)}`;
}

export function validateProviderKeyInput(
  provider: ProviderInfo,
  value: string,
): string | null {
  const trimmed = value.trim();
  if (!trimmed) return "Enter your API key.";
  if (provider.keyPrefix && !trimmed.startsWith(provider.keyPrefix)) {
    return `${provider.label} keys start with "${provider.keyPrefix}".`;
  }
  return null;
}
