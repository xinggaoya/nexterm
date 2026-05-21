import { describe, expect, it } from "vitest";
import { maskProviderKey, validateProviderKeyInput } from "./providerKeys";
import type { ProviderInfo } from "@/modules/ai/config";

const provider: ProviderInfo = {
  id: "openai",
  label: "OpenAI",
  keyringAccount: "openai-api-key",
  keyPrefix: "sk-",
  consoleUrl: "https://example.com",
};

describe("provider key helpers", () => {
  it("masks short keys without exposing characters", () => {
    expect(maskProviderKey("abcdef")).toBe("••••••");
  });

  it("keeps only the first and last four characters for long keys", () => {
    expect(maskProviderKey("sk-1234567890abcd")).toBe("sk-1••••••••abcd");
  });

  it("validates empty and prefix-mismatched keys", () => {
    expect(validateProviderKeyInput(provider, "")).toBe("Enter your API key.");
    expect(validateProviderKeyInput(provider, "bad-key")).toBe(
      'OpenAI keys start with "sk-".',
    );
    expect(validateProviderKeyInput(provider, "sk-valid")).toBeNull();
  });
});
