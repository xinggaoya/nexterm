// @vitest-environment jsdom
import { describe, expect, it, vi } from "vitest";

vi.mock("@tauri-apps/api/core", () => ({
  Channel: class FakeChannel<T> {
    onmessage: ((msg: T) => void) | null = null;
    constructor(_name: string) {}
  },
}));

import { createLspConnection } from "./lspTransport";

function makeFakeChannel() {
  const handlers: Array<(msg: unknown) => void> = [];
  let onmessage: ((msg: unknown) => void) | null = null;
  return {
    set onmessage(cb: ((msg: unknown) => void) | null) {
      onmessage = cb;
      if (cb) handlers.push(cb);
    },
    get onmessage() {
      return onmessage;
    },
    send(msg: unknown) {
      if (onmessage) onmessage(msg);
    },
  };
}

describe("createLspConnection", () => {
  it("spawns session, pipes messages through invoke and channel", async () => {
    const writes: Array<[number, string]> = [];
    const channel = makeFakeChannel();
    const invoke = vi.fn(
      async (
        cmd: string,
        args?: Record<string, unknown>,
      ): Promise<unknown> => {
        if (cmd === "lsp_start") return 42;
        if (cmd === "lsp_write") {
          writes.push([
            args!.id as number,
            args!.message as string,
          ]);
        }
        return undefined;
      },
    );

    const conn = await createLspConnection({
      spec: {
        id: "mock",
        language: "__mock-lsp__",
        command: "/bin/echo",
        args: ["--mock-lsp"],
      },
      invoke,
      openChannel: async () => channel as unknown as never,
    });

    expect(invoke).toHaveBeenCalledWith(
      "lsp_start",
      expect.objectContaining({ spec: expect.any(Object) }),
    );

    conn.listen();
    // 触发 channel 上的 initialize 响应
    channel.send({
      kind: "frame",
      payload: JSON.stringify({ jsonrpc: "2.0", id: 1, result: null }),
    });

    // 主动发送一条 LSP 请求 → 应当通过 invoke('lsp_write') 透传
    const reqType = Object.assign(Object.create(null), { method: "ping" }) as never;
    conn.sendRequest(reqType);
    // 给 microtask 一个 tick
    await new Promise((r) => setTimeout(r, 50));
    expect(writes.length).toBeGreaterThanOrEqual(1);
    expect(writes[0][0]).toBe(42);
    // write[0][1] 可能是 string 或 object（取决于 JSON.stringify 路径是否被命中）
    const payload = writes[0][1];
    const serialized = typeof payload === "string" ? payload : JSON.stringify(payload);
    expect(serialized).toContain('"method":"ping"');
  });
});
