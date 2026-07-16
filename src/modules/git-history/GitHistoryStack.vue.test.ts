// @vitest-environment jsdom
import { mount } from "@vue/test-utils";
import { describe, expect, it, vi } from "vitest";
import GitHistoryStack from "./GitHistoryStack.vue";
import type { Tab } from "@/modules/tabs/tabsTypes";

vi.mock("./GitHistoryPane.vue", () => ({
  default: {
    props: ["repoRoot", "refName", "allRefs"],
    emits: ["openCommitFile"],
    template:
      '<section data-git-history-pane data-repo-root="repoRoot" data-ref-name="refName" data-all-refs="allRefs">{{ repoRoot }}|{{ refName ?? "NONE" }}|{{ String(allRefs) }}<button data-open-commit-file @click="$emit(\'openCommitFile\', { repoRoot, sha: \'abcdef\', shortSha: \'abcdef1\', subject: \'Change\', path: \'src/main.ts\', originalPath: null })">open</button></section>',
  },
}));

const tabs: Tab[] = [
  {
    id: 1,
    kind: "terminal",
    title: "shell",
    paneTree: { kind: "leaf", id: 2 },
    activeLeafId: 2,
  },
  {
    id: 3,
    kind: "git-history",
    title: "History",
    repoRoot: "/repo",
    refName: null,
    allRefs: false,
  },
  {
    id: 4,
    kind: "git-history",
    title: "All branches",
    repoRoot: "/repo",
    refName: null,
    allRefs: true,
  },
  {
    id: 5,
    kind: "git-history",
    title: "History · feature/x",
    repoRoot: "/repo",
    refName: "feature/x",
    allRefs: false,
  },
];

describe("GitHistoryStack.vue", () => {
  it("renders the active git history tab and forwards file diff requests", async () => {
    const wrapper = mount(GitHistoryStack, {
      props: { tabs, activeId: 3 },
    });

    const pane = wrapper.find("[data-git-history-pane]");
    expect(pane.exists()).toBe(true);
    expect(pane.text()).toContain("/repo");

    await wrapper.find("[data-open-commit-file]").trigger("click");

    expect(wrapper.emitted("openCommitFile")).toEqual([
      [
        {
          repoRoot: "/repo",
          sha: "abcdef",
          shortSha: "abcdef1",
          subject: "Change",
          path: "src/main.ts",
          originalPath: null,
        },
      ],
    ]);
  });

  it("renders nothing for non-history tabs", () => {
    const wrapper = mount(GitHistoryStack, {
      props: { tabs, activeId: 1 },
    });

    expect(wrapper.find("[data-git-history-pane]").exists()).toBe(false);
  });

  it("forwards refName and allRefs to the active history pane", () => {
    const featureWrapper = mount(GitHistoryStack, {
      props: { tabs, activeId: 5 },
    });
    expect(featureWrapper.find("[data-git-history-pane]").text()).toContain(
      "/repo|feature/x|false",
    );

    const allRefsWrapper = mount(GitHistoryStack, {
      props: { tabs, activeId: 4 },
    });
    expect(allRefsWrapper.find("[data-git-history-pane]").text()).toContain(
      "/repo|NONE|true",
    );

    const defaultWrapper = mount(GitHistoryStack, {
      props: { tabs, activeId: 3 },
    });
    expect(defaultWrapper.find("[data-git-history-pane]").text()).toContain(
      "/repo|NONE|false",
    );
  });
});
