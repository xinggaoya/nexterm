import { describe, expect, it, vi } from "vitest";
import {
  installDevtoolsContextMenuRejectionGuard,
  isDevtoolsContextMenuRejection,
} from "./devtoolsContextMenuGuard";

describe("devtools 原生右键菜单 rejection 过滤", () => {
  it("只匹配 show_context_menu 相关的失败", () => {
    expect(
      isDevtoolsContextMenuRejection("Command show_context_menu not found"),
    ).toBe(true);
    expect(
      isDevtoolsContextMenuRejection(
        new Error("Command plugin:devtools-app|show_context_menu not found"),
      ),
    ).toBe(true);
    expect(isDevtoolsContextMenuRejection("Command git_status not found")).toBe(
      false,
    );
    expect(isDevtoolsContextMenuRejection(undefined)).toBe(false);
    expect(isDevtoolsContextMenuRejection(null)).toBe(false);
  });

  it("吞掉命中的 rejection，并放行其它 rejection", () => {
    const target = {
      addEventListener: vi.fn(),
      removeEventListener: vi.fn(),
    } as unknown as Window;

    const dispose = installDevtoolsContextMenuRejectionGuard(target);

    expect(target.addEventListener).toHaveBeenCalledTimes(1);
    const [type, handler] = (target.addEventListener as unknown as ReturnType<
      typeof vi.fn
    >).mock.calls[0];
    expect(type).toBe("unhandledrejection");

    const matched = {
      reason: "Command show_context_menu not found",
      preventDefault: vi.fn(),
    } as unknown as Event;
    (handler as (event: Event) => void)(matched);
    expect(
      (matched as unknown as { preventDefault: ReturnType<typeof vi.fn> })
        .preventDefault,
    ).toHaveBeenCalledTimes(1);

    const unrelated = {
      reason: "boom",
      preventDefault: vi.fn(),
    } as unknown as Event;
    (handler as (event: Event) => void)(unrelated);
    expect(
      (unrelated as unknown as { preventDefault: ReturnType<typeof vi.fn> })
        .preventDefault,
    ).not.toHaveBeenCalled();

    dispose();
    expect(target.removeEventListener).toHaveBeenCalledWith(
      "unhandledrejection",
      handler,
    );
  });
});
