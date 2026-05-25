import { readFileSync } from "node:fs";
import { join } from "node:path";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";

const repoRoot = fileURLToPath(new URL("../../", import.meta.url));

describe("Tauri window capabilities", () => {
  it("allows both close requests and confirmed destruction", () => {
    const capability = JSON.parse(
      readFileSync(
        join(repoRoot, "src-tauri", "capabilities", "default.json"),
        "utf8",
      ),
    ) as { permissions?: string[] };

    expect(capability.permissions).toContain("core:window:allow-close");
    expect(capability.permissions).toContain("core:window:allow-destroy");
  });

  it("allows querying maximized and fullscreen window state", () => {
    const capability = JSON.parse(
      readFileSync(
        join(repoRoot, "src-tauri", "capabilities", "default.json"),
        "utf8",
      ),
    ) as { permissions?: string[] };

    expect(capability.permissions).toContain("core:window:allow-is-maximized");
    expect(capability.permissions).toContain("core:window:allow-is-fullscreen");
  });

  it("allows native text clipboard access without browser permissions", () => {
    const capability = JSON.parse(
      readFileSync(
        join(repoRoot, "src-tauri", "capabilities", "default.json"),
        "utf8",
      ),
    ) as { permissions?: string[] };

    expect(capability.permissions).toContain(
      "clipboard-manager:allow-read-text",
    );
    expect(capability.permissions).toContain(
      "clipboard-manager:allow-write-text",
    );
  });
});
