import { afterEach, describe, expect, it, vi } from "vitest";
import {
  bindNotificationApi,
  notifyError,
  notifyInfo,
  notifySuccess,
} from "./notificationCenter";

describe("notificationCenter", () => {
  afterEach(() => {
    bindNotificationApi(null);
  });

  it("routes app notifications through the bound Naive UI API", () => {
    const create = vi.fn();
    bindNotificationApi({ create } as never);

    notifySuccess("Pull complete", "3 files changed, +24 -6");
    notifyInfo("Fetching", "origin/main");

    expect(create).toHaveBeenNthCalledWith(1, {
      type: "success",
      title: "Pull complete",
      content: "3 files changed, +24 -6",
      duration: 4500,
      keepAliveOnHover: true,
    });
    expect(create).toHaveBeenNthCalledWith(2, {
      type: "info",
      title: "Fetching",
      content: "origin/main",
      duration: 4500,
      keepAliveOnHover: true,
    });
  });

  it("normalizes errors before showing failure notifications", () => {
    const create = vi.fn();
    bindNotificationApi({ create } as never);

    notifyError("Git Pull failed", { message: "no upstream configured" });

    expect(create).toHaveBeenCalledWith({
      type: "error",
      title: "Git Pull failed",
      content: "no upstream configured",
      duration: 6500,
      keepAliveOnHover: true,
    });
  });
});
