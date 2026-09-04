/**
 * CodeMirror 6 各功能包的无操作桩:所有扩展工厂返回空扩展,常量返回空数组。
 * 供 vi.mock("@codemirror/<pkg>") 工厂统一引用。
 */

export const autocompletion = () => [];
export const closeBrackets = () => [];
export const closeBracketsKeymap: unknown[] = [];
export const lintGutter = () => [];
export const linter = () => [];
export const unifiedMergeView = () => [];
export const search = () => [];
export const searchKeymap: unknown[] = [];
export const highlightSelectionMatches = () => [];
export const defaultKeymap: unknown[] = [];
export const historyKeymap: unknown[] = [];
export const history = () => [];
export const indentWithTab = { key: "Tab" };
export const undo = () => Promise.resolve(true);
export const redo = () => Promise.resolve(true);
export const bracketMatching = () => [];
export const foldGutter = () => [];
export const codeFolding = () => [];
export const indentOnInput = () => [];
export const indentUnit = { of: () => [] };
export const StreamLanguage = { define: () => [] };
export const HighlightStyle = { define: () => ({}) };
export const syntaxHighlighting = () => [];
export const Vim = {
  defineEx: () => undefined,
  map: () => undefined,
};
export const vim = () => [];
