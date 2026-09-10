import type { FsDirEntry } from "@/lib/native";
import { LOCAL_WORKSPACE } from "@/modules/workspace/workspaceEnvSnapshot";
import { describe, expect, it } from "vitest";
import {
  filterPickerEntries,
  formatPickerSize,
  joinPickerPath,
  parentPickerPath,
  pickerEntryNavigable,
  resolvePickerConfirm,
  sortPickerEntries,
  splitPickerPath,
} from "./pickerService";

const wsl = { kind: "wsl" as const, distro: "Ubuntu" };

function entry(
  name: string,
  kind: FsDirEntry["kind"] = "file",
  size = 0,
): FsDirEntry {
  return { name, kind, size, mtime: 0 };
}

describe("splitPickerPath", () => {
  it("builds cumulative crumbs for WSL Linux paths", () => {
    expect(splitPickerPath("/home/dev", wsl)).toEqual([
      { label: "/", path: "/" },
      { label: "home", path: "/home" },
      { label: "dev", path: "/home/dev" },
    ]);
  });

  it("keeps the filesystem root as a single crumb", () => {
    expect(splitPickerPath("/", wsl)).toEqual([{ label: "/", path: "/" }]);
  });

  it("returns no crumbs for non-Linux paths under WSL", () => {
    expect(splitPickerPath("C:/Users", wsl)).toEqual([]);
  });

  it("builds drive-rooted crumbs for local Windows paths", () => {
    expect(splitPickerPath("C:/Users/foo", LOCAL_WORKSPACE)).toEqual([
      { label: "C:", path: "C:/" },
      { label: "Users", path: "C:/Users" },
      { label: "foo", path: "C:/Users/foo" },
    ]);
    expect(splitPickerPath("d:/", LOCAL_WORKSPACE)).toEqual([
      { label: "D:", path: "D:/" },
    ]);
  });
});

describe("parentPickerPath", () => {
  it("returns null at the WSL filesystem root", () => {
    expect(parentPickerPath("/", wsl)).toBeNull();
  });

  it("walks up WSL directories", () => {
    expect(parentPickerPath("/home", wsl)).toBe("/");
    expect(parentPickerPath("/home/dev/proj", wsl)).toBe("/home/dev");
  });

  it("stops at the drive root for local paths", () => {
    expect(parentPickerPath("C:/x", LOCAL_WORKSPACE)).toBe("C:/");
    expect(parentPickerPath("C:/", LOCAL_WORKSPACE)).toBeNull();
    expect(parentPickerPath("C:/Users/foo", LOCAL_WORKSPACE)).toBe("C:/Users");
  });
});

describe("joinPickerPath", () => {
  it("joins without duplicated separators", () => {
    expect(joinPickerPath("/", "home")).toBe("/home");
    expect(joinPickerPath("/home/", "dev")).toBe("/home/dev");
    expect(joinPickerPath("C:/", "repo")).toBe("C:/repo");
  });
});

describe("sortPickerEntries", () => {
  it("puts directories first, then symlinks, then files, alphabetical within group", () => {
    const sorted = sortPickerEntries([
      entry("zebra.txt"),
      entry("src", "dir"),
      entry("link", "symlink"),
      entry("alpha", "dir"),
    ]);
    expect(sorted.map((item) => item.name)).toEqual([
      "alpha",
      "src",
      "link",
      "zebra.txt",
    ]);
  });
});

describe("filterPickerEntries", () => {
  it("filters case-insensitively by name substring", () => {
    const entries = [entry("Readme.md"), entry("src", "dir")];
    expect(
      filterPickerEntries(entries, "READ").map((item) => item.name),
    ).toEqual(["Readme.md"]);
    expect(filterPickerEntries(entries, "  ")).toHaveLength(2);
  });
});

describe("pickerEntryNavigable", () => {
  it("treats dirs and symlinks as navigable", () => {
    expect(pickerEntryNavigable(entry("d", "dir"))).toBe(true);
    expect(pickerEntryNavigable(entry("l", "symlink"))).toBe(true);
    expect(pickerEntryNavigable(entry("f"))).toBe(false);
  });
});

describe("resolvePickerConfirm", () => {
  const dir = entry("proj", "dir");
  const file = entry("main.rs");

  it("directory mode prefers the selected folder, else the current folder", () => {
    expect(resolvePickerConfirm("directory", "/home/dev", dir, "")).toEqual({
      ok: true,
      path: "/home/dev/proj",
    });
    expect(resolvePickerConfirm("directory", "/home/dev", file, "")).toEqual({
      ok: true,
      path: "/home/dev",
    });
    expect(resolvePickerConfirm("directory", "/home/dev", null, "")).toEqual({
      ok: true,
      path: "/home/dev",
    });
  });

  it("file mode prefers the typed name, then the selected file", () => {
    expect(resolvePickerConfirm("file", "/home/dev", null, " new.txt ")).toEqual({
      ok: true,
      path: "/home/dev/new.txt",
    });
    expect(resolvePickerConfirm("file", "/home/dev", file, "")).toEqual({
      ok: true,
      path: "/home/dev/main.rs",
    });
  });

  it("file mode cannot confirm with nothing or a folder selected", () => {
    expect(resolvePickerConfirm("file", "/home/dev", null, "")).toEqual({
      ok: false,
    });
    expect(resolvePickerConfirm("file", "/home/dev", dir, "")).toEqual({
      ok: false,
    });
  });

  it("never confirms without a current folder", () => {
    expect(resolvePickerConfirm("directory", "", null, "")).toEqual({
      ok: false,
    });
  });
});

describe("formatPickerSize", () => {
  it("formats byte and rounded binary units", () => {
    expect(formatPickerSize(0)).toBe("0 B");
    expect(formatPickerSize(512)).toBe("512 B");
    expect(formatPickerSize(2048)).toBe("2.0 KB");
    expect(formatPickerSize(5 * 1024 * 1024)).toBe("5.0 MB");
  });
});
