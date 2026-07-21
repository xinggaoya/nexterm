// @vitest-environment jsdom
import { mount } from "@vue/test-utils";
import { defineComponent, h, nextTick } from "vue";
import { afterEach, describe, expect, it } from "vitest";
import SourceControlGitWorkflows from "./SourceControlGitWorkflows.vue";

const longLocalBranch = "feature/this-is-a-very-long-local-branch-name-for-layout";
const longRemoteBranch = "origin/feature/this-is-a-very-long-remote-branch-name-for-layout";
const firstSha = "0123456789abcdef0123456789abcdef01234567";
const secondSha = "abcdef0123456789abcdef0123456789abcdef01";
const localSubject = "Add branch summary";

function setInputValue(input: HTMLInputElement, value: string) {
  const setter = Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, "value")?.set;
  setter?.call(input, value);
  input.dispatchEvent(new Event("input", { bubbles: true }));
}

function mountWorkflows(overrides: { show?: boolean } = {}) {
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
      show: overrides.show ?? true,
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
            return () =>
              props.show
                ? h("div", [slots.header?.(), slots.default?.()])
                : null;
          },
        }),
      },
    },
  });
}

describe("SourceControlGitWorkflows.vue", () => {
  afterEach(() => {
    document.body.innerHTML = "";
  });
  it("renders searchable vertical branch groups without horizontal overflow", async () => {
    mountWorkflows();
    await nextTick();

    expect(document.body.querySelector('[class*="overflow-x-auto"]')).toBeNull();
    expect(document.body.querySelector('[data-git-branch-group="current"]')?.textContent).toContain("main");
    expect(document.body.querySelector('[data-git-branch-group="local"]')?.textContent).toContain(longLocalBranch);
    expect(document.body.querySelector('[data-git-branch-group="remote"]')?.textContent).toContain(longRemoteBranch);
    expect(document.body.querySelector('[data-git-branch="main"]')?.hasAttribute("disabled")).toBe(true);
    expect(document.body.querySelector(`[data-git-branch="${longLocalBranch}"]`)?.getAttribute("title")).toBe(
      `refs/heads/${longLocalBranch}`,
    );
    expect(document.body.textContent).toContain(localSubject);
    expect(
      document.body.querySelector(`[data-git-branch="${longLocalBranch}"] [data-git-branch-subject]`)?.getAttribute("title"),
    ).toBe(localSubject);
    expect(
      document.body.querySelector(`[data-git-branch="${longRemoteBranch}"] [data-git-branch-subject]`),
    ).toBeNull();
    expect(document.body.textContent).toContain("2");
    expect(document.body.textContent).toContain("3");

    const search = document.body.querySelector<HTMLInputElement>("[data-git-branch-search]");
    if (!search) throw new Error("branch search input is missing");
    search.value = "remote";
    search.dispatchEvent(new Event("input", { bubbles: true }));
    await nextTick();

    expect(document.body.querySelector(`[data-git-branch="${longLocalBranch}"]`)).toBeNull();
    expect(document.body.querySelector(`[data-git-branch="${longRemoteBranch}"]`)).not.toBeNull();
    expect(document.body.querySelector('[data-git-branch-group="current"]')).not.toBeNull();
  });

  it("opens the stash save form and emits complete stash action payloads", async () => {
    const wrapper = mountWorkflows();

    document.body.querySelector<HTMLButtonElement>("[data-git-stash-save]")?.click();
    await nextTick();
    expect(document.body.querySelector('[data-git-stash-modal="true"]')).not.toBeNull();
    expect(document.body.querySelector("[data-git-stash-message]")).not.toBeNull();
    expect(document.body.querySelector("[data-git-stash-include-untracked]")).not.toBeNull();
    expect(document.body.querySelector("[data-git-stash-keep-index]")).not.toBeNull();

    const message = document.body.querySelector<HTMLInputElement>("[data-git-stash-message]");
    if (!message) throw new Error("stash message input is missing");
    setInputValue(message, "checkpoint");
    const includeControl = document.body.querySelector("[data-git-stash-include-untracked]");
    const keepControl = document.body.querySelector("[data-git-stash-keep-index]");
    if (!includeControl || !keepControl) throw new Error("stash option controls are missing");
    includeControl.dispatchEvent(new MouseEvent("click", { bubbles: true }));
    keepControl.dispatchEvent(new MouseEvent("click", { bubbles: true }));
    await nextTick();
    document.body.querySelector<HTMLButtonElement>("[data-git-stash-submit]")?.click();
    await nextTick();
    await nextTick();

    expect(wrapper.emitted("stashSave") ?? []).toEqual([
      [{ message: "checkpoint", includeUntracked: false, keepIndex: true }],
    ]);
    expect(document.body.querySelector('[data-git-stash-modal="true"]')).toBeNull();

    document.body.querySelector<HTMLButtonElement>('[data-git-stash-apply="stash@{0}"]')?.click();
    document.body.querySelector<HTMLButtonElement>('[data-git-stash-pop="stash@{1}"]')?.click();
    document.body.querySelector<HTMLButtonElement>('[data-git-stash-drop="stash@{0}"]')?.click();

    expect(wrapper.emitted("stashApply")).toEqual([[{ selector: "stash@{0}", fullSha: firstSha }]]);
    expect(wrapper.emitted("stashPop")).toEqual([[{ selector: "stash@{1}", fullSha: secondSha }]]);
    expect(wrapper.emitted("stashDrop")).toEqual([[{ selector: "stash@{0}", fullSha: firstSha }]]);
  });

  it("does not render any workflow content when show is false", async () => {
    mountWorkflows({ show: false });
    await nextTick();
    await nextTick();

    expect(document.body.querySelector("[data-git-create-branch-input]")).toBeNull();
    expect(document.body.querySelector("[data-git-create-branch-submit]")).toBeNull();
    expect(document.body.querySelector("[data-git-branch-search]")).toBeNull();
    expect(document.body.querySelector('[data-git-branch-group="current"]')).toBeNull();
    expect(document.body.querySelector('[data-git-branch-group="local"]')).toBeNull();
    expect(document.body.querySelector('[data-git-branch-group="remote"]')).toBeNull();
    expect(document.body.querySelector(`[data-git-branch="${longLocalBranch}"]`)).toBeNull();
    expect(document.body.querySelector("[data-git-stash-save]")).toBeNull();
    expect(document.body.querySelector("[data-git-stash-modal]")).toBeNull();
    expect(document.body.querySelector('[data-git-stash-apply="stash@{0}"]')).toBeNull();
    expect(document.body.querySelector('[data-git-stash-pop="stash@{1}"]')).toBeNull();
    expect(document.body.querySelector('[data-git-stash-drop="stash@{0}"]')).toBeNull();

    expect(document.body.innerHTML).not.toContain("data-git-branch-search");
  });

  it("shows the empty branch state when no branches are available", async () => {
    mount(SourceControlGitWorkflows, {
      props: {
        show: true,
        branches: [],
        stashes: [],
        loading: false,
        busyAction: null,
        changedCount: 0,
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
    await nextTick();

    expect(document.body.textContent).toContain("No matching branches");
  });
});
