/**
 * Keyboard shortcut handling for xterm instances. v2 only owns two
 * shortcuts — clipboard copy/paste — and lets xterm render the rest as
 * normal keystrokes so the host shell receives them.
 */

import type { Terminal } from "@xterm/xterm";

import { writeClipboardText, readClipboardText } from "@/lib/clipboard";
import type { PtySessionHandle } from "./sessions";

interface AttachOptions {
  term: Terminal;
  session: PtySessionHandle | null;
  enabled: boolean;
}

export function attachClipboardShortcuts(opts: AttachOptions): () => void {
  if (!opts.enabled) return () => {};

  const handler = (event: KeyboardEvent): boolean => {
    if (event.type !== "keydown") return true;
    const mod = event.ctrlKey || event.metaKey;
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
      void readClipboardText()
        .then((text) => {
          if (text) opts.session?.write(text);
        })
        .catch(() => {});
      event.preventDefault();
      return false;
    }
    return true;
  };

  opts.term.attachCustomKeyEventHandler(handler);
  return () => opts.term.attachCustomKeyEventHandler(() => true);
}
