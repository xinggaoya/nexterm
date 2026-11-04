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

/** 构造一个只关心 `port` 字段的 fetch 替身。 */
function fetchReturning(port: number | null): typeof fetch {
  return vi.fn(async () => ({
    ok: true,
    json: async () => ({ port }),
  })) as unknown as typeof fetch;
}

describe("probeDevBridge", () => {
  it("发现路由返回正整数端口时判定桥已就绪", async () => {
    const fetchImpl = fetchReturning(6222);

    await expect(probeDevBridge({ fetchImpl })).resolves.toBe(true);
    // 必须打**相对路径**：同源才不受 CORS 约束，也不挑 localhost / 127.0.0.1
    expect(fetchImpl).toHaveBeenCalledTimes(1);
    expect((fetchImpl as unknown as ReturnType<typeof vi.fn>).mock.calls[0][0]).toBe(
      DEV_BRIDGE_DISCOVERY_ROUTE,
    );
  });

  it("端口为 null（桌面应用未启动）时判定桥不可用", async () => {
    await expect(
      probeDevBridge({ fetchImpl: fetchReturning(null) }),
    ).resolves.toBe(false);
  });

  it("端口为 0 时判定桥不可用", async () => {
    await expect(
      probeDevBridge({ fetchImpl: fetchReturning(0) }),
    ).resolves.toBe(false);
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
    const fetchImpl = fetchReturning(6222);

    await expect(resolveDevBridgeBoot({ fetchImpl })).resolves.toBe("desktop");
    expect(fetchImpl).not.toHaveBeenCalled();
  });

  it("运行在浏览器里且桥已就绪时返回 browser-bridge", async () => {
    await expect(
      resolveDevBridgeBoot({ fetchImpl: fetchReturning(6222) }),
    ).resolves.toBe("browser-bridge");
  });

  it("运行在浏览器里但桥未就绪时返回 browser-unavailable", async () => {
    await expect(
      resolveDevBridgeBoot({ fetchImpl: fetchReturning(null) }),
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
