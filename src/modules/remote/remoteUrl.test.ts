import { describe, expect, it } from "vitest";
import { buildRemoteAccessUrl, redactRemoteToken } from "./remoteUrl";

describe("remoteUrl", () => {
  it("builds a LAN host URL with the token in the query string", () => {
    expect(
      buildRemoteAccessUrl({
        host: "192.168.1.20",
        port: 49201,
        token: "abc123",
      }),
    ).toBe(
      "http://192.168.1.20:49201/?token=abc123",
    );
  });

  it("redacts tokens without changing short empty state labels", () => {
    expect(redactRemoteToken("abcdef1234567890")).toBe("abcd...7890");
    expect(redactRemoteToken("")).toBe("");
  });
});
