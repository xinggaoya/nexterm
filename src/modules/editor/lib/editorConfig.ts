import { detectMonoFontFamily } from "@/lib/fonts";
import type * as monaco from "monaco-editor";
import type { EditorThemeId } from "@/modules/settings/store";
import { getMonacoThemeId } from "./themes";

export type EditorPrefs = {
  editorTheme: EditorThemeId;
  editorFontSize: number;
  editorTabSize: number;
  editorWordWrap: boolean;
};

export function buildMonacoEditorOptions(
  prefs: EditorPrefs,
  languageId: string | null,
): monaco.editor.IStandaloneEditorConstructionOptions {
  return {
    automaticLayout: true,
    fontFamily: detectMonoFontFamily(),
    fontSize: prefs.editorFontSize,
    lineNumbers: "on",
    folding: true,
    bracketPairColorization: { enabled: true },
    autoClosingBrackets: "always",
    autoClosingQuotes: "always",
    tabSize: prefs.editorTabSize,
    wordWrap: prefs.editorWordWrap ? "on" : "off",
    minimap: { enabled: false },
    renderWhitespace: "none",
    scrollBeyondLastLine: false,
    smoothScrolling: true,
    fixedOverflowWidgets: true,
    renderLineHighlight: "all",
    roundedSelection: true,
    scrollbar: {
      verticalScrollbarSize: 10,
      horizontalScrollbarSize: 10,
      useShadows: false,
    },
    theme: getMonacoThemeId(prefs.editorTheme),
    language: languageId ?? undefined,
  };
}

export function buildMonacoDiffOptions(
  prefs: EditorPrefs,
): monaco.editor.IDiffEditorConstructionOptions {
  return {
    automaticLayout: true,
    enableSplitViewResizing: false,
    renderSideBySide: true,
    renderIndicators: true,
    ignoreTrimWhitespace: false,
    originalEditable: false,
    readOnly: true,
    fontFamily: detectMonoFontFamily(),
    fontSize: prefs.editorFontSize,
    minimap: { enabled: false },
    scrollBeyondLastLine: false,
    renderLineHighlight: "all",
  };
}
