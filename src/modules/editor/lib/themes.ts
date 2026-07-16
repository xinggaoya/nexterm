import * as monaco from "monaco-editor";
import githubDark from "monaco-themes/themes/GitHub Dark.json";
import githubLight from "monaco-themes/themes/GitHub Light.json";
import xcodeDark from "monaco-themes/themes/Xcode_Dark.json";
import xcodeLight from "monaco-themes/themes/Xcode_default.json";

type ThemeData = monaco.editor.IStandaloneThemeData;

const SHARED_DARK_BG = "#1e1f22";
const SHARED_LIGHT_BG = "#fbfbfb";

function darkBase(
  name: string,
  data: Partial<ThemeData>,
): ThemeData {
  return {
    base: "vs-dark",
    inherit: true,
    rules: [],
    colors: {
      "editor.background": SHARED_DARK_BG,
      "editor.foreground": "#e3e3e3",
      "editorLineNumber.foreground": "#5a5d63",
      "editorLineNumber.activeForeground": "#cdd2da",
      "editorCursor.foreground": "#cdd2da",
      "editor.selectionBackground": "#3d4150",
      "editor.lineHighlightBackground": "#232428",
      "editorGutter.background": SHARED_DARK_BG,
      "editorWidget.background": "#26272b",
      "editorWidget.border": "#3a3c42",
      "editorSuggestWidget.background": "#26272b",
      "editorSuggestWidget.border": "#3a3c42",
      "editorHoverWidget.background": "#26272b",
      "editorHoverWidget.border": "#3a3c42",
      "scrollbarSlider.background": "#4a4c5288",
      "scrollbarSlider.hoverBackground": "#5a5c6288",
      "scrollbarSlider.activeBackground": "#6a6c7288",
      ...(data.colors ?? {}),
    },
    ...data,
  };
}

function lightBase(
  name: string,
  data: Partial<ThemeData>,
): ThemeData {
  return {
    base: "vs",
    inherit: true,
    rules: [],
    colors: {
      "editor.background": SHARED_LIGHT_BG,
      "editor.foreground": "#1f2328",
      "editorLineNumber.foreground": "#9da1a8",
      "editorLineNumber.activeForeground": "#1f2328",
      "editorCursor.foreground": "#1f2328",
      "editor.selectionBackground": "#b6d3fb7a",
      "editor.lineHighlightBackground": "#f1f3f5",
      "editorGutter.background": SHARED_LIGHT_BG,
      "editorWidget.background": "#ffffff",
      "editorWidget.border": "#d8dde3",
      "editorSuggestWidget.background": "#ffffff",
      "editorSuggestWidget.border": "#d8dde3",
      "editorHoverWidget.background": "#ffffff",
      "editorHoverWidget.border": "#d8dde3",
      "scrollbarSlider.background": "#9da1a833",
      "scrollbarSlider.hoverBackground": "#6a737d55",
      "scrollbarSlider.activeBackground": "#6a737d77",
      ...(data.colors ?? {}),
    },
    ...data,
  };
}

const atomone: ThemeData = darkBase("atomone", {
  rules: [
    { token: "comment", foreground: "5c6370", fontStyle: "italic" },
    { token: "keyword", foreground: "c678dd" },
    { token: "string", foreground: "98c379" },
    { token: "number", foreground: "d19a66" },
    { token: "type", foreground: "e5c07b" },
    { token: "function", foreground: "61afef" },
    { token: "variable", foreground: "e06c75" },
    { token: "tag", foreground: "e06c75" },
  ],
});

const aura: ThemeData = darkBase("aura", {
  rules: [
    { token: "comment", foreground: "6c6f93", fontStyle: "italic" },
    { token: "keyword", foreground: "a882ff" },
    { token: "string", foreground: "90d5b3" },
    { token: "number", foreground: "ff9944" },
    { token: "type", foreground: "5ccfe6" },
    { token: "function", foreground: "7eb7ff" },
    { token: "variable", foreground: "edecee" },
    { token: "tag", foreground: "f38c79" },
  ],
});

const copilot: ThemeData = darkBase("copilot", {
  rules: [
    { token: "comment", foreground: "8b949e", fontStyle: "italic" },
    { token: "keyword", foreground: "ff7b72" },
    { token: "string", foreground: "a5d6ff" },
    { token: "number", foreground: "79c0ff" },
    { token: "type", foreground: "ffa657" },
    { token: "function", foreground: "d2a8ff" },
    { token: "variable", foreground: "c9d1d9" },
    { token: "tag", foreground: "7ee787" },
  ],
});

const nord: ThemeData = darkBase("nord", {
  rules: [
    { token: "comment", foreground: "616e88", fontStyle: "italic" },
    { token: "keyword", foreground: "81a1c1" },
    { token: "string", foreground: "a3be8c" },
    { token: "number", foreground: "b48ead" },
    { token: "type", foreground: "8fbcbb" },
    { token: "function", foreground: "88c0d0" },
    { token: "variable", foreground: "d8dee9" },
    { token: "tag", foreground: "bf616a" },
  ],
  colors: {
    "editor.background": "#2e3440",
    "editor.foreground": "#d8dee9",
    "editorLineNumber.foreground": "#4c566a",
    "editorCursor.foreground": "#d8dee9",
    "editor.selectionBackground": "#434c5e",
    "editor.lineHighlightBackground": "#3b4252",
    "editorGutter.background": "#2e3440",
  },
});

const tokyoNight: ThemeData = darkBase("tokyo-night", {
  rules: [
    { token: "comment", foreground: "565f89", fontStyle: "italic" },
    { token: "keyword", foreground: "bb9af7" },
    { token: "string", foreground: "9ece6a" },
    { token: "number", foreground: "ff9e64" },
    { token: "type", foreground: "7dcfff" },
    { token: "function", foreground: "7aa2f7" },
    { token: "variable", foreground: "c0caf5" },
    { token: "tag", foreground: "f7768e" },
  ],
  colors: {
    "editor.background": "#1a1b26",
    "editor.foreground": "#c0caf5",
    "editorLineNumber.foreground": "#3b4261",
    "editorCursor.foreground": "#c0caf5",
    "editor.selectionBackground": "#283457",
    "editor.lineHighlightBackground": "#1f2335",
    "editorGutter.background": "#1a1b26",
  },
});

const THEME_DATA: Record<string, ThemeData> = {
  atomone,
  aura,
  copilot,
  "github-dark": githubDark as ThemeData,
  "github-light": githubLight as ThemeData,
  nord,
  "tokyo-night": tokyoNight,
  "xcode-dark": xcodeDark as ThemeData,
  "xcode-light": xcodeLight as ThemeData,
};

let registered = false;

export function registerMonacoThemes(monaco: typeof import("monaco-editor")): void {
  if (registered) return;
  registered = true;
  for (const [id, data] of Object.entries(THEME_DATA)) {
    monaco.editor.defineTheme(id, data);
  }
}

export const MONACO_THEME_IDS = Object.keys(THEME_DATA);

export function getMonacoThemeId(themeId: string): string {
  return themeId in THEME_DATA ? themeId : "atomone";
}
