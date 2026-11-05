import { beforeEach, describe, expect, it, vi } from "vitest";

const installMock = vi.hoisted(() => vi.fn());
vi.mock("tauri-plugin-web-dev-bridge", () => ({
  installWebDevBridge: installMock,
}));

const runtimeMock = vi.hoisted(() => ({
  hasTauriInternals: vi.fn(() => false),
}));
vi.mock("./tauriRuntime", () => runtimeMock);

import {
  DEV_BRIDGE_DISCOVERY_ROUTE,
  installDevBridge,
  probeDevBridge,
  resolveDevBridgeBoot,
} from "./devBridge";

/**
 * 构造一个按 URL 分流的 fetch 替身。
 *
 * @param descriptor 发现路由返回的描述文件内容
 * @param healthOk 桥的 `/health` 是否可达
 */
function fetchStub(
  descriptor: { port?: number | null; url?: string | null },
  healthOk = true,
): typeof fetch {
  return vi.fn(async (input: RequestInfo | URL) => {
    const url = String(input);
    if (url === DEV_BRIDGE_DISCOVERY_ROUTE) {
      return {
        ok: true,
        json: async () => descriptor,
      };
    }
    return {
      ok: healthOk,
      json: async () => ({ pid: 1, webview: "main" }),
    };
  }) as unknown as typeof fetch;
}

/** 取出 fetch 替身被调用时用过的 URL 列表。 */
function calledUrls(fetchImpl: typeof fetch): string[] {
  return (fetchImpl as unknown as ReturnType<typeof vi.fn>).mock.calls.map(
    (call) => String(call[0]),
  );
}

describe("probeDevBridge", () => {
  it("桥可达时判定为已就绪", async () => {
    const fetchImpl = fetchStub({ port: 6222, url: "http://127.0.0.1:6222" });

    await expect(probeDevBridge({ fetchImpl })).resolves.toBe(true);
  });

  it("先打同源发现路由，再打桥自己的 /health 确认存活", async () => {
    const fetchImpl = fetchStub({ port: 6222, url: "http://127.0.0.1:6222" });

    await probeDevBridge({ fetchImpl });

    expect(calledUrls(fetchImpl)).toEqual([
      DEV_BRIDGE_DISCOVERY_ROUTE,
      "http://127.0.0.1:6222/health",
    ]);
  });

  it("端口为 null（桌面应用未启动）时判定桥不可用", async () => {
    await expect(
      probeDevBridge({ fetchImpl: fetchStub({ port: null }) }),
    ).resolves.toBe(false);
  });

  it("端口为 0 时判定桥不可用", async () => {
    await expect(
      probeDevBridge({ fetchImpl: fetchStub({ port: 0 }) }),
    ).resolves.toBe(false);
  });

  it("描述文件是上次运行的残留（/health 不通）时判定桥不可用", async () => {
    // 应用被强杀时不会清理描述文件 —— 端口还在，进程没了。
    // 只看发现路由会误判成「已就绪」，随后每次 invoke 都连接被拒 → 白屏。
    const fetchImpl = fetchStub(
      { port: 6222, url: "http://127.0.0.1:6222" },
      false,
    );

    await expect(probeDevBridge({ fetchImpl })).resolves.toBe(false);
  });

  it("请求失败时判定桥不可用且不向上抛错", async () => {
    const fetchImpl = vi.fn(async () => {
      throw new Error("network down");
    }) as unknown as typeof fetch;

    await expect(probeDevBridge({ fetchImpl })).resolves.toBe(false);
  });

  it("响应非 2xx 时判定桥不可用", async () => {
    const fetchImpl = vi.fn(async () => ({
      ok: false,
      json: async () => ({ port: 6222 }),
    })) as unknown as typeof fetch;

    await expect(probeDevBridge({ fetchImpl })).resolves.toBe(false);
  });
});

describe("resolveDevBridgeBoot", () => {
  beforeEach(() => {
    runtimeMock.hasTauriInternals.mockReturnValue(false);
  });

  it("运行在 Tauri 里时返回 desktop，且不发起任何请求", async () => {
    runtimeMock.hasTauriInternals.mockReturnValue(true);
    const fetchImpl = fetchStub({ port: 6222 });

    await expect(resolveDevBridgeBoot({ fetchImpl })).resolves.toBe("desktop");
    expect(fetchImpl).not.toHaveBeenCalled();
  });

  it("运行在浏览器里且桥已就绪时返回 browser-bridge", async () => {
    await expect(
      resolveDevBridgeBoot({
        fetchImpl: fetchStub({ port: 6222, url: "http://127.0.0.1:6222" }),
      }),
    ).resolves.toBe("browser-bridge");
  });

  it("运行在浏览器里但桥未就绪时返回 browser-unavailable", async () => {
    await expect(
      resolveDevBridgeBoot({ fetchImpl: fetchStub({ port: null }) }),
    ).resolves.toBe("browser-unavailable");
  });
});

describe("installDevBridge", () => {
  it("委托给插件的 installWebDevBridge", () => {
    installMock.mockClear();

    installDevBridge();

    expect(installMock).toHaveBeenCalledTimes(1);
  });
});
