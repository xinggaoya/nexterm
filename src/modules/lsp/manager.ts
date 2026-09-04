import type { EditorView } from "@codemirror/view";
import { invoke, Channel } from "@tauri-apps/api/core";

import { createLspConnection } from "./lspTransport";
import { detectLspLanguage, type SupportedLanguage } from "./languageMap";

type Client = {
  language: SupportedLanguage;
  dispose: () => void;
};

const clients = new WeakMap<EditorView, Client>();

export type LspAttachOutcome =
  | { attached: true; language: SupportedLanguage }
  | { attached: false; reason: string };

export async function attachLspToEditor(
  editor: EditorView,
  filename: string,
): Promise<LspAttachOutcome> {
  const language = detectLspLanguage(filename);
  if (!language) return { attached: false, reason: "no-lsp-language" };

  const resolved = await invoke<{ command: string; args: string[] } | null>(
    "lsp_resolve_command",
    { language },
  );
  if (!resolved || !resolved.command) {
    return { attached: false, reason: "no-server-binary" };
  }

  // Channel 的 onmessage callback 由 TauriChannelReader 在 listen() 中注入；
  // 这里提供一个空回调占位，避免 Tauri 立即认为 channel 关闭。
  const channel = new Channel<{
    kind: string;
    payload?: string;
    message?: string;
    code?: number;
  }>(() => undefined);

  const connection = await createLspConnection({
    spec: {
      id: language,
      language,
      command: resolved.command,
      args: resolved.args,
    },
    invoke: (cmd: string, args?: Record<string, unknown>) =>
      invoke(cmd, args) as Promise<unknown>,
    openChannel: async () => channel as unknown as never,
  });

  connection.listen();
  const dispose = () => {
    try {
      connection.dispose();
    } catch {
      // ignore disposal errors
    }
  };
  clients.set(editor, { language, dispose });
  return { attached: true, language };
}

export async function detachLspFromEditor(
  editor: EditorView,
): Promise<void> {
  const client = clients.get(editor);
  if (!client) return;
  client.dispose();
  clients.delete(editor);
}

export function isLspAttached(
  editor: EditorView,
): boolean {
  return clients.has(editor);
}
