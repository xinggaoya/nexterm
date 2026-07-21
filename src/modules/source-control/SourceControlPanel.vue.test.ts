// @vitest-environment jsdom
import { mount } from "@vue/test-utils";
import { h, nextTick, ref, type VNodeChild } from "vue";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import SourceControlPanel from "./SourceControlPanel.vue";
import SourceControlToolbar from "./SourceControlToolbar.vue";
import { native, type GitChangedFile } from "@/lib/native";

// NVirtualList (and the underlying vueuc virtual list) probes
// `window.matchMedia` for pointer / touch capability detection and
// `ResizeObserver` to measure the viewport, both of which are missing
// from jsdom. We install minimal stubs before any component under test
// imports the virtual list.
if (typeof window !== "undefined" && typeof window.matchMedia !== "function") {
  Object.defineProperty(window, "matchMedia", {
    configurable: true,
    writable: true,
    value: (query: string) => ({
      matches: false,
      media: query,
      onchange: null,
      addEventListener: () => {},
      removeEventListener: () => {},
      addListener: () => {},
      removeListener: () => {},
      dispatchEvent: () => false,
    }),
  });
}
if (
  typeof window !== "undefined" &&
  typeof (window as unknown as { ResizeObserver?: unknown }).ResizeObserver !==
    "function"
) {
  (window as unknown as { ResizeObserver: unknown }).ResizeObserver = class {
    constructor(_callback: ResizeObserverCallback) {}
    observe() {}
    unobserve() {}
    disconnect() {}
  };
}

// jsdom reports layout properties (`clientHeight`, `offsetHeight`, etc.)
// as 0 for every element, so the virtual list thinks it has no viewport
// and renders nothing. Patch the prototype so the list measures a
// realistic viewport and the test selectors can find the rendered rows.
if (typeof window !== "undefined") {
  const proto = (window as unknown as { HTMLElement: { prototype: HTMLElement } })
    .HTMLElement.prototype as unknown as Record<string, unknown>;
  Object.defineProperty(proto, "clientHeight", {
    configurable: true,
    get() {
      return 600;
    },
  });
  Object.defineProperty(proto, "clientWidth", {
    configurable: true,
    get() {
      return 320;
    },
  });
  Object.defineProperty(proto, "offsetHeight", {
    configurable: true,
    get() {
      return 600;
    },
  });
  Object.defineProperty(proto, "offsetWidth", {
    configurable: true,
    get() {
      return 320;
    },
  });
  Object.defineProperty(proto, "getClientRects", {
    configurable: true,
    value() {
      return [{ top: 0, left: 0, right: 320, bottom: 600, width: 320, height: 600 }];
    },
  });
  Object.defineProperty(proto, "getBoundingClientRect", {
    configurable: true,
    value() {
      return {
        width: 320,
        height: 600,
        top: 0,
        left: 0,
        right: 320,
        bottom: 600,
        x: 0,
        y: 0,
        toJSON: () => ({}),
      };
    },
  });
}

const dialogConfirmMock = vi.hoisted(() => vi.fn());
const dropdownSelectMock = vi.hoisted(() => vi.fn());

