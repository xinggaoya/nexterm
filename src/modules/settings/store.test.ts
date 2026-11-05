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
  SIDE_PANEL_WIDTH_DEFAULT,
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

  it("停靠面板显隐偏好：默认可见；侧栏折叠偏好已随左栏下线", () => {
    // 侧栏已从壳层移除：偏好键必须一并下线，不能留下永不生效的孤儿开关。
    expect("sidebarCollapsed" in DEFAULT_PREFERENCES).toBe(false);
    expect("sidebarCollapsed" in PREF_SPECS).toBe(false);
  });
});

describe("双侧面板偏好", () => {
  it("左右两侧各自持有视图 / 显隐 / 宽度", () => {
    expect(DEFAULT_PREFERENCES.leftPanelView).toBe("explorer");
    expect(DEFAULT_PREFERENCES.leftPanelOpen).toBe(true);
    expect(DEFAULT_PREFERENCES.leftPanelWidth).toBe(SIDE_PANEL_WIDTH_DEFAULT);
    expect(DEFAULT_PREFERENCES.rightPanelView).toBe("changes");
    expect(DEFAULT_PREFERENCES.rightPanelOpen).toBe(true);
    expect(DEFAULT_PREFERENCES.rightPanelWidth).toBe(SIDE_PANEL_WIDTH_DEFAULT);

    expect(PREF_SPECS.leftPanelView.read(undefined)).toBe("explorer");
    expect(PREF_SPECS.leftPanelView.read("nope")).toBe("explorer");
    expect(PREF_SPECS.rightPanelView.read(undefined)).toBe("changes");
    expect(PREF_SPECS.leftPanelOpen.read(undefined)).toBe(true);
    expect(PREF_SPECS.leftPanelOpen.read(false)).toBe(false);
  });

  it("旧的单侧面板字段降级为右侧的 legacy 源（老用户不丢设置）", () => {
    expect(PREF_SPECS.rightPanelView.legacyKey).toBe("workspacePanelTab");
    expect(PREF_SPECS.rightPanelOpen.legacyKey).toBe("workspacePanelVisible");
    expect(PREF_SPECS.rightPanelWidth.legacyKey).toBe("explorerPanelWidth");
    // 旧键不再出现在 spec 表里（否则会与新键抢默认值）。
    expect("workspacePanelTab" in PREF_SPECS).toBe(false);
    expect("workspacePanelVisible" in PREF_SPECS).toBe(false);
    expect("explorerPanelWidth" in PREF_SPECS).toBe(false);
  });

  it("面板宽度沿用侧栏宽度的夹取规则", () => {
    // read 负责「磁盘上的任意 JSON → 合法值」，夹取发生在 sanitize（写盘前）。
    expect(PREF_SPECS.leftPanelWidth.read(99999)).toBe(99999);
    expect(PREF_SPECS.leftPanelWidth.sanitize?.(99999)).toBe(
      clampSidePanelWidth(99999),
    );
    expect(PREF_SPECS.rightPanelWidth.sanitize?.(-5)).toBe(
      clampSidePanelWidth(-5),
    );
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
