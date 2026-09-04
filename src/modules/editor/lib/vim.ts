import { Vim, vim } from "@replit/codemirror-vim";
import type { Extension } from "@codemirror/state";
import { ViewPlugin, type EditorView } from "@codemirror/view";

export type VimHandlers = { save: () => void; close: () => void };

const handlers = new WeakMap<EditorView, VimHandlers>();

/** 把 :w / :q 处理器绑定到当前视图的 CodeMirror 扩展。 */
export function vimHandlersExtension(getHandlers: () => VimHandlers): Extension {
  return ViewPlugin.define((view) => {
    handlers.set(view, getHandlers());
    return {
      update() {
        // 闭包可能捕获到过期的 ref,update 时刷新一次。
        handlers.set(view, getHandlers());
      },
      destroy() {
        handlers.delete(view);
      },
    };
  });
}

let initialized = false;

export function initVimGlobals(): void {
  if (initialized) return;
  initialized = true;

  type CmAdapter = { cm6?: EditorView };
  const getView = (cm: CmAdapter) => cm.cm6;

  Vim.defineEx("write", "w", (cm: CmAdapter) => {
    const view = getView(cm);
    if (view) handlers.get(view)?.save();
  });

  Vim.defineEx("quit", "q", (cm: CmAdapter) => {
    const view = getView(cm);
    if (view) handlers.get(view)?.close();
  });

  Vim.defineEx("wq", "wq", (cm: CmAdapter) => {
    const view = getView(cm);
    if (!view) return;
    const h = handlers.get(view);
    h?.save();
    h?.close();
  });

  Vim.defineEx("xit", "x", (cm: CmAdapter) => {
    const view = getView(cm);
    if (!view) return;
    const h = handlers.get(view);
    h?.save();
    h?.close();
  });

  // 方向键会被插件转发给编辑器 scope 的处理器,破坏 operator-pending
  // (d<Up>) 和计数前缀(15<Up>)。remap 到 hjkl,让它们留在 vim 状态机内。
  Vim.map("<Up>", "k", "normal");
  Vim.map("<Down>", "j", "normal");
  Vim.map("<Left>", "h", "normal");
  Vim.map("<Right>", "l", "normal");
  Vim.map("<Up>", "k", "visual");
  Vim.map("<Down>", "j", "visual");
  Vim.map("<Left>", "h", "visual");
  Vim.map("<Right>", "l", "visual");
}

/**
 * Vim 模式扩展,通过 vimCompartment 挂载/卸载。
 * `status: true` 会在编辑器底部挂一个 `.cm-vim-panel` 显示当前模式。
 */
export function vimModeExtension(): Extension {
  initVimGlobals();
  return vim({ status: true });
}
