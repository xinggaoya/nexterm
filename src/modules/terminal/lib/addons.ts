/**
 * 非渲染器 addons 装载管理。
 *
 * 把 fit / search / unicode11 / web-links / serialize / clipboard 集中,
 * 每个 pane 初始化时调用一次 loadStandardAddons(term, options) 即可。
 * 渲染器(WebGL/DOM)由 rendererPipeline 单独管理,因为它的 attach/detach 异步。
 */

import type { Terminal } from "@xterm/xterm";
import { FitAddon } from "@xterm/addon-fit";
import { SearchAddon } from "@xterm/addon-search";
import { Unicode11Addon } from "@xterm/addon-unicode11";
import { WebLinksAddon } from "@xterm/addon-web-links";
import { SerializeAddon } from "@xterm/addon-serialize";
import {
  ClipboardAddon,
  Base64,
  type IClipboardProvider,
  ClipboardSelectionType,
} from "@xterm/addon-clipboard";

export interface StandardAddons {
  fit: FitAddon;
  search: SearchAddon;
  serialize: SerializeAddon;
  unicode: Unicode11Addon;
  webLinks: WebLinksAddon;
  /** OSC 52 clipboard,可能在某些环境不可用 */
  clipboard: ClipboardAddon | null;
  /** 卸载 hook,只 dispose 我们自己挂载的 addons */
  dispose: () => void;
}

export interface ClipboardBridgeOptions {
  /** 从剪贴板读文本 */
  readText: () => Promise<string>;
  /** 往剪贴板写文本 */
  writeText: (text: string) => Promise<void>;
}

export function loadStandardAddons(
  term: Terminal,
  clipboard?: ClipboardBridgeOptions,
): StandardAddons {
  const fit = new FitAddon();
  const search = new SearchAddon();
  const serialize = new SerializeAddon();
  const unicode = new Unicode11Addon();
  const webLinks = new WebLinksAddon();

  term.loadAddon(fit);
  term.loadAddon(search);
  term.loadAddon(serialize);
  term.loadAddon(unicode);
  term.loadAddon(webLinks);

  term.unicode.activeVersion = "11";

  let clipboardAddon: ClipboardAddon | null = null;
  if (clipboard) {
    try {
      const provider: IClipboardProvider = {
        readText: (_selection: ClipboardSelectionType) => clipboard.readText(),
        writeText: (
          _selection: ClipboardSelectionType,
          text: string,
        ) => clipboard.writeText(text),
      };
      clipboardAddon = new ClipboardAddon(new Base64(), provider);
      term.loadAddon(clipboardAddon);
    } catch {
      clipboardAddon = null;
    }
  }

  return {
    fit,
    search,
    serialize,
    unicode,
    webLinks,
    clipboard: clipboardAddon,
    dispose: () => {
      try {
        clipboardAddon?.dispose();
      } catch {
        // ignore
      }
      try {
        webLinks.dispose();
      } catch {
        // ignore
      }
      try {
        unicode.dispose();
      } catch {
        // ignore
      }
      try {
        serialize.dispose();
      } catch {
        // ignore
      }
      try {
        search.dispose();
      } catch {
        // ignore
      }
      try {
        fit.dispose();
      } catch {
        // ignore
      }
    },
  };
}