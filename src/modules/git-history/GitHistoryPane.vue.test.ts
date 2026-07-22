// @vitest-environment jsdom
import { mount } from "@vue/test-utils";
import { nextTick } from "vue";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import GitHistoryPane from "./GitHistoryPane.vue";
import { writeClipboardText } from "@/lib/clipboard";

// 多工作区重构后，GitHistoryPane 通过 useWorkspaceContext() 获取 wsNative，
// 所有 git native 调用都走 wsNative（不再是全局 native 对象）。
// 测试不挂载 WorkspaceHost，因此 mock 该 composable 返回固定值。
const mockWsNative = {
  gitLog: vi.fn(),
  gitCommitFiles: vi.fn(),
  gitRemoteUrl: vi.fn(),
  gitBranchList: vi.fn(),
};
vi.mock("@/app/workspaceContext", () => ({
  useWorkspaceContext: () => ({
    workspace: {
      id: "local:/repo",
      rootPath: "/repo",
      env: { kind: "local" },
      name: "repo",
      openedAt: 0,
    },
    wsNative: mockWsNative,
  }),
}));

vi.mock("@/lib/clipboard", () => ({
  writeClipboardText: vi.fn(async () => undefined),
}));

async function flush() {
  for (let i = 0; i < 4; i += 1) {
    await Promise.resolve();
    await nextTick();
  }
}

function makeCommit(sha: string, refs: { name: string; kind: string; isHead: boolean }[] = []) {
  return {
    sha,
    shortSha: sha.slice(0, 7),
    author: "Ada Lovelace",
    authorEmail: "ada@example.com",
    timestampSecs: 1_700_000_000,
    parents: ["parent1"],
    subject: `Commit ${sha}`,
    filesChanged: 1,
    insertions: 4,
    deletions: 1,
    refs,
  };
}