vi.mock("naive-ui", async () => {
  const actual = await vi.importActual<typeof import("naive-ui")>("naive-ui");
  return {
    ...actual,
    NDropdown: {
      props: ["options", "trigger", "placement"],
      emits: ["select"],
      setup(
        _props: { options: Array<{ key: string }> },
        {
          emit,
          slots,
        }: {
          emit: (event: string, key: string) => void;
          slots: { default?: () => VNodeChild };
        },
      ) {
        dropdownSelectMock.mockImplementation((key: string) => emit("select", key));
        return () => h("div", { "data-dropdown-mock": "" }, slots.default?.() ?? []);
      },
    },
    NSelect: {
      name: "NSelectMock",
      props: ["value", "options", "renderLabel"],
      emits: ["update:value"],
      setup(
        selectProps: {
          options: Array<{ label: string; value: string }>;
          renderLabel?: (option: { label: string; value: string }) => VNodeChild;
        },
        { emit }: { emit: (event: string, value: string) => void },
      ) {
        return () =>
          h(
            "div",
            { "data-repository-selector-mock": "" },
            selectProps.options.map((option) =>
              h(
                "button",
                {
                  type: "button",
                  "data-repository-option": option.value,
                  onClick: () => emit("update:value", option.value),
                },
                selectProps.renderLabel?.(option) ?? option.label,
              ),
            ),
          );
      },
    },
    // The full NVirtualList is a vueuc-backed list that only renders rows
    // after a ResizeObserver round-trip. In jsdom that requires rAF +
    // MutationObserver to fire (and a couple of polyfills above). The
    // tests in this file frequently use `vi.useFakeTimers()` which
    // freezes rAF, so the list would never paint and every
    // `[data-source-file]` / `[data-stage-file]` selector would come
    // back empty. Substitute a plain div that just iterates the items
    // via the default slot — it covers the data and event contract we
    // care about without any viewport measurement.
    NVirtualList: {
      name: "NVirtualListMock",
      props: ["items", "itemSize", "itemResizable"],
      setup(_props: { items: unknown[] }, { slots }: { slots: { default?: (ctx: { item: unknown }) => VNodeChild } }) {
        return () =>
          h(
            "div",
            { "data-virtual-list-mock": "" },
            (_props.items as unknown[]).map((item, index) =>
              h(
                "div",
                { key: index, "data-virtual-list-row": String(index) },
                slots.default?.({ item }) ?? [],
              ),
            ),
          );
      },
    },
    useDialog: () => ({
      warning: dialogConfirmMock,
    }),
  };
});

vi.mock("@/lib/native", () => ({
  native: {
    workspaceAuthorize: vi.fn(),
    gitDiscoverRepositories: vi.fn(),
    gitPanelSnapshot: vi.fn(),
    gitStatus: vi.fn(),
    gitStage: vi.fn(),
    gitUnstage: vi.fn(),
    gitDiscard: vi.fn(),
    gitCommit: vi.fn(),
    gitFetch: vi.fn(),
    gitPullFfOnly: vi.fn(),
    gitPush: vi.fn(),
    gitBranchList: vi.fn(),
    gitCheckoutBranch: vi.fn(),
    gitCreateBranch: vi.fn(),
    gitStashList: vi.fn(),
    gitStashPush: vi.fn(),
    gitStashPop: vi.fn(),
    gitStashDrop: vi.fn(),
    gitStashApply: vi.fn(),
  },
}));

async function flush() {
  for (let i = 0; i < 3; i += 1) {
    await Promise.resolve();
    await nextTick();
  }
  // `NVirtualList` measures the viewport through a juggle/resize-observer
  // round trip that uses MutationObserver + requestAnimationFrame. In
  // jsdom none of those are wired up to fire synchronously, so we
  // drain a couple of animation frames to let the viewport height
  // settle. We only do this when fake timers are *not* in use, since
  // `vi.useFakeTimers` (used by some tests in this file) freezes
  // rAF/setTimeout and would otherwise deadlock.
  if (
    typeof vi.isFakeTimers === "function" &&
    !vi.isFakeTimers() &&
    typeof requestAnimationFrame === "function"
  ) {
    for (let i = 0; i < 3; i += 1) {
      await new Promise((resolve) => requestAnimationFrame(() => resolve(null)));
      await nextTick();
    }
  }
}

function file(overrides: Partial<GitChangedFile> & Pick<GitChangedFile, "path">): GitChangedFile {
  return {
    originalPath: null,
    indexStatus: " ",
    worktreeStatus: " ",
    staged: false,
    unstaged: false,
    untracked: false,
    statusLabel: "Modified",
    ...overrides,
  };
}

