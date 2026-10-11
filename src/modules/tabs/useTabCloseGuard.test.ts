import { describe, expect, it, vi } from "vitest";

import { useTabCloseGuard } from "./useTabCloseGuard";
import type { EditorTab, TerminalTab, Tab } from "./tabsTypes";

const warning = vi.hoisted(() => vi.fn());
vi.mock("naive-ui", async () => {
  const actual = await vi.importActual<typeof import("naive-ui")>("naive-ui");
  return { ...actual, useDialog: () => ({ warning }) };
});

function editor(id: number, path: string, dirty: boolean): EditorTab {
  return {
    id,
    workspaceId: "ws",
    kind: "editor",
    title: path,
    path,
    dirty,
    preview: false,
  };
}

function terminal(id: number): TerminalTab {
  return {
    id,
    workspaceId: "ws",
    kind: "terminal",
    title: "shell",
    paneTree: { kind: "leaf", id: id * 10 },
    activeLeafId: id * 10,
  };
}

function makeGuard() {
  warning.mockClear();
  return useTabCloseGuard();
}

describe("tab close guard", () => {
  it("closes a clean tab without asking", () => {
    const guard = makeGuard();
    const close = vi.fn();
    const tabs: Tab[] = [terminal(1), editor(2, "/a.ts", false)];

    guard.requestCloseTab(2, tabs, close);

    expect(close).toHaveBeenCalledWith(2);
    expect(warning).not.toHaveBeenCalled();
  });

  it("asks before discarding an unsaved editor", () => {
    const guard = makeGuard();
    const close = vi.fn();
    const tabs: Tab[] = [editor(1, "/a.ts", true)];

    guard.requestCloseTab(1, tabs, close);

    expect(close).not.toHaveBeenCalled();
    expect(warning).toHaveBeenCalledTimes(1);
    // 只有用户点了确认才真的关。
    warning.mock.calls[0]![0].onPositiveClick();
    expect(close).toHaveBeenCalledWith(1);
  });

  it("ignores an unknown tab id", () => {
    const guard = makeGuard();
    const close = vi.fn();
    guard.requestCloseTab(99, [], close);
    expect(close).not.toHaveBeenCalled();
    expect(warning).not.toHaveBeenCalled();
  });

  it("runs a batch close directly when nothing is dirty", () => {
    const guard = makeGuard();
    const close = vi.fn();
    const targets: Tab[] = [terminal(1), editor(2, "/a.ts", false)];

    guard.requestCloseMany({
      targets,
      title: "t",
      contentKey: "app.unsaved.closeFileContent",
      close,
    });

    expect(close).toHaveBeenCalledTimes(1);
    expect(warning).not.toHaveBeenCalled();
  });

  it("blocks a batch close that would discard unsaved editors", () => {
    const guard = makeGuard();
    const close = vi.fn();
    // 回归护栏：一次「关闭其他」丢掉两个未保存文件是本项目唯一一条
    // 确定性的数据丢失路径 —— 鼠标 ✕ / 右键菜单 / 命令面板都走这里。
    const targets: Tab[] = [terminal(1), editor(2, "/a.ts", true), editor(3, "/b.ts", true)];

    guard.requestCloseMany({
      targets,
      title: "t",
      contentKey: "app.unsaved.closeFileContent",
      close,
    });

    expect(close).not.toHaveBeenCalled();
    expect(warning).toHaveBeenCalledTimes(1);
    warning.mock.calls[0]![0].onPositiveClick();
    expect(close).toHaveBeenCalledTimes(1);
  });

  it("never prompts for terminal tabs", () => {
    const guard = makeGuard();
    const close = vi.fn();
    guard.requestCloseMany({
      targets: [terminal(1), terminal(2), terminal(3)],
      title: "t",
      contentKey: "app.unsaved.closeFileContent",
      close,
    });
    expect(close).toHaveBeenCalledTimes(1);
    expect(warning).not.toHaveBeenCalled();
  });
});
