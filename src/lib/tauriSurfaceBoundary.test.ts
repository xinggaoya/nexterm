import { readdirSync, readFileSync, statSync } from "node:fs";
import { join, relative } from "node:path";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";

const srcRoot = fileURLToPath(new URL("../", import.meta.url));

/**
 * Tauri 能力面边界。
 *
 * `nativeBoundary` 只守 `core`（invoke / Channel），`eventBoundary` 只守
 * `event`（listen / emit）。但 webview 直接触碰 Tauri 的地方远不止这两个
 * —— window / path / webviewWindow / 全部 `plugin-*` 的变更爆炸半径和
 * `invoke` 一样大，却一条约束都没有。
 *
 * 用**白名单**而不是黑名单：把「允许例外」变成一份显式、可 review、可 diff
 * 的清单，而不是让后来者去猜。（同 `setupStoreBoundary.test.ts` 的做法。）
 */
const TOLERATED: Record<string, true> = {
  // window 控制本身就是 per-window 的：收进 native 会让 native 同时持有
  // AppHandle 和窗口句柄，得不偿失。
  "app/MainApp.vue": true,
  "app/shell/TopBar.vue": true,
  "app/shell/useWindowDrag.ts": true,
  "app/useWindowChromeState.ts": true,
  "components/WindowControls.vue": true,
  "modules/workspace/workspaceWindow.ts": true,
  // 窗口关闭守卫需要 `getCurrentWindow().onCloseRequested`，与其它 window 消费方同类。
  "app/components/UnsavedCloseGuard.vue": true,
  // 一层薄封装：clipboard / notification / os / store。
  "lib/platform.ts": true,
  "lib/clipboard.ts": true,
  "lib/osNotifications.ts": true,
  "modules/settings/store.ts": true,
  // 「在文件管理器里显示」/「用外部浏览器打开」属于 OS 集成而非业务能力。
  "modules/explorer/lib/contextActions.ts": true,
  "modules/git-history/GitHistoryPane.vue": true,
  "modules/preview/PreviewAddressBar.vue": true,
  // 待收敛：path 只有 homeDir 一处使用。
  "app/useWorkspaceLifecycle.ts": true,
};

/**
 * 允许穿透的模块 specifier。其余一律收敛到 lib/native.ts。
 *
 * `plugin-process` / `plugin-updater` 只有 native.ts 在用（relaunch + check
 * update 属于「应用生命周期」，不是业务能力），它们被单独放行是因为它们是
 * native 自己的一部分，不构成绕过。
 */
const ALLOWED_SPECIFIERS = new Set([
  "@tauri-apps/api/core",
  "@tauri-apps/api/event",
  "@tauri-apps/plugin-process",
  "@tauri-apps/plugin-updater",
]);

function walk(dir: string): string[] {
  return readdirSync(dir).flatMap((entry) => {
    const full = join(dir, entry);
    return statSync(full).isDirectory() ? walk(full) : [full];
  });
}

function toPosix(path: string): string {
  return path.split(/[\\/]/).join("/");
}

const sourceFiles = walk(srcRoot)
  .filter((file) => /\.(ts|vue)$/.test(file))
  .filter((file) => !file.endsWith(".test.ts"))
  .map((file) => ({
    file,
    rel: toPosix(relative(srcRoot, file)),
  }));

describe("Tauri capability surface boundary", () => {
  it("keeps @tauri-apps imports inside native.ts and the tolerated wrappers", () => {
    const offenders = sourceFiles
      .filter(({ rel }) => rel !== "lib/native.ts")
      .filter(({ rel }) => !(rel in TOLERATED))
      .filter(({ file }) =>
        [...readFileSync(file, "utf8").matchAll(/from\s+["'](@tauri-apps\/[^"']+)["']/g)].some(
          (match) => !ALLOWED_SPECIFIERS.has(match[1]),
        ),
      )
      .map(({ rel }) => rel);
    expect(offenders).toEqual([]);
  });

  it("keeps the tolerate list in sync with reality", () => {
    // 每个容忍项都必须真的还 import 了 tauri，否则名单会悄悄烂掉。
    const stale = Object.keys(TOLERATED).filter((rel) => {
      const abs = join(srcRoot, rel);
      if (!existsSafe(abs)) return true;
      return !/@tauri-apps\//.test(readFileSync(abs, "utf8"));
    });
    expect(stale).toEqual([]);
  });

  it("does not let native.ts import anything outside the core/event surface", () => {
    const nativeSource = readFileSync(join(srcRoot, "lib/native.ts"), "utf8");
    const specifiers = [
      ...nativeSource.matchAll(/from\s+["'](@tauri-apps\/[^"']+)["']/g),
    ].map((match) => match[1]);
    expect(specifiers.filter((s) => !ALLOWED_SPECIFIERS.has(s))).toEqual([]);
  });
});

function existsSafe(path: string): boolean {
  try {
    return statSync(path).isFile();
  } catch {
    return false;
  }
}
