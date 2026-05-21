// @vitest-environment jsdom
import { mount } from "@vue/test-utils";
import { describe, expect, it, vi } from "vitest";
import AiDiffStack from "./AiDiffStack.vue";
import GitDiffStack from "./GitDiffStack.vue";
import type { Tab } from "@/modules/tabs/tabsTypes";

vi.mock("./GitDiffPane.vue", () => ({
  default: {
    props: ["source", "chipLabel", "active"],
    template:
      '<section data-git-diff-pane>{{ source.kind }}:{{ source.path }}:{{ chipLabel ?? "" }}:{{ active }}</section>',
  },
}));

vi.mock("./AiDiffPane.vue", () => ({
  default: {
    props: [
      "path",
      "originalContent",
      "proposedContent",
      "status",
      "isNewFile",
    ],
    emits: ["accept", "reject"],
    template:
      '<section data-ai-diff-pane>{{ path }}:{{ status }}<button data-accept @click="$emit(\'accept\')">accept</button><button data-reject @click="$emit(\'reject\')">reject</button></section>',
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
  {
    id: 5,
    kind: "ai-diff",
    title: "AI diff",
    path: "src/agent.ts",
    originalContent: "old",
    proposedContent: "new",
    approvalId: "approval-1",
    status: "pending",
    isNewFile: false,
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

  it("renders active AI diff tabs and forwards approval ids", async () => {
    const wrapper = mount(AiDiffStack, {
      props: { tabs, activeId: 5 },
    });

    expect(wrapper.find("[data-ai-diff-pane]").text()).toContain(
      "src/agent.ts:pending",
    );

    await wrapper.find("[data-accept]").trigger("click");
    await wrapper.find("[data-reject]").trigger("click");

    expect(wrapper.emitted("accept")).toEqual([["approval-1"]]);
    expect(wrapper.emitted("reject")).toEqual([["approval-1"]]);
  });
});
