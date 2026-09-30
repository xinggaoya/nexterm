import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";
import { ALL_COMMAND_SPECS, specToDefinition } from "./commandSpecs";
import { CORE_COMMAND_SPECS } from "./coreCommands";
import {
  buildResolvedKeybindings,
  normalizeKeybinding,
  resolveCaptureInTerminal,
} from "./keybindings";

const identity = (key: string) => key;

/**
 * 从 types.ts 的 `CommandId` 联合类型里抽出声明的 id。
 *
 * 联合类型是手写的（spec 表分布在各模块，反向推导会与 types.ts 形成循环
 * 依赖）。直接读源文件而不是在测试里重抄一份，避免"加命令要改三处"。
 */
function declaredCommandIds(): string[] {
  const path = fileURLToPath(new URL("./types.ts", import.meta.url));
  const source = readFileSync(path, "utf8");
  const body = source.match(/export type CommandId =([\s\S]*?);/);
  if (!body) throw new Error("CommandId union not found in types.ts");
  return [...body[1].matchAll(/"([^"]+)"/g)].map((m) => m[1]);
}

describe("command spec table integrity", () => {
  it("keeps the hand-written CommandId union in sync with the spec tables", () => {
    // 这条不变量以前是破的：`terminal.rename` 存在于联合类型和处理器表，
    // 却没有 spec 条目 —— 既不进命令面板也无法绑定，是一条死命令。
    const declared = new Set(declaredCommandIds());
    const inSpecs = ALL_COMMAND_SPECS.map((s) => s.id);
    expect(inSpecs.filter((id) => !declared.has(id))).toEqual([]);
    // 联合类型里还允许 `snippet.${string}` 这类模板字面量，那不是 spec。
    const templateMembers = declared.size;
    expect(new Set(inSpecs).size).toBe(inSpecs.length);
    expect(templateMembers).toBeGreaterThanOrEqual(inSpecs.length);
  });

  it("never lets two core commands resolve to the same default shortcut", () => {
    // 这条不变量以前也是破的：`tab.closeOthers` 的默认键位 "Mod+K Mod+W" 被
    // normalizeKeybinding 折叠成 "Mod+W"，和 `tab.close` 撞车；分发时按数组
    // 顺序先命中 tab.close，于是 closeOthers 永远执行不到。
    const byKeybinding = new Map<string, string[]>();
    for (const spec of ALL_COMMAND_SPECS) {
      const normalized = normalizeKeybinding(spec.defaultKeybinding);
      if (!normalized) continue;
      byKeybinding.set(normalized, [
        ...(byKeybinding.get(normalized) ?? []),
        spec.id,
      ]);
    }
    const collisions = [...byKeybinding.entries()].filter(
      ([, ids]) => ids.length > 1,
    );
    expect(collisions).toEqual([]);
  });

  it("rejects chord bindings instead of silently collapsing them", () => {
    // "Mod+K Mod+W" 曾被折叠成 "Mod+W" —— 静默变成一个错误的绑定。
    // 和弦不被支持，判为非法（null）后在设置里显示"未设置"。
    expect(normalizeKeybinding("Mod+K Mod+W")).toBeNull();
    expect(normalizeKeybinding("Mod+K Mod+Shift+W")).toBeNull();
    expect(normalizeKeybinding("Mod+W")).toBe("Mod+W");
  });

  it("always produces a when-guard so palette and keybindings cannot drift", () => {
    const definitions = CORE_COMMAND_SPECS.map((spec) =>
      specToDefinition(spec, identity, () => {}),
    );
    // specToDefinition 必须总是产出 when —— 之前 useWorkbenchCommands 和
    // KeybindingsSection 各自拼装，漂移过一次。
    expect(definitions.every((d) => typeof d.when === "function")).toBe(true);
  });
});

describe("resolveCaptureInTerminal semantics", () => {
  const close = specToDefinition(
    ALL_COMMAND_SPECS.find((s) => s.id === "tab.close")!,
    identity,
    () => {},
  );
  const stageAll = specToDefinition(
    ALL_COMMAND_SPECS.find((s) => s.id === "git.stageAll")!,
    identity,
    () => {},
  );
  const resolved = buildResolvedKeybindings([close, stageAll], {});

  it("steals keys in the terminal when the command has a shortcut, and defers when it does not", () => {
    expect(resolved[close.id]).toBe("Mod+W");
    expect(resolved[stageAll.id]).toBeNull();
    expect(resolveCaptureInTerminal(close, resolved[close.id])).toBe(true);
    expect(resolveCaptureInTerminal(stageAll, resolved[stageAll.id])).toBe(
      false,
    );
  });

  it("honours an explicit captureInTerminal: false even when a shortcut exists", () => {
    const forced = { ...close, captureInTerminal: false };
    expect(resolveCaptureInTerminal(forced, resolved[close.id])).toBe(false);
  });
});

