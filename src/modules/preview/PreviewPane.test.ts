import { readFileSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";

/**
 * Source-level regression test for the preview iframe's security attributes.
 * The sandbox is now dynamic (it depends on whether the URL is a local dev
 * preview or a remote origin), so we read the source and assert on the
 * intent — if a future change accidentally re-enables the dangerous
 * `allow-scripts + allow-same-origin` combination for remote URLs, this
 * test must fail.
 */

const here = path.dirname(fileURLToPath(import.meta.url));
const src = readFileSync(path.join(here, "PreviewPane.vue"), "utf8");

const stringLiterals = [...src.matchAll(/"([^"\\]*(?:\\.[^"\\]*)*)"/g)].map(
  (match) => match[1] ?? "",
);

function findLiteralContaining(needle: string): string | undefined {
  return stringLiterals.find(
    (literal) => literal.includes(needle) && /\ballow-/.test(literal),
  );
}

describe("PreviewPane iframe sandbox", () => {
  it("binds the sandbox attribute via a computed expression (not a literal string)", () => {
    // Dynamic binding: `:sandbox="sandboxAttrs"` so the value can switch
    // between the local-friendly and remote-safe sets.
    expect(src).toMatch(/:\s*sandbox="sandboxAttrs"/);
  });

  it("keeps the local-preview branch granting allow-same-origin", () => {
    // The local branch is what makes dev servers work (cookie + storage access).
    const localBranch = findLiteralContaining("allow-same-origin");
    expect(localBranch, "expected a sandbox literal that includes allow-same-origin").toBeDefined();
    expect(localBranch).toContain("allow-scripts");
  });

  it("strips allow-same-origin from the remote branch", () => {
    // The remote branch MUST NOT grant same-origin — otherwise an XSS payload
    // inside a remote page would reach the parent's storage / Tauri bridge.
    const remoteBranch = findLiteralContaining("allow-popups-to-escape-sandbox");
    expect(remoteBranch, "expected a sandbox literal that includes allow-popups-to-escape-sandbox").toBeDefined();
    // Find any sandbox literal that does NOT include allow-same-origin.
    const safeOnly = stringLiterals.find(
      (literal) =>
        /\ballow-/.test(literal) &&
        literal.includes("allow-scripts") &&
        !literal.includes("allow-same-origin"),
    );
    expect(safeOnly, "expected at least one sandbox literal without allow-same-origin").toBeDefined();
  });

  it("does NOT include allow-top-navigation* tokens in any branch", () => {
    // Top-nav permissions must never be added — a sandboxed iframe that can
    // navigate the parent webview to attacker origin is game over.
    expect(src).not.toMatch(/allow-top-navigation/);
  });

  it("still sets referrerPolicy to no-referrer on the iframe", () => {
    expect(src).toMatch(/referrerPolicy="no-referrer"/);
  });
});
