import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";

const root = new URL("../../", import.meta.url);

const forbiddenPackages = [
  ["@ai-sdk", "react"].join("/"),
  ["@hugeicons", "react"].join("/"),
  ["@radix-ui", "react-use-controllable-state"].join("/"),
  ["@tanstack", "react-virtual"].join("/"),
  ["@uiw", "react-codemirror"].join("/"),
  ["@types", "react"].join("/"),
  ["@types", ["react", "dom"].join("-")].join("/"),
  ["@vitejs", "plugin-react"].join("/"),
  ["class", "variance", "authority"].join("-"),
  "clsx",
  "cmdk",
  "motion",
  "radix-ui",
  "react",
  ["react", "dom"].join("-"),
  ["react", "resizable", "panels"].join("-"),
  "streamdown",
  ["tailwind", "merge"].join("-"),
  ["use", "stick", "to", "bottom"].join("-"),
  ["zus", "tand"].join(""),
];

describe("package React boundary", () => {
  it("does not keep React-era packages after the Vue migration", () => {
    const pkg = JSON.parse(
      readFileSync(new URL("package.json", root), "utf8"),
    ) as {
      dependencies?: Record<string, string>;
      devDependencies?: Record<string, string>;
    };
    const installed = {
      ...pkg.dependencies,
      ...pkg.devDependencies,
    };

    const remaining = forbiddenPackages.filter((name) => name in installed);

    expect(remaining).toEqual([]);
  });
});
