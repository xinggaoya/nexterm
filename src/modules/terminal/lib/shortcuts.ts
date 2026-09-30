/**
 * xterm 实例上的快捷键处理。
 *
 * 职责很窄：只接管“xterm 自己不会做、但 IDE 用户天天按”的几个键，其余全部
 * 作为普通按键发给 PTY。
 *
 * - `Ctrl+F`       终端内查找（此前组件与 SearchAddon 都已存在但零引用）
 * - `Ctrl+Shift+C` 复制选区
 * - `Ctrl+Shift+V` 粘贴
 *
 * 为什么不放在全局键位系统里：这些键在 xterm 的 textarea 上必须先被拦住，
 * 否则会被 `attachCustomKeyEventHandler` 之前的默认处理吞掉；而它们与
 * 工作台命令（Mod+K 等）不在一个命名空间里。
 */
import type { Terminal } from "@xterm/xterm";

import { writeClipboardText, readClipboardText } from "@/lib/clipboard";

interface AttachOptions {
  term: Terminal;
  /** Ctrl+F 切换/聚焦终端内查找面板。 */
  onFind?: () => void;
}

export function attachClipboardShortcuts(opts: AttachOptions): () => void {
  const handler = (event: KeyboardEvent): boolean => {
    if (event.type !== "keydown") return true;
    const mod = event.ctrlKey || event.metaKey;
    // 终端内查找：Ctrl+F 在 shell 里无绑定，是留给 IDE 的干净键位。
    // 不能再加 Shift —— Ctrl+Shift+F 已经是“在文件中查找”。
    if (opts.onFind && event.ctrlKey && !event.metaKey && !event.shiftKey && !event.altKey) {
      if (event.key.toLowerCase() === "f") {
        event.preventDefault();
        opts.onFind();
        return false;
      }
    }
    if (!mod || !event.shiftKey) return true;
    const key = event.key.toUpperCase();
    if (key === "C") {
      const selection = opts.term.getSelection();
      if (selection) {
        void writeClipboardText(selection).catch(() => {});
      }
      event.preventDefault();
      return false;
    }
    if (key === "V") {
      void pasteClipboardIntoTerminal(opts.term);
      event.preventDefault();
      return false;
    }
    return true;
  };

  opts.term.attachCustomKeyEventHandler(handler);
  return () => opts.term.attachCustomKeyEventHandler(() => true);
}

export async function pasteClipboardIntoTerminal(term: Terminal): Promise<void> {
  const text = await readClipboardText();
  if (text) term.paste(text);
}
