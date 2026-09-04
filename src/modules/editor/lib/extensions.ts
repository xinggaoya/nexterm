import { detectMonoFontFamily } from "@/lib/fonts";
import { indentUnit } from "@codemirror/language";
import { lintGutter } from "@codemirror/lint";
import { search } from "@codemirror/search";
import { Compartment, EditorState, type Extension } from "@codemirror/state";
import { EditorView } from "@codemirror/view";
import type { EditorThemeId } from "@/modules/settings/store";

/** 编辑器可从设置面板实时变更的偏好子集。 */
export type EditorPrefs = {
  editorTheme: EditorThemeId;
  editorFontSize: number;
  editorTabSize: number;
  editorWordWrap: boolean;
};

// Compartment 允许在销毁实例的前提下热更新某一组扩展,
// 用于主题 / 字号 / 缩进 / 换行 / Vim / 语言的设置变更。
export const languageCompartment = new Compartment();
export const themeCompartment = new Compartment();
export const optionsCompartment = new Compartment();
export const vimCompartment = new Compartment();

/** 与编辑器核心无关的共享外观:透明背景、等宽字体基线、搜索面板、lint 槽位。 */
export function buildSharedExtensions(): Extension[] {
  return [
    search({ top: true }),
    lintGutter(),
    EditorView.theme({
      "&, &.cm-editor, &.cm-editor.cm-focused": {
        backgroundColor: "transparent !important",
        color: "var(--foreground)",
        outline: "none",
        padding: "8px",
      },
      "&": { height: "100%" },
      ".cm-scroller": { overflow: "auto" },
      ".cm-content": {
        caretColor: "var(--foreground)",
        backgroundColor: "transparent !important",
        minWidth: "max-content",
      },
      ".cm-line": { whiteSpace: "pre" },
      ".cm-gutters": {
        backgroundColor: "transparent !important",
        color: "var(--muted-foreground)",
      },
      ".cm-gutter": { backgroundColor: "transparent !important" },
      ".cm-gutter-lint": { width: "0px" },
      ".cm-lineNumbers .cm-gutterElement": {
        opacity: "0.55",
        userSelect: "none",
      },
      ".cm-foldGutter": { width: "10px" },
      ".cm-foldGutter .cm-gutterElement": {
        color: "var(--muted-foreground)",
        opacity: "0.5",
      },
      ".cm-activeLine": {
        borderTopRightRadius: "5px",
        borderBottomRightRadius: "5px",
        backgroundColor:
          "color-mix(in srgb, var(--foreground) 4%, transparent)",
      },
      ".cm-lineNumbers .cm-activeLineGutter": {
        borderTopLeftRadius: "5px",
        borderBottomLeftRadius: "5px",
        userSelect: "none",
      },
      ".cm-cursor, .cm-dropCursor": {
        borderLeftColor: "var(--foreground)",
      },
      // Vim normal-mode 块状光标 — 前景色半透明,不带玫瑰色。
      ".cm-fat-cursor": {
        background:
          "color-mix(in srgb, var(--foreground) 35%, transparent) !important",
        outline:
          "1px solid color-mix(in srgb, var(--foreground) 55%, transparent) !important",
        color: "var(--foreground) !important",
      },
      "&:not(.cm-focused) .cm-fat-cursor": {
        background: "transparent !important",
        outline:
          "1px solid color-mix(in srgb, var(--foreground) 35%, transparent) !important",
      },
      ".cm-selectionBackground, &.cm-focused .cm-selectionBackground, ::selection":
        {
          backgroundColor:
            "color-mix(in srgb, var(--foreground) 18%, transparent) !important",
        },
      ".cm-panels": {
        backgroundColor: "var(--popover)",
        color: "var(--popover-foreground)",
        borderColor: "var(--border)",
      },
      // Vim 模式状态面板(vim({ status: true }) 挂载)。
      ".cm-vim-panel": {
        backgroundColor: "var(--popover)",
        color: "var(--muted-foreground)",
        fontFamily: detectMonoFontFamily(),
        fontSize: "10px",
        padding: "0 8px",
        borderTop: "1px solid var(--border)",
      },
    }),
  ];
}

/** 由偏好驱动的扩展(字号 / 缩进 / 制表符宽度 / 换行),走 optionsCompartment。 */
export function buildPrefExtensions(prefs: EditorPrefs): Extension[] {
  return [
    indentUnit.of(" ".repeat(prefs.editorTabSize)),
    EditorState.tabSize.of(prefs.editorTabSize),
    ...(prefs.editorWordWrap ? [EditorView.lineWrapping] : []),
    EditorView.theme({
      ".cm-scroller": {
        fontFamily: detectMonoFontFamily(),
        fontSize: `${prefs.editorFontSize}px`,
        lineHeight: "1.55",
      },
    }),
  ];
}
