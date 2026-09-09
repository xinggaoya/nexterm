// @vitest-environment jsdom
import { flushPromises, mount } from "@vue/test-utils";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import type { FsGrepHit, WorkspaceNative } from "@/lib/native";

const fsGrep = vi.fn();

vi.mock("@/app/workspaceContext", () => ({
  useWorkspaceContext: () => ({
    workspace: {
      id: "local:/repo",
      rootPath: "/repo",
      env: { kind: "local" },
      name: "repo",
      openedAt: 0,
    },
    wsNative: { fsGrep } as unknown as WorkspaceNative,
  }),
}));

vi.mock("@/modules/explorer/lib/iconResolver", () => ({
  fileIconUrl: vi.fn(() => "file-icon.png"),
  folderIconUrl: vi.fn(() => "folder-icon.png"),
}));

import FindInFilesPanel from "./FindInFilesPanel.vue";

const DEBOUNCE_MS = 250;

function hit(path: string, rel: string, line: number, text: string): FsGrepHit {
  return { path, rel, line, text };
}

/** 输入 pattern 并推进防抖计时,返回时 mock 已被调用。 */
async function search(
  wrapper: ReturnType<typeof mountFindPanel>,
  pattern: string,
) {
  await wrapper.find("[data-find-input]").setValue(pattern);
  vi.advanceTimersByTime(DEBOUNCE_MS + 1);
  await flushPromises();
}

function mountFindPanel() {
  return mount(FindInFilesPanel, { props: { rootPath: "/repo" } });
}

beforeEach(() => {
  vi.useFakeTimers();
  fsGrep.mockReset();
  fsGrep.mockResolvedValue({ hits: [], truncated: false, filesScanned: 0 });
});

afterEach(() => {
  vi.useRealTimers();
});

describe("FindInFilesPanel.vue", () => {
  it("默认纯文本模式:元字符转义后传给 fsGrep", async () => {
    const wrapper = mountFindPanel();
    await search(wrapper, "foo(bar");
    expect(fsGrep).toHaveBeenCalledWith("foo\\(bar", "/repo", {
      glob: undefined,
      caseInsensitive: false,
    });
  });

  it("正则开关打开后 pattern 原样透传", async () => {
    const wrapper = mountFindPanel();
    await wrapper.find("[data-find-regex]").trigger("click");
    await search(wrapper, "foo\\d+");
    expect(fsGrep).toHaveBeenLastCalledWith("foo\\d+", "/repo", {
      glob: undefined,
      caseInsensitive: false,
    });
  });

  it("Enter 立即执行:取消防抖只搜一次", async () => {
    const wrapper = mountFindPanel();
    await wrapper.find("[data-find-input]").setValue("now");
    await wrapper.find("[data-find-input]").trigger("keydown.enter.prevent");
    expect(fsGrep).toHaveBeenCalledTimes(1);
    vi.advanceTimersByTime(DEBOUNCE_MS + 1);
    await flushPromises();
    expect(fsGrep).toHaveBeenCalledTimes(1);
  });

  it("交错命中按文件聚合,行号排序,组头显示命中数", async () => {
    // 后端并行遍历,不同文件的命中会交错到达。
    fsGrep.mockResolvedValue({
      hits: [
        hit("/repo/a.ts", "a.ts", 2, "foo second"),
        hit("/repo/b.ts", "b.ts", 1, "foo only"),
        hit("/repo/a.ts", "a.ts", 1, "foo first"),
      ],
      truncated: false,
      filesScanned: 9,
    });
    const wrapper = mountFindPanel();
    await search(wrapper, "foo");

    const groups = wrapper.findAll("[data-find-group]");
    expect(groups).toHaveLength(2);
    expect(groups[0]!.text()).toContain("a.ts");
    // 组头徽标显示该文件命中数。
    expect(groups[0]!.find("[data-find-group-toggle]").text()).toContain("2");
    // 组内行号升序。
    const lines = groups[0]!.findAll("[data-find-hit]");
    expect(lines.map((line) => line.find("[data-find-line]").text())).toEqual([
      "1",
      "2",
    ]);
  });

  it("命中行内高亮匹配片段", async () => {
    fsGrep.mockResolvedValue({
      hits: [hit("/repo/a.ts", "a.ts", 3, "hello Foo world")],
      truncated: false,
      filesScanned: 1,
    });
    const wrapper = mountFindPanel();
    await search(wrapper, "Foo");
    const line = wrapper.find("[data-find-hit]");
    expect(line.find("mark").text()).toBe("Foo");
    expect(line.text()).toContain("hello");
  });

  it("点击组头折叠该文件结果,再点展开", async () => {
    fsGrep.mockResolvedValue({
      hits: [hit("/repo/a.ts", "a.ts", 1, "foo")],
      truncated: false,
      filesScanned: 1,
    });
    const wrapper = mountFindPanel();
    await search(wrapper, "foo");
    expect(wrapper.findAll("[data-find-hit]")).toHaveLength(1);

    await wrapper.find("[data-find-group-toggle]").trigger("click");
    expect(wrapper.findAll("[data-find-hit]")).toHaveLength(0);

    await wrapper.find("[data-find-group-toggle]").trigger("click");
    expect(wrapper.findAll("[data-find-hit]")).toHaveLength(1);
  });

  it("后端正则错误收敛为可读提示", async () => {
    fsGrep.mockRejectedValue("bad regex: missing closing )");
    const wrapper = mountFindPanel();
    await wrapper.find("[data-find-regex]").trigger("click");
    await search(wrapper, "foo(");
    // 测试环境 i18n 落在 en-US 文案上;关键是不再透出后端原始错误串。
    expect(wrapper.text()).toContain("Invalid regular expression");
    expect(wrapper.text()).not.toContain("bad regex");
  });

  it("点击结果行发出 open-result 并带行号", async () => {
    fsGrep.mockResolvedValue({
      hits: [hit("/repo/a.ts", "a.ts", 7, "foo")],
      truncated: false,
      filesScanned: 1,
    });
    const wrapper = mountFindPanel();
    await search(wrapper, "foo");
    await wrapper.find("[data-find-hit]").trigger("click");
    expect(wrapper.emitted("open-result")).toEqual([["/repo/a.ts", 7]]);
  });
});
