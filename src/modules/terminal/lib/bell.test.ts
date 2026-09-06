// @vitest-environment jsdom
import { beforeEach, describe, expect, it, vi } from "vitest";

type BellHandler = () => void;

function fakeTerm() {
  const handlers: BellHandler[] = [];
  return {
    onBell: (cb: BellHandler) => {
      handlers.push(cb);
      return { dispose: () => handlers.splice(handlers.indexOf(cb), 1) };
    },
    ring() {
      for (const cb of [...handlers]) cb();
    },
    listenerCount() {
      return handlers.length;
    },
  };
}

vi.mock("@/modules/notifications/notificationCenter", () => ({
  notifyInfo: vi.fn(),
}));
vi.mock("@/lib/osNotifications", () => ({
  sendOsNotification: vi.fn().mockResolvedValue(undefined),
}));

import { notifyInfo } from "@/modules/notifications/notificationCenter";
import { sendOsNotification } from "@/lib/osNotifications";
import { attachTerminalBell } from "./bell";

function flushTimers() {
  vi.advanceTimersByTime(3100);
}

describe("attachTerminalBell", () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it("无 onBell 能力的假 term 返回 no-op 解绑函数", () => {
    const detach = attachTerminalBell({} as never, {
      enabled: () => true,
      soundEnabled: () => false,
      title: () => "t",
    });
    expect(() => detach()).not.toThrow();
  });

  it("enabled=false 时响铃不产生通知", () => {
    vi.useFakeTimers();
    const term = fakeTerm();
    attachTerminalBell(term as never, {
      enabled: () => false,
      soundEnabled: () => false,
      title: () => "t",
    });
    term.ring();
    expect(notifyInfo).not.toHaveBeenCalled();
    vi.useRealTimers();
  });

  it("响铃触发应用内通知（窗口有焦点）并受冷却窗口限流", () => {
    vi.useFakeTimers();
    const term = fakeTerm();
    attachTerminalBell(term as never, {
      enabled: () => true,
      soundEnabled: () => false,
      title: () => "term-1",
    });
    document.hasFocus = () => true;
    term.ring();
    term.ring();
    term.ring();
    expect(notifyInfo).toHaveBeenCalledTimes(1);
    expect(sendOsNotification).not.toHaveBeenCalled();
    flushTimers();
    term.ring();
    expect(notifyInfo).toHaveBeenCalledTimes(2);
    vi.useRealTimers();
  });

  it("窗口失焦时走系统通知", () => {
    vi.useFakeTimers();
    const term = fakeTerm();
    attachTerminalBell(term as never, {
      enabled: () => true,
      soundEnabled: () => false,
      title: () => "term-2",
    });
    document.hasFocus = () => false;
    term.ring();
    expect(sendOsNotification).toHaveBeenCalledWith("term-2");
    expect(notifyInfo).not.toHaveBeenCalled();
    vi.useRealTimers();
  });

  it("dispose 后不再响应响铃", () => {
    vi.useFakeTimers();
    const term = fakeTerm();
    const detach = attachTerminalBell(term as never, {
      enabled: () => true,
      soundEnabled: () => false,
      title: () => "t",
    });
    detach();
    expect(term.listenerCount()).toBe(0);
    vi.useRealTimers();
  });
});