function mockSnapshotFiles(changedFiles: GitChangedFile[]) {
  vi.mocked(native.gitPanelSnapshot).mockResolvedValue({
    repo: {
      repoRoot: "/repo",
      branch: "main",
      upstream: "origin/main",
      isDetached: false,
    },
    status: {
      repoRoot: "/repo",
      branch: "main",
      upstream: "origin/main",
      ahead: 1,
      behind: 0,
      isDetached: false,
      truncated: false,
      changedFiles,
    },
  });
}

function panelProps(overrides: Record<string, unknown> = {}) {
  return { rootPath: "/repo", showBranchesModal: ref(false), ...overrides };
}

describe("SourceControlPanel.vue", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    dialogConfirmMock.mockReset();
    dropdownSelectMock.mockReset();
    vi.mocked(native.workspaceAuthorize).mockResolvedValue("/repo");
    vi.mocked(native.gitDiscoverRepositories).mockResolvedValue({
      repositories: [
        {
          repoRoot: "/repo",
          relativePath: ".",
          name: "repo",
          branch: "main",
          upstream: "origin/main",
          isDetached: false,
          isWorktree: false,
        },
      ],
      truncated: false,
    });
    mockSnapshotFiles([
      file({
        path: "src/main.ts",
        worktreeStatus: "M",
        unstaged: true,
      }),
    ]);
    vi.mocked(native.gitStatus).mockResolvedValue({
      repoRoot: "/repo",
      branch: "main",
      upstream: "origin/main",
      ahead: 1,
      behind: 0,
      isDetached: false,
      truncated: false,
      changedFiles: [],
    });
    vi.mocked(native.gitBranchList).mockResolvedValue([
      {
        name: "main",
        upstream: "origin/main",
        isCurrent: true,
        isRemote: false,
      },
      {
        name: "feature/git-ui",
        upstream: null,
        isCurrent: false,
        isRemote: false,
      },
      {
        name: "origin/release",
        upstream: null,
        isCurrent: false,
        isRemote: true,
      },
    ]);
    vi.mocked(native.gitStashList).mockResolvedValue([
      {
        selector: "stash@{0}",
        fullSha: "0123456789abcdef0123456789abcdef01234567",
        shortSha: "0123456",
        relativeTime: "2 hours ago",
        message: "WIP on main: source control",
      },
    ]);
  });

  afterEach(() => {
    vi.useRealTimers();
  });

  it("loads repository status and opens diffs/history", async () => {
    const wrapper = mount(SourceControlPanel, {
      props: { rootPath: "/repo" },
    });
    await flush();

    expect(native.workspaceAuthorize).toHaveBeenCalledWith("/repo");
    expect(native.gitPanelSnapshot).toHaveBeenCalledWith("/repo");
    expect(wrapper.text()).toContain("main");
    expect(wrapper.text()).toContain("src/main.ts");

    await wrapper.find("[data-source-file='src/main.ts']").trigger("click");
    await wrapper.find("[data-open-history]").trigger("click");

    expect(wrapper.emitted("openDiff")).toEqual([
      [
        {
          repoRoot: "/repo",
          path: "src/main.ts",
          mode: "-",
          originalPath: null,
          title: "src/main.ts",
        },
      ],
    ]);
    expect(wrapper.emitted("openHistory")).toEqual([
      [
        {
          repoRoot: "/repo",
          branch: "main",
          refName: "main",
          allRefs: false,
        },
      ],
    ]);
  });

  it("stages files and commits staged changes", async () => {
    vi.mocked(native.gitStage).mockResolvedValue(undefined);
    vi.mocked(native.gitCommit).mockResolvedValue({
      commitSha: "abcdef",
      summary: "fix: update main",
    });
    vi.mocked(native.gitStatus).mockResolvedValueOnce({
      repoRoot: "/repo",
      branch: "main",
      upstream: "origin/main",
      ahead: 1,
      behind: 0,
      isDetached: false,
      truncated: false,
      changedFiles: [
        {
          path: "src/main.ts",
          originalPath: null,
          indexStatus: "M",
          worktreeStatus: " ",
          staged: true,
          unstaged: false,
          untracked: false,
          statusLabel: "Modified",
        },
      ],
    });

    const wrapper = mount(SourceControlPanel, {
      props: { rootPath: "/repo" },
    });
    await flush();

    await wrapper.find("[data-stage-file='src/main.ts']").trigger("click");
    await flush();

    expect(native.gitStage).toHaveBeenCalledWith("/repo", ["src/main.ts"]);
    expect(wrapper.text()).toContain("Staged");

    await wrapper.find("[data-commit-message]").setValue("fix: update main");
    await wrapper.find("[data-commit]").trigger("click");
    await flush();

    expect(native.gitCommit).toHaveBeenCalledWith("/repo", "fix: update main");
    expect(wrapper.emitted("committed")).toEqual([
      [{ commitSha: "abcdef", summary: "fix: update main" }],
    ]);
  });

  it("stages and unstages all eligible files", async () => {
    vi.mocked(native.gitStage).mockResolvedValue(undefined);
    vi.mocked(native.gitUnstage).mockResolvedValue(undefined);
    mockSnapshotFiles([
      file({
        path: "src/staged.ts",
        indexStatus: "M",
        staged: true,
      }),
      file({
        path: "src/unstaged.ts",
        worktreeStatus: "M",
        unstaged: true,
      }),
      file({
        path: "src/new.ts",
        worktreeStatus: "?",
        unstaged: true,
        untracked: true,
        statusLabel: "Untracked",
      }),
      file({
        path: "src/mixed.ts",
        indexStatus: "M",
        worktreeStatus: "M",
        staged: true,
        unstaged: true,
      }),
    ]);

    const wrapper = mount(SourceControlPanel, {
      props: { rootPath: "/repo" },
    });
    await flush();

    await wrapper.find("[data-stage-all]").trigger("click");
    await flush();

    expect(native.gitStage).toHaveBeenCalledWith("/repo", [
      "src/unstaged.ts",
      "src/new.ts",
      "src/mixed.ts",
    ]);

    mockSnapshotFiles([
      file({
        path: "src/staged.ts",
        indexStatus: "M",
        staged: true,
      }),
      file({
        path: "src/mixed.ts",
        indexStatus: "M",
        worktreeStatus: "M",
        staged: true,
        unstaged: true,
      }),
    ]);

    const second = mount(SourceControlPanel, {
      props: { rootPath: "/repo" },
    });
    await flush();

    await second.find("[data-unstage-all]").trigger("click");
    await flush();

    expect(native.gitUnstage).toHaveBeenCalledWith("/repo", [
      "src/staged.ts",
      "src/mixed.ts",
    ]);
  });

  it("confirms before discarding single files and all unstaged changes", async () => {
    vi.mocked(native.gitDiscard).mockResolvedValue(undefined);
    const discardFiles = [
      file({
        path: "src/unstaged.ts",
        worktreeStatus: "M",
        unstaged: true,
      }),
      file({
        path: "src/new.ts",
        worktreeStatus: "?",
        unstaged: true,
        untracked: true,
        statusLabel: "Untracked",
      }),
      file({
        path: "src/staged.ts",
        indexStatus: "M",
        staged: true,
      }),
    ];
    mockSnapshotFiles(discardFiles);
    vi.mocked(native.gitStatus).mockResolvedValue({
      repoRoot: "/repo",
      branch: "main",
      upstream: "origin/main",
      ahead: 1,
      behind: 0,
      isDetached: false,
      truncated: false,
      changedFiles: discardFiles,
    });
    dialogConfirmMock.mockImplementation((options) => {
      void options.onPositiveClick();
    });

    const wrapper = mount(SourceControlPanel, {
      props: { rootPath: "/repo" },
    });
    await flush();

    await wrapper.find("[data-discard-file='src/unstaged.ts']").trigger("click");
    await flush();

    expect(dialogConfirmMock).toHaveBeenCalledWith(
      expect.objectContaining({
        title: "Discard changes?",
        positiveText: "Discard",
      }),
    );
    expect(native.gitDiscard).toHaveBeenCalledWith("/repo", [
      { path: "src/unstaged.ts", untracked: false },
    ]);

    await wrapper.find("[data-discard-all]").trigger("click");
    await flush();

    expect(native.gitDiscard).toHaveBeenLastCalledWith("/repo", [
      { path: "src/unstaged.ts", untracked: false },
      { path: "src/new.ts", untracked: true },
    ]);
  });

  it("runs fetch pull and push operations then refreshes status", async () => {
    vi.mocked(native.gitFetch).mockResolvedValue({
      updatedRefs: 1,
      prunedRefs: 0,
      summary: "1 ref updated",
    });
    vi.mocked(native.gitPullFfOnly).mockResolvedValue({
      filesChanged: 3,
      insertions: 24,
      deletions: 6,
      alreadyUpToDate: false,
      summary: "3 files changed, +24 -6",
    });
    vi.mocked(native.gitPush).mockResolvedValue({
      remote: "origin",
      branch: "main",
      pushed: true,
    });

    mount(SourceControlPanel, {
      props: { rootPath: "/repo" },
    });
    await flush();

    dropdownSelectMock("fetch");
    await flush();
    dropdownSelectMock("pull");
    await flush();
    dropdownSelectMock("push");
    await flush();

    expect(native.gitFetch).toHaveBeenCalledWith("/repo");
    expect(native.gitPullFfOnly).toHaveBeenCalledWith("/repo");
    expect(native.gitPush).toHaveBeenCalledWith("/repo");
    expect(native.gitStatus).toHaveBeenCalledTimes(3);
  });

  it("renders branch and stash workflows and runs selected actions", async () => {
    const fullSha = "0123456789abcdef0123456789abcdef01234567";
    vi.mocked(native.gitCheckoutBranch).mockResolvedValue({ branch: "feature/git-ui" });
    vi.mocked(native.gitCreateBranch).mockResolvedValue({ branch: "feature/new" });
    vi.mocked(native.gitStashPush).mockResolvedValue({
      stashed: true,
      message: "Saved working directory",
    });
    vi.mocked(native.gitStashApply).mockResolvedValue({
      stashed: true,
      message: "Applied stash@{0}",
    });
    vi.mocked(native.gitStashPop).mockResolvedValue({
      stashed: true,
      message: "Applied stash@{0}",
    });
    vi.mocked(native.gitStashDrop).mockResolvedValue({
      stashed: true,
      message: "Dropped stash@{0}",
    });

    const wrapper = mount(SourceControlPanel, { props: panelProps() });
    await flush();

    expect(native.gitBranchList).toHaveBeenCalledWith("/repo");
    expect(native.gitStashList).toHaveBeenCalledWith("/repo");
    expect(document.body.querySelector('[data-git-branch="feature/git-ui"]')).toBeNull();
    await wrapper.find("[data-open-branches]").trigger("click");
    await flush();
    expect(document.body.querySelector('[data-git-branch="feature/git-ui"]')).not.toBeNull();
    expect(document.body.textContent).toContain("WIP on main: source control");

    document.body.querySelector<HTMLButtonElement>("[data-git-stash-save]")?.click();
    await flush();
    document.body.querySelector<HTMLButtonElement>("[data-git-stash-submit]")?.click();
    await flush();
    expect(native.gitStashPush).toHaveBeenCalledWith("/repo", {
      message: null,
      includeUntracked: true,
      keepIndex: false,
    });

    document.body.querySelector<HTMLButtonElement>("[data-git-branch='feature/git-ui']")?.click();
    await flush();
    expect(native.gitCheckoutBranch).toHaveBeenCalledWith(
      "/repo",
      "feature/git-ui",
      false,
    );

    await wrapper.find("[data-open-branches]").trigger("click");
    await flush();

    const input = document.body.querySelector<HTMLInputElement>("[data-git-create-branch-input]");
    if (!input) throw new Error("create branch input is missing");
    const setter = Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, "value")?.set;
    setter?.call(input, "feature/new");
    input.dispatchEvent(new Event("input", { bubbles: true }));
    await nextTick();
    document.body
      .querySelector<HTMLButtonElement>("[data-git-create-branch-submit]")
      ?.dispatchEvent(new MouseEvent("click", { bubbles: true }));
    await flush();
    expect(native.gitCreateBranch).toHaveBeenCalledWith("/repo", "feature/new");

    document.body.querySelector<HTMLButtonElement>("[data-git-stash-apply='stash@{0}']")?.click();
    await flush();
    expect(native.gitStashApply).toHaveBeenCalledWith("/repo", "stash@{0}", fullSha);

    document.body.querySelector<HTMLButtonElement>("[data-git-stash-pop='stash@{0}']")?.click();
    await flush();
    expect(native.gitStashPop).toHaveBeenCalledWith("/repo", "stash@{0}", fullSha);

    dialogConfirmMock.mockImplementation(
      ({ onPositiveClick }: { onPositiveClick: () => void | Promise<void> }) =>
        onPositiveClick(),
    );
    document.body.querySelector<HTMLButtonElement>("[data-git-stash-drop='stash@{0}']")?.click();
    await flush();
    expect(native.gitStashDrop).toHaveBeenCalledWith("/repo", "stash@{0}", fullSha);
  });

  it("keeps the externally controlled modal open when checkout fails", async () => {
    const showBranchesModal = ref(false);
    vi.mocked(native.gitCheckoutBranch).mockRejectedValue(new Error("checkout failed"));
    const wrapper = mount(SourceControlPanel, {
      props: { rootPath: "/repo", showBranchesModal },
    });
    await flush();
    await wrapper.find("[data-open-branches]").trigger("click");
    await flush();
    document.body.querySelector<HTMLButtonElement>("[data-git-branch='feature/git-ui']")?.click();
    await flush();
    expect(showBranchesModal.value).toBe(true);
    expect(document.body.querySelector('[data-git-branch="feature/git-ui"]')).not.toBeNull();
  });

  it("shows detached in the branch button and still opens branch workflows", async () => {
    mockSnapshotFiles([]);
    vi.mocked(native.gitPanelSnapshot).mockResolvedValue({
      repo: {
        repoRoot: "/repo",
        branch: "abcdef1",
        upstream: null,
        isDetached: true,
      },
      status: {
        repoRoot: "/repo",
        branch: "abcdef1",
        upstream: null,
        ahead: 0,
        behind: 0,
        isDetached: true,
        truncated: false,
        changedFiles: [],
      },
    });
    const wrapper = mount(SourceControlPanel, { props: panelProps() });
    await flush();

    expect(wrapper.find("[data-open-branches]").text()).toContain("detached");
    await wrapper.find("[data-open-branches]").trigger("click");
    await flush();
    expect(document.body.querySelector('[data-git-branch="feature/git-ui"]')).not.toBeNull();
  });

  it("refreshes status for workspace file events", async () => {
    vi.useFakeTimers();
    const wrapper = mount(SourceControlPanel, {
      props: { rootPath: "/repo", fsEvent: null },
    });
    await flush();
    vi.mocked(native.gitStatus).mockClear();

    await wrapper.setProps({
      fsEvent: {
        rootPath: "/repo",
        paths: ["/repo/src/new.ts"],
        gitRelated: false,
      },
    });
    await vi.advanceTimersByTimeAsync(2000);
    await flush();

    expect(native.gitStatus).toHaveBeenCalledTimes(1);
    expect(native.gitStatus).toHaveBeenCalledWith("/repo");
    vi.useRealTimers();
  });

  it("refreshes status for git-related filesystem events", async () => {
    vi.useFakeTimers();
    const wrapper = mount(SourceControlPanel, {
      props: { rootPath: "/repo", fsEvent: null },
    });
    await flush();
    vi.mocked(native.gitStatus).mockClear();

    await wrapper.setProps({
      fsEvent: {
        rootPath: "/repo",
        paths: ["/repo/.git/index"],
        gitRelated: true,
      },
    });
    await vi.advanceTimersByTimeAsync(300);
    await flush();

    expect(native.gitStatus).toHaveBeenCalledTimes(1);
    expect(native.gitStatus).toHaveBeenCalledWith("/repo");
    vi.useRealTimers();
  });

  it("runs a pending auto refresh after a busy source control action finishes", async () => {
    vi.useFakeTimers();
    const deferredStage: { resolve?: () => void } = {};
    vi.mocked(native.gitStage).mockImplementation(
      () =>
        new Promise<void>((resolve) => {
          deferredStage.resolve = resolve;
        }),
    );

    const wrapper = mount(SourceControlPanel, {
      props: { rootPath: "/repo", fsEvent: null },
    });
    await flush();
    vi.mocked(native.gitStatus).mockClear();

    await wrapper.find("[data-stage-file='src/main.ts']").trigger("click");
    await wrapper.setProps({
      fsEvent: {
        rootPath: "/repo",
        paths: ["/repo/src/main.ts"],
        gitRelated: false,
      },
    });
    await vi.advanceTimersByTimeAsync(2000);
    await flush();

    expect(native.gitStatus).not.toHaveBeenCalled();

    if (!deferredStage.resolve) throw new Error("stage action did not start");
    deferredStage.resolve();
    await flush();
    expect(native.gitStatus).toHaveBeenCalledTimes(1);

    await vi.advanceTimersByTimeAsync(80);
    await flush();

    expect(native.gitStatus).toHaveBeenCalledTimes(2);
    vi.useRealTimers();
  });

  it("shows a hint when git status results are truncated", async () => {
    mockSnapshotFiles([
      file({
        path: "src/main.ts",
        worktreeStatus: "M",
        unstaged: true,
      }),
    ]);
    vi.mocked(native.gitPanelSnapshot).mockResolvedValueOnce({
      repo: {
        repoRoot: "/repo",
        branch: "main",
        upstream: "origin/main",
        isDetached: false,
      },
      status: {
        repoRoot: "/repo",
        branch: "main",
        upstream: "origin/main",
        ahead: 0,
        behind: 0,
        isDetached: false,
        truncated: true,
        changedFiles: [
          file({
            path: "src/main.ts",
            worktreeStatus: "M",
            unstaged: true,
          }),
        ],
      },
    });

    const wrapper = mount(SourceControlPanel, {
      props: { rootPath: "/repo" },
    });
    await flush();

    expect(wrapper.text()).toContain("Status results were truncated");
  });

  it("renders a compact repository selector and emits the selected root", async () => {
    vi.mocked(native.gitDiscoverRepositories).mockResolvedValue({
      repositories: [
        {
          repoRoot: "/workspace/apps/web",
          relativePath: "apps/web",
          name: "web",
          branch: "main",
          upstream: "origin/main",
          isDetached: false,
          isWorktree: false,
        },
        {
          repoRoot: "/workspace/packages/core",
          relativePath: "packages/core",
          name: "core",
          branch: "release",
          upstream: null,
          isDetached: true,
          isWorktree: false,
        },
      ],
      truncated: false,
    });

    const wrapper = mount(SourceControlPanel, {
      props: {
        rootPath: "/workspace",
        activeRepoRoot: "/workspace/apps/web",
      },
    });
    await flush();

    const selector = wrapper.find("[data-repository-selector]");
    expect(selector.exists()).toBe(true);
    expect(selector.text()).toContain("apps/web");
    expect(selector.text()).toContain("main");
    expect(selector.text()).toContain("packages/core");
    expect(selector.text()).toContain("detached");

    await wrapper
      .find("[data-repository-option='/workspace/packages/core']")
      .trigger("click");

    expect(wrapper.emitted("repo-selected")).toEqual([
      ["/workspace/packages/core"],
    ]);
  });

  it("selects the first discovered repository when the active root is invalid", async () => {
    vi.mocked(native.gitDiscoverRepositories).mockResolvedValue({
      repositories: [
        {
          repoRoot: "/workspace/repo-a",
          relativePath: "repo-a",
          name: "repo-a",
          branch: "main",
          upstream: null,
          isDetached: false,
          isWorktree: false,
        },
        {
          repoRoot: "/workspace/repo-b",
          relativePath: "repo-b",
          name: "repo-b",
          branch: "develop",
          upstream: null,
          isDetached: false,
          isWorktree: false,
        },
      ],
      truncated: false,
    });

    const wrapper = mount(SourceControlPanel, {
      props: {
        rootPath: "/workspace",
        activeRepoRoot: "/workspace/removed",
      },
    });
    await flush();

    expect(wrapper.emitted("repo-selected")).toEqual([
      ["/workspace/repo-a"],
    ]);
  });

  it("clears selected file keys when the active repository changes", async () => {
    const wrapper = mount(SourceControlPanel, {
      props: { rootPath: "/repo", activeRepoRoot: "/repo" },
    });
    await flush();

    const row = wrapper.findComponent({ name: "SourceControlChangeRow" });
    expect(row.exists()).toBe(true);
    row.vm.$emit("toggleEntrySelected", row.props("entry"), true);
    await nextTick();
    expect(
      wrapper.findComponent({ name: "SourceControlChangeRow" }).props("selected"),
    ).toBe(true);

    await wrapper.setProps({ activeRepoRoot: "/repo/other" });
    await flush();

    expect(
      wrapper.findComponent({ name: "SourceControlChangeRow" }).props("selected"),
    ).toBe(false);
  });

  it("clears the active repository when the next workspace discovery fails", async () => {
    vi.mocked(native.gitDiscoverRepositories).mockImplementation((root) => {
      if (root === "/workspace-a") {
        return Promise.resolve({
          repositories: [
            {
              repoRoot: "/workspace-a/repo",
              relativePath: "repo",
              name: "repo",
              branch: "main",
              upstream: null,
              isDetached: false,
              isWorktree: false,
            },
          ],
          truncated: false,
        });
      }
      return Promise.reject(new Error("workspace B discovery failed"));
    });

    const wrapper = mount(SourceControlPanel, {
      props: {
        rootPath: "/workspace-a",
        activeRepoRoot: "/workspace-a/repo",
      },
    });
    await flush();
    expect(wrapper.emitted("repo-selected")).toBeUndefined();

    await wrapper.setProps({ rootPath: "/workspace-b" });
    await flush();

    expect(wrapper.emitted("repo-selected")).toEqual([[null]]);
  });

  it("clears the active repository when only the workspace scope changes", async () => {
    vi.mocked(native.gitDiscoverRepositories)
      .mockResolvedValueOnce({
        repositories: [
          {
            repoRoot: "/workspace/repo",
            relativePath: "repo",
            name: "repo",
            branch: "main",
            upstream: null,
            isDetached: false,
            isWorktree: false,
          },
        ],
        truncated: false,
      })
      .mockRejectedValueOnce(new Error("WSL discovery failed"));

    const wrapper = mount(SourceControlPanel, {
      props: {
        rootPath: "/workspace",
        activeRepoRoot: "/workspace/repo",
        workspaceScope: "local",
      },
    });
    await flush();
    expect(wrapper.emitted("repo-selected")).toBeUndefined();

    await wrapper.setProps({ workspaceScope: "wsl:Ubuntu" });
    await flush();

    expect(native.gitDiscoverRepositories).toHaveBeenCalledTimes(2);
    expect(wrapper.emitted("repo-selected")).toEqual([[null]]);
  });

  it("does not change the toolbar layout for a single repository", async () => {
    const wrapper = mount(SourceControlPanel, {
      props: { rootPath: "/repo", activeRepoRoot: "/repo" },
    });
    await flush();

    expect(wrapper.find("[data-repository-selector]").exists()).toBe(false);
    expect(wrapper.findComponent(SourceControlToolbar).exists()).toBe(true);
  });
});
