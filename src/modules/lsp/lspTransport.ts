import {
  AbstractMessageReader,
  AbstractMessageWriter,
  createMessageConnection,
  type DataCallback,
  type Logger,
  type Message,
  type MessageConnection,
  type MessageReader,
  type MessageWriter,
} from "vscode-jsonrpc";
import type { Channel } from "@tauri-apps/api/core";

import type { LspServerMessage } from "./types";

export type LspTransportOptions = {
  /**
   * 语言标识（`rust` / `typescript` / `python` / `go`）。
   *
   * **不要在这里传可执行文件路径。** 后端 `lsp_start` 只接受 language，
   * 命令由后端白名单解析 —— 否则 webview 就拿到了一个「以宿主权限执行
   * 任意程序」的接口。
   */
  language: string;
  /** 工作区根目录（server 的 cwd）。必须已授权，否则后端会拒绝。 */
  cwd?: string | null;
  workspace?: unknown;
  invoke: (cmd: string, args?: Record<string, unknown>) => Promise<unknown>;
  openChannel: <T>(name: string) => Promise<Channel<T>>;
  logger?: Logger;
};

/**
 * 把 Tauri Channel 上的 frame 事件喂给 vscode-jsonrpc。
 * Rust 端已经做完 Content-Length framing，这里只负责把 payload 解析为 JSON-RPC message。
 */
class TauriChannelReader extends AbstractMessageReader implements MessageReader {
  private disposed = false;
  private cb: DataCallback | null = null;

  constructor(private readonly channel: Channel<LspServerMessage>) {
    super();
  }

  listen(callback: DataCallback): { dispose: () => void } {
    this.cb = callback;
    this.channel.onmessage = (msg: LspServerMessage) => {
      if (this.disposed) return;
      const cb = this.cb;
      if (!cb) return;
      if (msg.kind === "frame") {
        try {
          const parsed: Message = JSON.parse(msg.payload);
          cb(parsed);
        } catch (err) {
          this.fireError(err as Error);
        }
      } else if (msg.kind === "parse_error") {
        this.fireError(new Error(msg.message));
      } else if (msg.kind === "exit") {
        this.fireClose();
      }
      // stderr 走 logger
    };
    return {
      dispose: () => {
        this.disposed = true;
      },
    };
  }

  dispose(): void {
    this.disposed = true;
    super.dispose();
  }
}

class TauriInvokeWriter extends AbstractMessageWriter implements MessageWriter {
  constructor(
    private readonly sender: (message: string) => Promise<void>,
  ) {
    super();
  }

  write(msg: Message): Promise<void> {
    return this.sender(JSON.stringify(msg));
  }

  end(): void {
    // TauriChannel on close 已经在 Rust 端写入 EOF；本地 writer 不需要做额外动作。
  }
}

/**
 * 创建 vscode-jsonrpc MessageConnection：包装 lsp_start / lsp_write / channel。
 */
export async function createLspConnection(
  options: LspTransportOptions,
): Promise<MessageConnection> {
  const channel = await options.openChannel<LspServerMessage>(
    `lsp-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`,
  );
  const sessionId = (await options.invoke("lsp_start", {
    language: options.language,
    cwd: options.cwd ?? null,
    workspace: options.workspace,
  })) as number;

  const reader = new TauriChannelReader(channel);
  const writer = new TauriInvokeWriter((message: string) =>
    options.invoke("lsp_write", { id: sessionId, message }) as Promise<void>,
  );

  const conn = createMessageConnection(reader, writer, options.logger);
  conn.onDispose(() => {
    void options.invoke("lsp_stop", { id: sessionId });
  });
  return conn;
}
