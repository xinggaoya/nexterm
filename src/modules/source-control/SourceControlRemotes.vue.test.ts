// @vitest-environment jsdom
import { mount } from "@vue/test-utils";
import { nextTick } from "vue";
import { afterEach, describe, expect, it } from "vitest";
import SourceControlRemotes from "./SourceControlRemotes.vue";
import {
  NConfigProvider,
  NDialogProvider,
  NMessageProvider,
} from "naive-ui";

function setInputValue(input: HTMLInputElement, value: string) {
  const setter = Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, "value")?.set;
  setter?.call(input, value);
  input.dispatchEvent(new Event("input", { bubbles: true }));
}

function mountRemotes(props: {
  show?: boolean;
  remotes?: Array<{ name: string; fetchUrl: string; pushUrl: string }>;
  loading?: boolean;
  busyAction?: null;
} = {}) {
  return mount(SourceControlRemotes, {
    props: {
      show: props.show ?? true,
      remotes: props.remotes ?? [],
      loading: props.loading ?? false,
      busyAction: props.busyAction ?? null,
    },
    global: {
      components: { NConfigProvider, NDialogProvider, NMessageProvider },
    },
  });
}

afterEach(() => {
  document.body.innerHTML = "";
});

describe("SourceControlRemotes.vue", () => {
  it("renders the empty state when no remotes are configured", async () => {
    mountRemotes({ remotes: [] });
    await nextTick();
    expect(document.body.textContent).toContain("No remotes configured");
  });

  it("renders existing remotes with their fetch and push URLs", async () => {
    mountRemotes({
      remotes: [
        {
          name: "origin",
          fetchUrl: "git@example.com:test/test.git",
          pushUrl: "git@example.com:test/test.git",
        },
        {
          name: "upstream",
          fetchUrl: "git@example.com:up/up.git",
          pushUrl: "git@example.com:up/push.git",
        },
      ],
    });
    await nextTick();
    expect(document.body.querySelectorAll("[data-git-remote-row]")).toHaveLength(2);
    expect(document.body.textContent).toContain("origin");
    expect(document.body.textContent).toContain("git@example.com:test/test.git");
    expect(document.body.textContent).toContain("upstream");
    expect(document.body.textContent).toContain("git@example.com:up/push.git");
  });

  it("opens the inner editor and emits addRemote on submit", async () => {
    const wrapper = mountRemotes({ remotes: [] });
    await nextTick();
    const addBtn = document.body.querySelector(
      "[data-git-remote-add]",
    ) as HTMLButtonElement | null;
    expect(addBtn).not.toBeNull();
    addBtn?.dispatchEvent(new MouseEvent("click", { bubbles: true }));
    await nextTick();
    const nameInput = document.body.querySelector(
      "[data-git-remote-name-input]",
    ) as HTMLInputElement | null;
    const urlInput = document.body.querySelector(
      "[data-git-remote-url-input]",
    ) as HTMLInputElement | null;
    expect(nameInput).not.toBeNull();
    expect(urlInput).not.toBeNull();
    if (!nameInput || !urlInput) return;
    setInputValue(nameInput, "origin");
    setInputValue(urlInput, "git@example.com:test/test.git");
    await nextTick();
    const submit = document.body.querySelector(
      '[data-git-remote-submit="add"]',
    ) as HTMLButtonElement | null;
    expect(submit).not.toBeNull();
    submit?.dispatchEvent(new MouseEvent("click", { bubbles: true }));
    await nextTick();

    expect(wrapper.emitted("addRemote")).toBeTruthy();
    expect(wrapper.emitted("addRemote")![0]).toEqual([
      { name: "origin", url: "git@example.com:test/test.git" },
    ]);
  });

  it("emits removeRemote when the trash button is clicked", async () => {
    const wrapper = mountRemotes({
      remotes: [
        {
          name: "origin",
          fetchUrl: "git@example.com:test/test.git",
          pushUrl: "git@example.com:test/test.git",
        },
      ],
    });
    await nextTick();
    const removeBtn = document.body.querySelector(
      '[data-git-remote-remove="origin"]',
    ) as HTMLButtonElement | null;
    expect(removeBtn).not.toBeNull();
    removeBtn?.dispatchEvent(new MouseEvent("click", { bubbles: true }));
    await nextTick();

    expect(wrapper.emitted("removeRemote")).toBeTruthy();
    expect(wrapper.emitted("removeRemote")![0]).toEqual(["origin"]);
  });

  it("emits updateRemote from the editor with the new URL", async () => {
    const wrapper = mountRemotes({
      remotes: [
        {
          name: "origin",
          fetchUrl: "git@example.com:test/test.git",
          pushUrl: "git@example.com:test/test.git",
        },
      ],
    });
    await nextTick();
    const editBtn = document.body.querySelector(
      '[data-git-remote-edit="origin"]',
    ) as HTMLButtonElement | null;
    expect(editBtn).not.toBeNull();
    editBtn?.dispatchEvent(new MouseEvent("click", { bubbles: true }));
    await nextTick();
    const urlInput = document.body.querySelector(
      "[data-git-remote-url-input]",
    ) as HTMLInputElement | null;
    if (!urlInput) throw new Error("missing url input");
    setInputValue(urlInput, "git@example.com:test/renamed.git");
    await nextTick();
    const submit = document.body.querySelector(
      '[data-git-remote-submit="edit"]',
    ) as HTMLButtonElement | null;
    expect(submit).not.toBeNull();
    submit?.dispatchEvent(new MouseEvent("click", { bubbles: true }));
    await nextTick();

    expect(wrapper.emitted("updateRemote")).toBeTruthy();
    expect(wrapper.emitted("updateRemote")![0]).toEqual([
      { name: "origin", newUrl: "git@example.com:test/renamed.git" },
    ]);
  });

  it("disables the submit button when the name is invalid", async () => {
    mountRemotes({ remotes: [] });
    await nextTick();
    const addBtn = document.body.querySelector(
      "[data-git-remote-add]",
    ) as HTMLButtonElement | null;
    expect(addBtn).not.toBeNull();
    addBtn?.dispatchEvent(new MouseEvent("click", { bubbles: true }));
    await nextTick();
    const nameInput = document.body.querySelector(
      "[data-git-remote-name-input]",
    ) as HTMLInputElement | null;
    const urlInput = document.body.querySelector(
      "[data-git-remote-url-input]",
    ) as HTMLInputElement | null;
    if (!nameInput || !urlInput) throw new Error("missing inputs");
    setInputValue(nameInput, "-leading-dash");
    setInputValue(urlInput, "git@example.com:test/test.git");
    await nextTick();
    const submit = document.body.querySelector(
      '[data-git-remote-submit="add"]',
    ) as HTMLButtonElement | null;
    expect(submit).not.toBeNull();
    expect(submit?.disabled).toBe(true);
    expect(document.body.textContent).toContain("Name must start with a letter/digit");
  });
});
