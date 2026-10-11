import { readFileSync } from "node:fs";
import { join } from "node:path";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";

const repoRoot = fileURLToPath(new URL("../../../", import.meta.url));
const pkg = JSON.parse(readFileSync(join(repoRoot, "package.json"), "utf8")) as {
  dependencies: Record<string, string>;
};

const deps = pkg.dependencies;

/**
 * xterm 全家必须原子升级。
 *
 * `@xterm/xterm` 与它的 7 个 addon 之间是**强 ABI 契约**：addon 直接读
 * core 的内部结构，版本错配不会崩，只会让终端渲染错乱（光标错位 / 颜色
 * 丢失 / 输入回显异常）。仓库里曾经出现过 `@xterm/addon-webgl` 停在
 * `.291` 而其余停在 `.292` 的状态 —— 那是一个**没有任何现有测试能发现**
 * 的缺陷。
 */
describe("xterm addon versions", () => {
  const xtermPackages = Object.keys(deps).filter((name) => name.startsWith("@xterm/"));

  it("declares at least the core plus its addons", () => {
    expect(xtermPackages).toContain("@xterm/xterm");
    expect(xtermPackages.length).toBeGreaterThan(1);
  });

  it("pins every @xterm package to the same build", () => {
    const builds = new Map<string, string[]>();
    for (const name of xtermPackages) {
      const match = /^([\w.]+)-beta\.(\d+)$/.exec(deps[name]);
      expect(match, `${name}@${deps[name]} is not a pinned beta build`).not.toBeNull();
      const build = match![2];
      builds.set(build, [...(builds.get(build) ?? []), name]);
    }
    expect(
      [...builds.entries()],
      "mixed @xterm builds will silently break the addon/core ABI contract",
    ).toHaveLength(1);
  });

  it("pins exact versions rather than ranges", () => {
    for (const name of xtermPackages) {
      expect(deps[name], `${name} must be pinned exactly`).not.toMatch(/[\^~><*]/);
    }
  });
});