describe("GitHistoryPane.vue", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    vi.mocked(mockWsNative.gitLog).mockResolvedValue({
      entries: [makeCommit("abcdef123456")],
      hasMore: false,
    });
    vi.mocked(mockWsNative.gitCommitFiles).mockResolvedValue([
      {
        path: "src/main.ts",
        originalPath: null,
        status: "M",
        statusLabel: "Modified",
        added: 8,
        removed: 2,
        isBinary: false,
      },
    ]);
    vi.mocked(mockWsNative.gitRemoteUrl).mockResolvedValue(null);
    vi.mocked(mockWsNative.gitBranchList).mockResolvedValue([
      { name: "main", isCurrent: true, isRemote: false, upstream: null },
      { name: "feature/x", isCurrent: false, isRemote: false, upstream: null },
    ]);
  });

  afterEach(() => {
    document.body.innerHTML = "";
  });

  it("loads commit history and renders a compact table", async () => {
    const wrapper = mount(GitHistoryPane, {
      props: {
        repoRoot: "/repo",
      },
    });
    await flush();

    expect(mockWsNative.gitLog).toHaveBeenLastCalledWith("/repo", {
      limit: 30,
      offset: 0,
      refName: null,
      all: false,
    });
    expect(wrapper.find("[data-git-history]").exists()).toBe(true);
    expect(wrapper.text()).toContain("abcdef1");
    expect(wrapper.text()).toContain("Commit abcdef123456");
    expect(wrapper.text()).toContain("Ada Lovelace");
    expect(wrapper.text()).toContain("+4");
    expect(wrapper.text()).toContain("-1");
  });

  it("opens commit details in a drawer and emits a commit-file open request", async () => {
    const wrapper = mount(GitHistoryPane, {
      props: {
        repoRoot: "/repo",
      },
    });
    await flush();

    await wrapper.find("[data-commit-row='abcdef123456']").trigger("click");
    await flush();

    expect(mockWsNative.gitCommitFiles).toHaveBeenCalledWith("/repo", "abcdef123456");
    expect(wrapper.find("[data-commit-file='src/main.ts']").exists()).toBe(false);

    const drawer = document.body.querySelector("[data-commit-detail-drawer]");
    expect(drawer?.textContent).toContain("main.ts");
    expect(drawer?.textContent).toContain("src");

    const fileButton = document.body.querySelector<HTMLElement>(
      "[data-commit-file='src/main.ts']",
    );
    expect(fileButton).not.toBeNull();

    fileButton?.click();
    await flush();

    expect(wrapper.emitted("openCommitFile")).toEqual([
      [
        {
          repoRoot: "/repo",
          sha: "abcdef123456",
          shortSha: "abcdef1",
          subject: "Commit abcdef123456",
          path: "src/main.ts",
          originalPath: null,
        },
      ],
    ]);
  });

  it("copies commit SHAs through the shared clipboard adapter", async () => {
    const wrapper = mount(GitHistoryPane, {
      props: {
        repoRoot: "/repo",
      },
    });
    await flush();

    await wrapper.find("[data-commit-row='abcdef123456']").trigger("click");
    await flush();

    document
      .body
      .querySelector<HTMLButtonElement>("button[aria-label='Copy SHA']")
      ?.click();
    await flush();

    expect(writeClipboardText).toHaveBeenCalledWith("abcdef123456");
  });

  it("refetches when the refName prop changes", async () => {
    const wrapper = mount(GitHistoryPane, {
      props: { repoRoot: "/repo", refName: "main" },
    });
    await flush();

    expect(mockWsNative.gitLog).toHaveBeenLastCalledWith("/repo", {
      limit: 30,
      offset: 0,
      refName: "main",
      all: false,
    });

    await wrapper.setProps({ refName: "feature/x" });
    await flush();

    expect(mockWsNative.gitLog).toHaveBeenLastCalledWith("/repo", {
      limit: 30,
      offset: 0,
      refName: "feature/x",
      all: false,
    });
  });

  it("loads the next page when Load more is clicked and stops on hasMore=false", async () => {
    vi.mocked(mockWsNative.gitLog)
      .mockReset()
      .mockResolvedValueOnce({
        entries: [makeCommit("aaaaaaa1")],
        hasMore: true,
      })
      .mockResolvedValueOnce({
        entries: [makeCommit("aaaaaaa2")],
        hasMore: false,
      });

    const wrapper = mount(GitHistoryPane, { props: { repoRoot: "/repo" } });
    await flush();

    expect(mockWsNative.gitLog).toHaveBeenLastCalledWith("/repo", {
      limit: 30,
      offset: 0,
      refName: null,
      all: false,
    });
    expect(wrapper.find("[data-commit-row='aaaaaaa1']").exists()).toBe(true);
    expect(wrapper.find("[data-load-more]").exists()).toBe(true);

    await wrapper.find("[data-load-more]").trigger("click");
    await flush();

    expect(mockWsNative.gitLog).toHaveBeenLastCalledWith("/repo", {
      limit: 30,
      offset: 30,
      refName: null,
      all: false,
    });
    expect(wrapper.find("[data-commit-row='aaaaaaa1']").exists()).toBe(true);
    expect(wrapper.find("[data-commit-row='aaaaaaa2']").exists()).toBe(true);
    expect(wrapper.find("[data-load-more]").exists()).toBe(false);
  });

  it("deduplicates appended commits by sha", async () => {
    vi.mocked(mockWsNative.gitLog)
      .mockReset()
      .mockResolvedValueOnce({
        entries: [makeCommit("aaaaaaa1"), makeCommit("aaaaaaa2")],
        hasMore: true,
      })
      .mockResolvedValueOnce({
        entries: [makeCommit("aaaaaaa1"), makeCommit("aaaaaaa3")],
        hasMore: false,
      });

    const wrapper = mount(GitHistoryPane, { props: { repoRoot: "/repo" } });
    await flush();

    await wrapper.find("[data-load-more]").trigger("click");
    await flush();

    const rows = wrapper.findAll("[data-commit-row]");
    const shas = rows.map((row) => row.attributes("data-commit-row"));
    expect(shas).toEqual(["aaaaaaa1", "aaaaaaa2", "aaaaaaa3"]);
  });

  it("cancels in-flight requests when the ref changes mid-load", async () => {
    const deferred: {
      resolve?: (value: {
        entries: ReturnType<typeof makeCommit>[];
        hasMore: boolean;
      }) => void;
    } = {};
    vi.mocked(mockWsNative.gitLog)
      .mockReset()
      .mockImplementationOnce(
        () =>
          new Promise<{ entries: ReturnType<typeof makeCommit>[]; hasMore: boolean }>(
            (resolve) => {
              deferred.resolve = resolve;
            },
          ),
      )
      .mockResolvedValueOnce({
        entries: [makeCommit("bbbbbbb1")],
        hasMore: false,
      });

    const wrapper = mount(GitHistoryPane, {
      props: { repoRoot: "/repo", refName: "main" },
    });
    await flush();

    await wrapper.setProps({ refName: "feature/x" });
    await flush();

    deferred.resolve!({ entries: [makeCommit("ccccccc1")], hasMore: false });
    await flush();

    expect(wrapper.find("[data-commit-row='bbbbbbb1']").exists()).toBe(true);
    expect(wrapper.find("[data-commit-row='ccccccc1']").exists()).toBe(false);
  });

  it("renders refs badges with NTag beside the subject", async () => {
    vi.mocked(mockWsNative.gitLog).mockReset().mockResolvedValueOnce({
      entries: [
        makeCommit("aaaaaaa1", [
          { name: "main", kind: "branch", isHead: true },
          { name: "v1.0", kind: "tag", isHead: false },
        ]),
      ],
      hasMore: false,
    });

    const wrapper = mount(GitHistoryPane, { props: { repoRoot: "/repo" } });
    await flush();

    const row = wrapper.find("[data-commit-row='aaaaaaa1']");
    expect(row.exists()).toBe(true);
    expect(row.text()).toContain("main");
    expect(row.text()).toContain("v1.0");
    expect(row.find("[data-ref-badge]").exists()).toBe(true);
  });
});
