import { readdirSync, readFileSync, statSync } from "node:fs";
import { join, relative } from "node:path";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";

const srcRoot = fileURLToPath(new URL("../../", import.meta.url));

/**
 * 偏好写入所有权边界。
 *
 * `preferencesPinia` 是中心 store，但 `preferencesSnapshot.ts` 是个**模块级
 * 单例**（不是 Pinia store）—— 任何模块都能 import 它，任何模块都能改它。
 * `preferencesSnapshot.test.ts` 里 `replacePreferencesSnapshot(next); next.x = …`
 * 的写法说明它已经被当成「被跨模块乱写」来打补丁了。
 *
 * 对比 `setupStoreBoundary.test.ts`：那个锁**形式**（setup vs options），
 * 这个锁**所有权**（谁能写中心偏好）。两者缺一不可。
 */

/** 允许 import preferencesSnapshot 的文件。改动必须是有意识的架构决定。 */
const SNAPSHOT_CONSUMERS: Record<string, true> = {
  "modules/settings/preferencesSnapshot.ts": true,
  "modules/settings/preferencesPinia.ts": true,
  // 测试自己构造快照来断言 hydrate 行为。
  "modules/settings/preferencesSnapshot.test.ts": true,
};

/**
 * 允许**写**中心偏好（`prefs.x = …` 或调用 setter）的文件。
 *
 * 设备能力探测（触屏滚轮）、窗口尺寸记忆这类「运行时事实回写」是合理的；
 * 其余每一项都应当收敛到 `preferencesPinia` 的单一入口。
 */
const ALLOWED_WRITERS: Record<string, true> = {
  "main.ts": true,
  "app/MainApp.vue": true,
  "app/shell/WorkspaceHost.vue": true,
  "app/shell/Canvas.vue": true,
  "lib/touchDevice.ts": true,
  "modules/settings/preferencesPinia.ts": true,
  "settings/sections/AboutSection.vue": true,
  "settings/sections/AppearanceSection.vue": true,
  "settings/sections/EditorSection.vue": true,
  "settings/sections/GeneralSection.vue": true,
  "settings/sections/KeybindingsSection.vue": true,
  "settings/sections/TerminalAppearanceSection.vue": true,
  "settings/sections/TerminalBehaviorSection.vue": true,
  "settings/sections/TerminalRendererSection.vue": true,
};

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
  .map((file) => ({
    file,
    rel: toPosix(relative(srcRoot, file)),
  }));

const consumers = sourceFiles.filter(
  ({ file }) =>
    !file.endsWith(".test.ts") &&
    /from\s+["'][^"']*preferencesSnapshot["']/.test(readFileSync(file, "utf8")),
);

describe("store ownership boundary", () => {
  it("only whitelisted modules import the preferences snapshot singleton", () => {
    const offenders = consumers
      .map(({ rel }) => rel)
      .filter((rel) => !(rel in SNAPSHOT_CONSUMERS));
    expect(offenders).toEqual([]);
  });

  it("writes the central preferences store only from allowed modules", () => {
    // `prefs.<字段> = ` / `prefs.<字段>++` 是直接写；setter 调用（`setXxx`）
    // 走的是 store 的显式入口，不算越界。
    const offenders = sourceFiles
      .filter(({ file }) => !file.endsWith(".test.ts"))
      .filter(({ rel }) => !(rel in ALLOWED_WRITERS))
      .filter(({ file }) =>
        /\bprefs\.[A-Za-z_$][\w$]*\s*(=[^=]|\+\+|--|\+=|-=)/.test(
          readFileSync(file, "utf8"),
        ),
      )
      .map(({ rel }) => rel);
    expect(offenders).toEqual([]);
  });

  it("does not let the writer list drift silently", () => {
    // 名单条目必须真的还存在于源码树里，否则删文件后名单会静默烂掉。
    const stale = Object.keys(ALLOWED_WRITERS).filter((rel) => {
      try {
        return !statSync(join(srcRoot, rel)).isFile();
      } catch {
        return true;
      }
    });
    expect(stale).toEqual([]);
  });
});
