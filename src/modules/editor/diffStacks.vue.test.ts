// @vitest-environment jsdom
import { mount } from "@vue/test-utils";
import { describe, expect, it, vi } from "vitest";
import GitDiffStack from "./GitDiffStack.vue";
import type { Tab } from "@/modules/tabs/tabsTypes";

vi.mock("./GitDiffPane.vue", () => ({
  default: {
    props: ["source", "chipLabel", "active"],
    template:
      '<section data-git-diff-pane>{{ source.kind }}:{{ source.path }}:{{ chipLabel ?? "" }}:{{ active }}</section>',
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
    kind: "git-diff",
    title: "main.ts",
    repoRoot: "/repo",
    path: "src/main.ts",
    mode: "+",
    originalPath: null,
  },
  {
    id: 4,
    kind: "git-commit-file",
    title: "commit main.ts",
    repoRoot: "/repo",
    sha: "abcdef",
    shortSha: "abc123",
    subject: "change",
    path: "src/main.ts",
    originalPath: null,
  },
];

describe("diff Vue stacks", () => {
  it("renders the active git diff tab", () => {
    const wrapper = mount(GitDiffStack, {
      props: { tabs, activeId: 4 },
    });

    expect(wrapper.find("[data-git-diff-pane]").text()).toContain(
      "commit:src/main.ts:abc123:true",
    );
  });
});
