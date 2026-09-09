import { describe, expect, it } from "vitest";

import {
  clampEditorFontSize,
  clampSidePanelWidth,
  clampTabFixedWidth,
  clampTerminalFontSize,
  clampTerminalFontWeight,
  clampTerminalLetterSpacing,
  clampTerminalScrollback,
  DEFAULT_PREFERENCES,
  PREF_SPECS,
  type PrefKey,
  type Preferences,
} from "./store";

describe("PREF_SPECS 表", () => {
  it("覆盖 DEFAULT_PREFERENCES 的每一个偏好键（新偏好必须注册 spec）", () => {
    const specKeys = Object.keys(PREF_SPECS).sort();
    const defaultKeys = Object.keys(DEFAULT_PREFERENCES).sort();
    expect(specKeys).toEqual(defaultKeys);
  });

  it("默认值读取（raw 缺失）返回 DEFAULT_PREFERENCES", () => {
    for (const key of Object.keys(PREF_SPECS) as PrefKey[]) {
      const spec = PREF_SPECS[key] as {
        read: (raw: unknown) => unknown;
      };
      const fallback = spec.read(undefined);
      expect(fallback).toEqual(DEFAULT_PREFERENCES[key]);
    }
  });

  it("sanitize 幂等：sanitize 后的值再次 sanitize 不变", () => {
    for (const key of Object.keys(PREF_SPECS) as PrefKey[]) {
      const spec = PREF_SPECS[key] as {
        sanitize?: (value: unknown) => unknown;
      };
      if (!spec.sanitize) continue;
      const once = spec.sanitize(DEFAULT_PREFERENCES[key]);
      const twice = spec.sanitize(once);
      expect(twice).toEqual(once);
    }
  });
});

describe("数值 clamp", () => {
  it("terminalScrollback 钳制到 [200, 50000]", () => {
    expect(clampTerminalScrollback(1)).toBe(200);
    expect(clampTerminalScrollback(999_999)).toBe(50_000);
    expect(clampTerminalScrollback(2000)).toBe(2000);
    expect(clampTerminalScrollback(Number.NaN)).toBe(2000);
  });

  it("sidePanelWidth 钳制到 [240, 520] 并取整", () => {
    expect(clampSidePanelWidth(1)).toBe(240);
    expect(clampSidePanelWidth(9999.4)).toBe(520);
    expect(clampSidePanelWidth(375.6)).toBe(376);
  });

  it("tabFixedWidth 按步长 4 取整并钳制", () => {
    expect(clampTabFixedWidth(1)).toBe(80);
    expect(clampTabFixedWidth(999)).toBe(240);
    expect(clampTabFixedWidth(162)).toBe(164); // 162 恰在 160/164 中点，Math.round half-up
    expect(clampTabFixedWidth(Number.NaN)).toBe(160);
  });

  it("editorFontSize / terminalFontSize 钳制", () => {
    expect(clampEditorFontSize(1)).toBe(10);
    expect(clampEditorFontSize(99)).toBe(24);
    expect(clampTerminalFontSize(1)).toBe(8);
    expect(clampTerminalFontSize(99)).toBe(32);
  });

  it("字重钳制到 100 的倍数", () => {
    expect(clampTerminalFontWeight(450)).toBe(500); // 450 恰在 400/500 中点，Math.round half-up
    expect(clampTerminalFontWeight(999)).toBe(900);
    expect(clampTerminalFontWeight(Number.NaN)).toBe(400);
  });

  it("字距钳制到 [-10, 10]", () => {
    expect(clampTerminalLetterSpacing(-99)).toBe(-10);
    expect(clampTerminalLetterSpacing(99)).toBe(10);
    expect(clampTerminalLetterSpacing(Number.NaN)).toBe(0);
  });
});

describe("spec read 行为", () => {
  it("corrupt 值回落默认而不是透传（关键 clamp 类偏好）", () => {
    const scrollback = PREF_SPECS.terminalScrollback;
    expect(scrollback.read(1234)).toBe(1234);
    expect(scrollback.read("1200" as unknown)).toBe(2000);
    expect(scrollback.read(null)).toBe(DEFAULT_PREFERENCES.terminalScrollback);

    const width = PREF_SPECS.sourceControlPanelWidth;
    expect(width.read("999" as unknown)).toBe(320);
  });

  it("showHidden 旧键 showHiddenDirectories 由 legacyKey 处理", () => {
    expect(PREF_SPECS.showHidden.legacyKey).toBe("showHiddenDirectories");
  });
});

type PreferencesShape = Preferences;
describe("Preferences 类型形状（编译期契约的运行时抽样）", () => {
  it("默认值类型抽样", () => {
    const sample: PreferencesShape = {
      ...DEFAULT_PREFERENCES,
    };
    expect(typeof sample.terminalScrollback).toBe("number");
    expect(sample.leftSidebar.activity).toBe("sourceControl");
    expect(sample.panelVisibility.explorer).toBe(true);
  });
});
