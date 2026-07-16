import * as monaco from "monaco-editor";

// monaco-themes 包的 themes/*.json 是 JSON 主题文件。Vite/esbuild 通过 alias 解析
// monaco-themes 到本地 stub；这里直接以 unknown 的方式导入内置主题的 JSON 内容，
// 不再依赖 monaco-themes 包的 .json 文件。GitHub / Xcode 主题用我们手写的 token 规则。

type ThemeData = monaco.editor.IStandaloneThemeData;

const SHARED_DARK_BG = "#1e1f22";
const SHARED_LIGHT_BG = "#fbfbfb";

function darkBase(_name: string, data: Partial<ThemeData>): ThemeData {
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

function lightBase(_name: string, data: Partial<ThemeData>): ThemeData {
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

const githubDark: ThemeData = darkBase("github-dark", {
  rules: [
    { token: "comment", foreground: "8b949e", fontStyle: "italic" },
    { token: "keyword", foreground: "ff7b72" },
    { token: "string", foreground: "a5d6ff" },
    { token: "number", foreground: "79c0ff" },
    { token: "type", foreground: "ffa657" },
    { token: "function", foreground: "d2a8ff" },
    { token: "variable", foreground: "c9d1d9" },
    { token: "tag", foreground: "7ee787" },
    { token: "delimiter", foreground: "c9d1d9" },
    { token: "regexp", foreground: "f97583" },
  ],
  colors: {
    "editor.background": "#0d1117",
    "editor.foreground": "#c9d1d9",
    "editorLineNumber.foreground": "#484f58",
    "editorCursor.foreground": "#c9d1d9",
    "editor.selectionBackground": "#264f78",
    "editor.lineHighlightBackground": "#161b22",
    "editorGutter.background": "#0d1117",
  },
});

const githubLight: ThemeData = lightBase("github-light", {
  rules: [
    { token: "comment", foreground: "6a737d", fontStyle: "italic" },
    { token: "keyword", foreground: "d73a49" },
    { token: "string", foreground: "032f62" },
    { token: "number", foreground: "005cc5" },
    { token: "type", foreground: "6f42c1" },
    { token: "function", foreground: "6f42c1" },
    { token: "variable", foreground: "e36209" },
    { token: "tag", foreground: "22863a" },
  ],
  colors: {
    "editor.background": "#ffffff",
    "editor.foreground": "#24292e",
    "editorLineNumber.foreground": "#1b1f23",
    "editorCursor.foreground": "#24292e",
    "editor.selectionBackground": "#c8e1ff",
    "editor.lineHighlightBackground": "#f6f8fa",
    "editorGutter.background": "#ffffff",
  },
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

const xcodeDark: ThemeData = darkBase("xcode-dark", {
  rules: [
    { token: "comment", foreground: "7f8c98", fontStyle: "italic" },
    { token: "keyword", foreground: "c455e5" },
    { token: "string", foreground: "d44950" },
    { token: "number", foreground: "3ec1f3" },
    { token: "type", foreground: "21ab9d" },
    { token: "function", foreground: "3f6f74" },
    { token: "variable", foreground: "d0d0d0" },
  ],
  colors: {
    "editor.background": "#292a30",
    "editor.foreground": "#d0d0d0",
  },
});

const xcodeLight: ThemeData = lightBase("xcode-light", {
  rules: [
    { token: "comment", foreground: "007400", fontStyle: "italic" },
    { token: "keyword", foreground: "aa0d91" },
    { token: "string", foreground: "c41a16" },
    { token: "number", foreground: "1c00cf" },
    { token: "type", foreground: "5c2696" },
    { token: "function", foreground: "3f6f74" },
    { token: "variable", foreground: "000000" },
  ],
  colors: {
    "editor.background": "#ffffff",
    "editor.foreground": "#000000",
  },
});

const THEME_DATA: Record<string, ThemeData> = {
  atomone,
  aura,
  copilot,
  "github-dark": githubDark,
  "github-light": githubLight,
  nord,
  "tokyo-night": tokyoNight,
  "xcode-dark": xcodeDark,
  "xcode-light": xcodeLight,
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
