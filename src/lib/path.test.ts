import { describe, expect, it } from "vitest";
import { basename, dirname, joinPath, splitPathLabel } from "./path";

describe("path · splitPathLabel", () => {
  it("splits a nested path into name and directory", () => {
    expect(splitPathLabel("apps/cli/package.json")).toEqual({
      name: "package.json",
      dir: "apps/cli",
    });
  });

  it("returns an empty directory for single-segment paths", () => {
    expect(splitPathLabel("package.json")).toEqual({
      name: "package.json",
      dir: "",
    });
    expect(splitPathLabel("")).toEqual({ name: "", dir: "" });
  });

  it("supports Windows separators", () => {
    expect(splitPathLabel("src\\main.rs")).toEqual({
      name: "main.rs",
      dir: "src",
    });
  });

  it("keeps the leading slash of absolute paths", () => {
    expect(splitPathLabel("/abs/path/file.txt")).toEqual({
      name: "file.txt",
      dir: "/abs/path",
    });
  });

  it("drops trailing separators", () => {
    expect(splitPathLabel("apps/cli/")).toEqual({ name: "cli", dir: "apps" });
  });
});

describe("path · existing helpers", () => {
  it("keeps basename / dirname / joinPath behaviour", () => {
    expect(basename("a/b/c.txt")).toBe("c.txt");
    expect(dirname("a/b/c.txt")).toBe("a/b");
    expect(joinPath("a/b", "c.txt")).toBe("a/b/c.txt");
  });
});
