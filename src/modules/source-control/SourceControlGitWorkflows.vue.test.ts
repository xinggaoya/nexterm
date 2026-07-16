// @vitest-environment jsdom
import { mount } from "@vue/test-utils";
import { defineComponent, h, nextTick } from "vue";
import { describe, expect, it } from "vitest";
import SourceControlGitWorkflows from "./SourceControlGitWorkflows.vue";

const longLocalBranch = "feature/this-is-a-very-long-local-branch-name-for-layout";
const longRemoteBranch = "origin/feature/this-is-a-very-long-remote-branch-name-for-layout";
const firstSha = "0123456789abcdef0123456789abcdef01234567";
const secondSha = "abcdef0123456789abcdef0123456789abcdef01";
const localSubject = "Add branch summary";

function mountWorkflows() {
  return mount(SourceControlGitWorkflows, {
    props: {
      branches: [
        {
          name: "main",
          fullRef: "refs/heads/main",
          upstream: "origin/main",
          isCurrent: true,
          isRemote: false,
          ahead: 0,
          behind: 0,
        },
        {
          name: longLocalBranch,
          fullRef: `refs/heads/${longLocalBranch}`,
          upstream: null,
          isCurrent: false,
          isRemote: false,
          lastCommitSubject: localSubject,
          ahead: 2,
          behind: 1,
        },
        {
          name: longRemoteBranch,
          fullRef: `refs/remotes/${longRemoteBranch}`,
          upstream: null,
          isCurrent: false,
          isRemote: true,
          ahead: 0,
          behind: 3,
        },
      ],
      stashes: [
        {
          selector: "stash@{0}",
          fullSha: firstSha,
          shortSha: firstSha.slice(0, 7),
          relativeTime: "2 minutes ago",
          message: "WIP local changes",
        },
        {
          selector: "stash@{1}",
          fullSha: secondSha,
          shortSha: secondSha.slice(0, 7),
          relativeTime: "1 hour ago",
          message: "WIP remote changes",
        },
      ],
      loading: false,
      busyAction: null,
      changedCount: 2,
    },
    global: {
      stubs: {
        NModal: defineComponent({
          props: { show: Boolean },
          setup(props, { slots }) {
            return () => (props.show ? h("div", slots.default?.()) : null);
          },
        }),
      },
    },
  });
}

describe("SourceControlGitWorkflows.vue", () => {
  it("renders searchable vertical branch groups without horizontal overflow", async () => {
    const wrapper = mountWorkflows();

    expect(wrapper.find('[class*="overflow-x-auto"]').exists()).toBe(false);
    expect(wrapper.find('[data-git-branch-group="current"]').text()).toContain("main");
    expect(wrapper.find('[data-git-branch-group="local"]').text()).toContain(longLocalBranch);
    expect(wrapper.find('[data-git-branch-group="remote"]').text()).toContain(longRemoteBranch);
    expect(wrapper.find('[data-git-branch="main"]').attributes("disabled")).toBeDefined();
    expect(wrapper.find(`[data-git-branch="${longLocalBranch}"]`).attributes("title")).toBe(
      `refs/heads/${longLocalBranch}`,
    );
    expect(wrapper.text()).toContain(localSubject);
    expect(
      wrapper.find(`[data-git-branch="${longLocalBranch}"] [data-git-branch-subject]`).attributes("title"),
    ).toBe(localSubject);
    expect(
      wrapper.find(`[data-git-branch="${longRemoteBranch}"] [data-git-branch-subject]`).exists(),
    ).toBe(false);
    expect(wrapper.text()).toContain("2");
    expect(wrapper.text()).toContain("3");

    const search = wrapper.find("[data-git-branch-search]");
    await search.setValue("remote");
    await nextTick();

    expect(wrapper.find(`[data-git-branch="${longLocalBranch}"]`).exists()).toBe(false);
    expect(wrapper.find(`[data-git-branch="${longRemoteBranch}"]`).exists()).toBe(true);
    expect(wrapper.find('[data-git-branch-group="current"]').exists()).toBe(true);
  });

  it("opens the stash save form and emits complete stash action payloads", async () => {
    const wrapper = mountWorkflows();

    await wrapper.find("[data-git-stash-save]").trigger("click");
    expect(document.body.querySelector('[data-git-stash-modal="true"]')).not.toBeNull();
    expect(document.body.querySelector("[data-git-stash-message]")).not.toBeNull();
    expect(document.body.querySelector("[data-git-stash-include-untracked]")).not.toBeNull();
    expect(document.body.querySelector("[data-git-stash-keep-index]")).not.toBeNull();

    const message = document.body.querySelector<HTMLInputElement>("[data-git-stash-message]");
    if (!message) throw new Error("stash message input is missing");
    message.value = "checkpoint";
    message.dispatchEvent(new Event("input", { bubbles: true }));
    const includeControl = document.body.querySelector("[data-git-stash-include-untracked]");
    const keepControl = document.body.querySelector("[data-git-stash-keep-index]");
    if (!includeControl || !keepControl) throw new Error("stash option controls are missing");
    includeControl.dispatchEvent(new MouseEvent("click", { bubbles: true }));
    keepControl.dispatchEvent(new MouseEvent("click", { bubbles: true }));
    document.body.querySelector<HTMLButtonElement>("[data-git-stash-submit]")?.click();
    await nextTick();

    expect(wrapper.emitted("stashSave")).toEqual([
      [{ message: "checkpoint", includeUntracked: false, keepIndex: true }],
    ]);
    expect(document.body.querySelector('[data-git-stash-modal="true"]')).toBeNull();

    await wrapper.find('[data-git-stash-apply="stash@{0}"]').trigger("click");
    await wrapper.find('[data-git-stash-pop="stash@{1}"]').trigger("click");
    await wrapper.find('[data-git-stash-drop="stash@{0}"]').trigger("click");

    expect(wrapper.emitted("stashApply")).toEqual([[{ selector: "stash@{0}", fullSha: firstSha }]]);
    expect(wrapper.emitted("stashPop")).toEqual([[{ selector: "stash@{1}", fullSha: secondSha }]]);
    expect(wrapper.emitted("stashDrop")).toEqual([[{ selector: "stash@{0}", fullSha: firstSha }]]);
  });
});
