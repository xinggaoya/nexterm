import {
  AbstractMessageReader,
  AbstractMessageWriter,
  createMessageConnection,
  type ConnectionOptions,
  type DataCallback,
  type Message,
  type MessageConnection,
} from "vscode-jsonrpc";
import type { Channel } from "@tauri-apps/api/core";

import type {
  LspServerMessage,
  LspServerSpec,
} from "./types";

export type LspTransportOptions = {
  spec: LspServerSpec;
  invoke: (cmd: string, args?: Record<string, unknown>) => Promise<unknown>;
  openChannel: <T>(name: string) => Promise<Channel<T>>;
  logger?: ConnectionOptions["logger"];
};

/**
 * 把 Tauri Channel 上的 frame 事件喂给 vscode-jsonrpc。
 * Rust 端已经做完 Content-Length framing，这里只负责把 payload 解析为 JSON-RPC message。
 */
class TauriChannelReader extends AbstractMessageReader {
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
      // stderr：走 logger（options.logger）
    };
    return {
      dispose: () => {
        this.disposed = true;
      },
    };
  }

  override dispose(): void {
    this.disposed = true;
    super.dispose();
  }
}

class TauriInvokeWriter extends AbstractMessageWriter {
  constructor(private readonly write: (message: string) => Promise<void>) {
    super();
  }

  override writeMessage(message: Message): Promise<void> {
    return this.write(JSON.stringify(message));
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
    spec: options.spec,
  })) as number;

  const reader = new TauriChannelReader(channel);
  const writer = new TauriInvokeWriter((message) =>
    options.invoke("lsp_write", { id: sessionId, message }) as Promise<void>,
  );

  const conn = createMessageConnection(reader, writer, options.logger);
  conn.onDispose(() => {
    void options.invoke("lsp_stop", { id: sessionId });
  });
  return conn;
}
