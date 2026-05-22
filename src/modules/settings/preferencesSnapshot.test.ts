import { describe, expect, it } from "vitest";
import {
  patchPreferencesSnapshot,
  readPreferencesSnapshot,
  replacePreferencesSnapshot,
} from "./preferencesSnapshot";
import { DEFAULT_PREFERENCES } from "./store";

describe("preferences snapshot", () => {
  it("starts from default preferences", () => {
    replacePreferencesSnapshot(DEFAULT_PREFERENCES);

    expect(readPreferencesSnapshot().terminalFontSize).toBe(
      DEFAULT_PREFERENCES.terminalFontSize,
    );
    expect(readPreferencesSnapshot().theme).toBe(DEFAULT_PREFERENCES.theme);
    expect(readPreferencesSnapshot().language).toBe("system");
    expect(readPreferencesSnapshot().fileOpenMode).toBe("preview");
  });

  it("replaces the whole snapshot without keeping caller object identity", () => {
    const next = { ...DEFAULT_PREFERENCES, terminalFontSize: 18 };

    replacePreferencesSnapshot(next);
    next.terminalFontSize = 22;

    expect(readPreferencesSnapshot().terminalFontSize).toBe(18);
  });

  it("patches individual preferences for cross-store synchronization", () => {
    replacePreferencesSnapshot(DEFAULT_PREFERENCES);
    patchPreferencesSnapshot("terminalFontFamily", "Fira Code");
    patchPreferencesSnapshot("fileOpenMode", "pinned");
    patchPreferencesSnapshot("language", "zh-CN");

    expect(readPreferencesSnapshot().terminalFontFamily).toBe("Fira Code");
    expect(readPreferencesSnapshot().fileOpenMode).toBe("pinned");
    expect(readPreferencesSnapshot().language).toBe("zh-CN");
  });
});
