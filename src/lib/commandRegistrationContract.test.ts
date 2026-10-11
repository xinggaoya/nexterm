import { readFileSync } from "node:fs";
import { join } from "node:path";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";

const repoRoot = fileURLToPath(new URL("../../", import.meta.url));
const nativeSource = readFileSync(join(repoRoot, "src/lib/native.ts"), "utf8");
const libRs = readFileSync(join(repoRoot, "src-tauri/src/lib.rs"), "utf8");

function registeredCommands(): string[] {
  const body = libRs.match(/generate_handler!\[([\s\S]*?)\n\s*\]\)/)?.[1];
  if (!body) throw new Error("generate_handler! block not found in src-tauri/src/lib.rs");
  return [...body.matchAll(/^\s*([a-zA-Z0-9_:]+),/gm)]
    .map((match) => match[1].split("::").pop()!)
    // 命令注册被 cfg 包住时（release 下不编译 devtools）同样算已注册，
    // 但要把 cfg 行剥掉。
    .filter((name) => name !== "cfg");
}

function invokedCommands(): string[] {
  return [
    ...nativeSource.matchAll(/invoke(?:<[^>]*>)?\(\s*"([a-z0-9_]+)"/g),
  ].map((match) => match[1]);
}

/**
 * 有意不被前端包装的 Tauri 命令。
 *
 * 空列表 = 每个已注册命令都必须有前端出口。往这里加一条等于承认「这个
 * 命令是死代码或者功能没接完」——那两种都是缺陷，不该由本文件替它们背书。
 */
const NO_FRONTEND_BINDING: string[] = [];

describe("Tauri command registration contract", () => {
  it("every frontend invoke targets a registered command", () => {
    const registered = new Set(registeredCommands());
    const ghosts = [...new Set(invokedCommands())].filter((cmd) => !registered.has(cmd));
    expect(ghosts.sort()).toEqual([]);
  });

  it("every registered command has a frontend binding or an explicit exemption", () => {
    const invoked = new Set(invokedCommands());
    const orphans = registeredCommands()
      .filter((cmd) => !invoked.has(cmd))
      .filter((cmd) => !NO_FRONTEND_BINDING.includes(cmd))
      .sort();
    expect(orphans).toEqual([]);
  });

  it("has no duplicate command names in generate_handler!", () => {
    const names = registeredCommands();
    expect(names.length).toBe(new Set(names).size);
  });

  it("does not send the lsp server executable path over IPC", () => {
    // 安全不变量：`lsp_start` 只接受 language。让 webview 指定 command
    // 等于交出一个「以宿主权限执行任意程序」的接口。
    const startCall = nativeSource.match(
      /lspStart:[\s\S]{0,200}?invoke<[^>]*>\("lsp_start",\s*(\{[\s\S]*?\})\)/,
    );
    expect(startCall).not.toBeNull();
    expect(startCall![1]).toContain("language");
    expect(startCall![1]).not.toContain("command");
  });

  it("keeps the version identical across package.json / Cargo.toml / tauri.conf.json", () => {
    // AGENTS.md 要求三处同步，但之前只有 bundle identifier 有守护，
    // 版本号全靠人手。
    const pkg = JSON.parse(readFileSync(join(repoRoot, "package.json"), "utf8"));
    const cargo = readFileSync(join(repoRoot, "src-tauri/Cargo.toml"), "utf8");
    const tauri = JSON.parse(
      readFileSync(join(repoRoot, "src-tauri/tauri.conf.json"), "utf8"),
    );
    const cargoVersion = cargo.match(/^version = "([^"]+)"/m)?.[1];

    expect(cargoVersion).toBe(pkg.version);
    expect(tauri.version).toBe(pkg.version);
  });
});
