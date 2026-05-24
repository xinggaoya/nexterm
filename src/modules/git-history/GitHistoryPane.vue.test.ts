// @vitest-environment jsdom
import { mount } from "@vue/test-utils";
import { nextTick } from "vue";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import GitHistoryPane from "./GitHistoryPane.vue";
import { writeClipboardText } from "@/lib/clipboard";
import { native } from "@/lib/native";

vi.mock("@/lib/native", () => ({
  native: {
    gitLog: vi.fn(),
    gitCommitFiles: vi.fn(),
    gitRemoteUrl: vi.fn(),
  },
}));

vi.mock("@/lib/clipboard", () => ({
  writeClipboardText: vi.fn(async () => undefined),
}));

async function flush() {
  await Promise.resolve();
  await nextTick();
}

describe("GitHistoryPane.vue", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    vi.mocked(native.gitLog).mockResolvedValue([
      {
        sha: "abcdef123456",
        shortSha: "abcdef1",
        author: "Ada Lovelace",
        authorEmail: "ada@example.com",
        timestampSecs: 1_700_000_000,
        parents: ["parent1"],
        subject: "Add terminal panes",
        filesChanged: 2,
        insertions: 12,
        deletions: 3,
      },
    ]);
    vi.mocked(native.gitCommitFiles).mockResolvedValue([
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
    vi.mocked(native.gitRemoteUrl).mockResolvedValue(null);
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

    expect(native.gitLog).toHaveBeenCalledWith("/repo", { limit: 30 });
    expect(wrapper.find("[data-git-history]").exists()).toBe(true);
    expect(wrapper.text()).toContain("abcdef1");
    expect(wrapper.text()).toContain("Add terminal panes");
    expect(wrapper.text()).toContain("Ada Lovelace");
    expect(wrapper.text()).toContain("+12");
    expect(wrapper.text()).toContain("-3");
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

    expect(native.gitCommitFiles).toHaveBeenCalledWith("/repo", "abcdef123456");
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
          subject: "Add terminal panes",
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
});
