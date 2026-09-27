import type { EditorView } from "@codemirror/view";
import type { MessageConnection } from "vscode-jsonrpc";
import { invoke, Channel } from "@tauri-apps/api/core";

import { createLspConnection } from "./lspTransport";
import { detectLspLanguage, type SupportedLanguage } from "./languageMap";
import {
  type LspCompletionList,
  type LspDocumentSymbol,
  type LspHover,
  type LspLocation,
  type LspLocationLink,
  type LspPosition,
  type PublishDiagnosticsParams,
} from "./types";

/** initialize 握手的超时；超时则放弃 attach 并杀掉会话，不让编辑器卡死。 */
const INITIALIZE_TIMEOUT_MS = 10_000;

/**
 * 单次补全 / 悬浮 / 跳转的超时。给一个明确上界，否则卡住的 server 会让
 * 补全面板一直转圈。
 */
const REQUEST_TIMEOUT_MS = 2_000;

/**
 * 客户端能力声明。**只声明真正接上的功能** —— 声明了却不做，服务端会给
 * 出客户端接不住的结果（比如建议的 workspaceEdit 变更），用户会看到
 * “看起来能点但没反应”。
 */
const CLIENT_CAPABILITIES = {
  textDocument: {
    // 我们走全量 textDocumentSync（didChange 带全文），kind 1 = Full。
    synchronization: { dynamicRegistration: false, willSave: false, didSave: true },
    completion: {
      dynamicRegistration: false,
      // snippetSupport: false —— 我们不解析 snippet 占位符。
      completionItem: { snippetSupport: false, documentationFormat: ["markdown", "plaintext"] },
      contextSupport: false,
    },
    hover: { dynamicRegistration: false, contentFormat: ["markdown", "plaintext"] },
    definition: { dynamicRegistration: false, linkSupport: false },
    documentSymbol: {
      dynamicRegistration: false,
      hierarchicalDocumentSymbolSupport: true,
    },
  },
  workspace: { workspaceFolders: true },
} as const;

export type LspEditorClient = {
  language: SupportedLanguage;
  /** 文档 URI（`file://` 形式），didOpen/didChange/publishDiagnostics 共用。 */
  documentUri: string;
  /** 保存后调用：把当前全文作为 didChange 推给 server，触发重新诊断。 */
  notifyDocumentChanged: (text: string) => void;
  /**
   * 请求补全。`position` 用 LSP 的 0-based line + UTF-16 character。
   * server 不可用 / 超时 / 协议不符时返回 null，调用方降级为无补全。
   */
  requestCompletion: (position: LspPosition) => Promise<LspCompletionList | null>;
  requestHover: (position: LspPosition) => Promise<LspHover | null>;
  requestDefinition: (
    position: LspPosition,
  ) => Promise<LspLocation | LspLocationLink | LspLocation[] | null>;
  requestDocumentSymbols: () => Promise<LspDocumentSymbol[] | null>;
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
        capabilities: CLIENT_CAPABILITIES,
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
  /**
   * 统一的请求入口：带上文档定位 + 超时，并给出“错了也不能拖死编辑器”的
   * 降级策略。补全失败就当没有补全，hover 失败就没有悬浮 —— 任何情况下
   * 都不应该抛到调用方。
   */
  const request = async <T>(
    method: string,
    position?: LspPosition,
    timeoutMs = REQUEST_TIMEOUT_MS,
  ): Promise<T | null> => {
    const params = position
      ? { textDocument: { uri: documentUri }, position }
      : { textDocument: { uri: documentUri } };
    try {
      return await withTimeout(
        connection.sendRequest<T>(method, params),
        timeoutMs,
      );
    } catch (error) {
      console.warn(`[lsp] ${method} failed:`, error);
      return null;
    }
  };

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
    requestCompletion: (position) =>
      request<LspCompletionList>("textDocument/completion", position),
    requestHover: (position) => request<LspHover>("textDocument/hover", position),
    requestDefinition: (position) =>
      request<LspLocation | LspLocationLink | LspLocation[]>(
        "textDocument/definition",
        position,
      ),
    // 符号树可能很大，给更宽的超时。
    requestDocumentSymbols: () =>
      request<LspDocumentSymbol[]>("textDocument/documentSymbol", undefined, 5_000),
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

/** 当前 editor 的 LSP 客户端（未 attach 时为 undefined）。 */
export function getLspClient(editor: EditorView): LspEditorClient | undefined {
  return clients.get(editor);
}
