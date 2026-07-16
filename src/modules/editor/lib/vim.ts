import * as monaco from "monaco-editor";
import { initVimMode, VimMode } from "monaco-vim";

export type VimHandlers = { save: () => void; close: () => void };

const handlersByEditor = new WeakMap<
  monaco.editor.IStandaloneCodeEditor,
  VimHandlers
>();
let initialized = false;

// monaco-vim@0.4 在 export surface 中只暴露 initVimMode / StatusBar / VimMode；
// 内置的 Vim API（defineEx / map）挂在 VimMode.Vim 上，作为 IIFE 结果。
type VimApi = {
  defineEx(
    name: string,
    prefix: string,
    fn: (cm: unknown) => void,
  ): void;
  map(lhs: string, rhs: string, mode: string): void;
};
const vimApi = (VimMode as unknown as { Vim: VimApi }).Vim;

function ensureInit() {
  if (initialized) return;
  initialized = true;

  vimApi.defineEx("write", "w", (cm: unknown) => {
    const editor = (cm as { cm6?: monaco.editor.IStandaloneCodeEditor }).cm6;
    if (editor) handlersByEditor.get(editor)?.save();
  });
  vimApi.defineEx("quit", "q", (cm: unknown) => {
    const editor = (cm as { cm6?: monaco.editor.IStandaloneCodeEditor }).cm6;
    if (editor) handlersByEditor.get(editor)?.close();
  });
  vimApi.defineEx("wq", "wq", (cm: unknown) => {
    const editor = (cm as { cm6?: monaco.editor.IStandaloneCodeEditor }).cm6;
    const h = editor ? handlersByEditor.get(editor) : undefined;
    h?.save();
    h?.close();
  });
  vimApi.defineEx("xit", "x", (cm: unknown) => {
    const editor = (cm as { cm6?: monaco.editor.IStandaloneCodeEditor }).cm6;
    const h = editor ? handlersByEditor.get(editor) : undefined;
    h?.save();
    h?.close();
  });

  // 方向键 remap（沿用现有约束）。monaco-vim 0.4 的 map() 第 3 个参数是字符串 mode。
  vimApi.map("<Up>", "k", "normal");
  vimApi.map("<Down>", "j", "normal");
  vimApi.map("<Left>", "h", "normal");
  vimApi.map("<Right>", "l", "normal");
  vimApi.map("<Up>", "k", "visual");
  vimApi.map("<Down>", "j", "visual");
  vimApi.map("<Left>", "h", "visual");
  vimApi.map("<Right>", "l", "visual");
}

export type VimAttachment = {
  dispose(): void;
};

export function attachVim(
  editor: monaco.editor.IStandaloneCodeEditor,
  handlers: VimHandlers,
): VimAttachment {
  ensureInit();
  handlersByEditor.set(editor, handlers);

  const statusNode = document.createElement("div");
  statusNode.style.position = "absolute";
  statusNode.style.bottom = "4px";
  statusNode.style.right = "8px";
  statusNode.style.fontSize = "10px";
  statusNode.style.color = "var(--muted-foreground)";
  statusNode.style.pointerEvents = "none";
  document.body.appendChild(statusNode);

  const vim = initVimMode(editor, statusNode);

  return {
    dispose() {
      vim.dispose();
      statusNode.remove();
      handlersByEditor.delete(editor);
    },
  };
}
