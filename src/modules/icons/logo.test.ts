import { describe, expect, it } from "vitest";
import { fileIconUrl } from "./fileIcon";
import {
  languageIconUrl,
  languageIconUrlForPath,
  logoIconUrl,
  programIconUrl,
  shellIconUrl,
} from "./logo";

describe("icons module · logoIconUrl", () => {
  it("resolves a brand mark by its icon name", () => {
    const tauri = logoIconUrl("tauri");

    expect(tauri.startsWith("data:image/svg+xml")).toBe(true);
    expect(tauri).not.toBe(fileIconUrl("__no_such_file__"));
  });

  it("returns an empty string for an unknown icon name", () => {
    expect(logoIconUrl("__definitely_not_an_icon__")).toBe("");
    expect(logoIconUrl("")).toBe("");
  });
});

describe("icons module · languageIconUrl", () => {
  it("maps a language id to its language mark", () => {
    const rust = languageIconUrl("rust");
    const typescript = languageIconUrl("typescript");

    expect(rust.startsWith("data:image/svg+xml")).toBe(true);
    expect(rust).not.toBe(typescript);
  });

  it("returns an empty string for an unknown language id", () => {
    expect(languageIconUrl("__not_a_language__")).toBe("");
  });

  it("is case insensitive", () => {
    expect(languageIconUrl("RUST")).toBe(languageIconUrl("rust"));
  });
});

describe("icons module · languageIconUrlForPath", () => {
  it("resolves a file to the language mark of its extension", () => {
    expect(languageIconUrlForPath("main.rs")).toBe(languageIconUrl("rust"));
    expect(languageIconUrlForPath("src/app/main.rs")).toBe(
      languageIconUrl("rust"),
    );
    expect(languageIconUrlForPath("index.tsx")).toBe(
      languageIconUrl("typescriptreact"),
    );
  });

  it("falls back to the file type icon for extension-less special files", () => {
    // Dockerfile / Makefile 没有扩展名，靠文件名映射命中具体图标。
    const dockerfile = languageIconUrlForPath("Dockerfile");
    expect(dockerfile.startsWith("data:image/svg+xml")).toBe(true);
    expect(dockerfile).toBe(fileIconUrl("Dockerfile"));
    expect(dockerfile).not.toBe(fileIconUrl("__no_such_file__"));
  });

  it("falls back to the generic file icon for unknown files", () => {
    expect(languageIconUrlForPath("__no_such_file__")).toBe(
      fileIconUrl("__no_such_file__"),
    );
  });
});

describe("icons module · programIconUrl", () => {
  it("resolves a program name to its mark", () => {
    expect(programIconUrl("npm")).toBe(logoIconUrl("npm"));
    expect(programIconUrl("cargo")).toBe(logoIconUrl("cargo"));
  });

  it("only looks at the first token of a command line", () => {
    expect(programIconUrl("npm run dev")).toBe(logoIconUrl("npm"));
  });

  it("resolves an executable path to its mark", () => {
    expect(programIconUrl("/usr/bin/vim")).toBe(logoIconUrl("vim"));
    expect(programIconUrl("C:\\Program Files\\Git\\bin\\bash.exe")).toBe(
      logoIconUrl("bash"),
    );
  });

  it("returns an empty string for an unknown program", () => {
    expect(programIconUrl("some-random-binary")).toBe("");
    expect(programIconUrl("")).toBe("");
  });
});

describe("icons module · shellIconUrl", () => {
  it("maps a shell profile id to its mark", () => {
    expect(shellIconUrl("pwsh", "windows")).toBe(logoIconUrl("powershell"));
    expect(shellIconUrl("powershell", "windows")).toBe(
      logoIconUrl("powershell"),
    );
    expect(shellIconUrl("git-bash", "windows")).toBe(logoIconUrl("bash"));
    expect(shellIconUrl("bash", "unix")).toBe(logoIconUrl("bash"));
  });

  it("treats auto as PowerShell on Windows", () => {
    // Windows 后端默认顺序是 pwsh → Windows PowerShell → CMD，前两者同族。
    expect(shellIconUrl("auto", "windows")).toBe(logoIconUrl("powershell"));
  });

  it("cannot guess the login shell on unix", () => {
    expect(shellIconUrl("auto", "unix")).toBe("");
  });

  it("returns an empty string for shells without a mark", () => {
    expect(shellIconUrl("cmd", "windows")).toBe("");
    expect(shellIconUrl("zsh", "unix")).toBe("");
    expect(shellIconUrl("", "windows")).toBe("");
  });
});
