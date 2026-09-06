import type { EditorView } from "@codemirror/view";
import type { MessageConnection } from "vscode-jsonrpc";
import { invoke, Channel } from "@tauri-apps/api/core";

import { createLspConnection } from "./lspTransport";
import { detectLspLanguage, type SupportedLanguage } from "./languageMap";
import type { PublishDiagnosticsParams } from "./types";

/** initialize 握手的超时；超时则放弃 attach 并杀掉会话，不让编辑器卡死。 */
const INITIALIZE_TIMEOUT_MS = 10_000;

export type LspEditorClient = {
  language: SupportedLanguage;
  /** 文档 URI（`file://` 形式），didOpen/didChange/publishDiagnostics 共用。 */
  documentUri: string;
  /** 保存后调用：把当前全文作为 didChange 推给 server，触发重新诊断。 */
  notifyDocumentChanged: (text: string) => void;
  dispose: () => void;
};

type Client = LspEditorClient & {
  connection: MessageConnection;
};

const clients = new WeakMap<EditorView, Client>();

export type LspAttachOptions = {
  /** 当前编辑器全文，didOpen 用。 */
  getDocumentText: () => string;
  /** workspace 根目录（用于 initialize 的 rootUri），缺省时不传 root。 */
  workspaceRoot?: string | null;
  /** server 推回诊断时的回调（已按文档 URI 过滤）。 */
  onDiagnostics?: (params: PublishDiagnosticsParams) => void;
};

export type LspAttachOutcome =
  | { attached: true; language: SupportedLanguage }
  | { attached: false; reason: string };

/** 本地路径 → `file://` URI（LSP 用）。段内做百分号编码，分隔符保留。 */
export function pathToFileUri(path: string): string {
  const normalized = path.replace(/\\/g, "/");
  const withLeading = normalized.startsWith("/") ? normalized : `/${normalized}`;
  return `file://${encodeURI(withLeading)}`;
}

export async function attachLspToEditor(
  editor: EditorView,
  filename: string,
  options: LspAttachOptions,
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

  const documentUri = pathToFileUri(filename);

  try {
    // ── initialize 握手 ────────────────────────────────────────────────
    const rootUri = options.workspaceRoot
      ? pathToFileUri(options.workspaceRoot)
      : null;
    await withTimeout(
      connection.sendRequest<{ capabilities: unknown }>("initialize", {
        processId: null,
        rootUri,
        capabilities: {},
        workspaceFolders: rootUri
          ? [{ uri: rootUri, name: options.workspaceRoot }]
          : null,
      }),
      INITIALIZE_TIMEOUT_MS,
    );
    connection.sendNotification("initialized", {});

    // ── didOpen + publishDiagnostics 订阅 ──────────────────────────────
    connection.onNotification(
      "textDocument/publishDiagnostics",
      (params: PublishDiagnosticsParams) => {
        if (params.uri !== documentUri) return;
        options.onDiagnostics?.(params);
      },
    );
    connection.sendNotification("textDocument/didOpen", {
      textDocument: {
        uri: documentUri,
        languageId: language,
        version: 1,
        text: options.getDocumentText(),
      },
    });
  } catch (error) {
    // 握手失败：杀掉 server 会话，保持编辑器无 LSP 状态。
    try {
      connection.dispose();
    } catch {
      // ignore
    }
    console.warn(`[lsp] initialize failed for ${language}:`, error);
    return { attached: false, reason: "initialize-failed" };
  }

  let version = 1;
  const client: Client = {
    language,
    documentUri,
    connection,
    notifyDocumentChanged: (text) => {
      version += 1;
      connection.sendNotification("textDocument/didChange", {
        textDocument: { uri: documentUri, version },
        contentChanges: [{ text }],
      });
    },
    dispose: () => {
      try {
        connection.sendNotification("textDocument/didClose", {
          textDocument: { uri: documentUri },
        });
        void connection
          .sendRequest("shutdown", null)
          .then(() => connection.sendNotification("exit", null))
          .catch(() => undefined);
      } catch {
        // ignore
      }
      try {
        connection.dispose();
      } catch {
        // ignore disposal errors
      }
    },
  };
  clients.set(editor, client);
  return { attached: true, language };
}

function withTimeout<T>(promise: Promise<T>, ms: number): Promise<T> {
  return new Promise<T>((resolve, reject) => {
    const timer = setTimeout(
      () => reject(new Error("lsp initialize timeout")),
      ms,
    );
    promise.then(
      (value) => {
        clearTimeout(timer);
        resolve(value);
      },
      (error) => {
        clearTimeout(timer);
        reject(error);
      },
    );
  });
}

/** 保存后调用（仅当该编辑器处于 LSP 模式时有实际效果）。 */
export function notifyLspDocumentChanged(
  editor: EditorView,
  text: string,
): void {
  clients.get(editor)?.notifyDocumentChanged(text);
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
