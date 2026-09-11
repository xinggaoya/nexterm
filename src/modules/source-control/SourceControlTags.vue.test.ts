// @vitest-environment jsdom
import { mount } from "@vue/test-utils";
import { nextTick } from "vue";
import { afterEach, describe, expect, it } from "vitest";
import SourceControlTags from "./SourceControlTags.vue";
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

function setTextareaValue(textarea: HTMLTextAreaElement, value: string) {
  const setter = Object.getOwnPropertyDescriptor(
    HTMLTextAreaElement.prototype,
    "value",
  )?.set;
  setter?.call(textarea, value);
  textarea.dispatchEvent(new Event("input", { bubbles: true }));
}

function mountTags(
  props: {
    show?: boolean;
    tags?: Array<{
      name: string;
      fullRef?: string;
      shortSha?: string;
      subject?: string;
      timestampSecs?: number;
      isAnnotated?: boolean;
    }>;
    loading?: boolean;
    busyAction?: null;
  } = {},
) {
  return mount(SourceControlTags, {
    props: {
      show: props.show ?? true,
      tags: props.tags ?? [],
      loading: props.loading ?? false,
      busyAction: props.busyAction ?? null,
    },
    global: {
      components: { NConfigProvider, NDialogProvider, NMessageProvider },
    },
  });
}

function query<T extends Element = HTMLElement>(selector: string): T | null {
  return document.body.querySelector<T>(selector);
}

function click(element: Element | null) {
  element?.dispatchEvent(new MouseEvent("click", { bubbles: true }));
}

afterEach(() => {
  document.body.innerHTML = "";
});

describe("SourceControlTags.vue", () => {
  it("renders the empty state when the repo has no tags", async () => {
    mountTags({ tags: [] });
    await nextTick();
    expect(document.body.textContent).toContain("No tags yet");
  });

  it("renders tag rows with name, annotated badge, sha and subject", async () => {
    mountTags({
      tags: [
        {
          name: "v1.0",
          fullRef: "refs/tags/v1.0",
          shortSha: "abcdef1",
          subject: "release one",
          isAnnotated: true,
        },
        {
          name: "v0.9",
          fullRef: "refs/tags/v0.9",
          shortSha: "deadbe0",
          subject: "init",
          isAnnotated: false,
        },
      ],
    });
    await nextTick();
    expect(document.body.querySelectorAll("[data-git-tag-row]")).toHaveLength(2);
    expect(document.body.textContent).toContain("v1.0");
    expect(document.body.textContent).toContain("release one");
    expect(document.body.textContent).toContain("abcdef1");
    expect(document.body.textContent).toContain("annotated");
    // 轻量标签不显示附注徽标。
    const lightweightRow = query('[data-git-tag="v0.9"]');
    expect(lightweightRow?.textContent).not.toContain("annotated");
  });

  it("emits createTag with an annotation message when provided", async () => {
    const wrapper = mountTags({ tags: [] });
    await nextTick();
    const nameInput = query<HTMLInputElement>("[data-git-tag-name-input]");
    const messageInput = query<HTMLTextAreaElement>("[data-git-tag-message-input]");
    expect(nameInput).not.toBeNull();
    expect(messageInput).not.toBeNull();
    if (!nameInput || !messageInput) return;
    setInputValue(nameInput, "v1.0");
    setTextareaValue(messageInput, "release one");
    await nextTick();
    click(query("[data-git-tag-create]"));
    await nextTick();

    expect(wrapper.emitted("createTag")).toBeTruthy();
    expect(wrapper.emitted("createTag")![0]).toEqual([
      { name: "v1.0", message: "release one" },
    ]);
  });

  it("emits createTag with a null message for lightweight tags", async () => {
    const wrapper = mountTags({ tags: [] });
    await nextTick();
    const nameInput = query<HTMLInputElement>("[data-git-tag-name-input]");
    if (!nameInput) throw new Error("missing name input");
    setInputValue(nameInput, "v0.9");
    await nextTick();
    click(query("[data-git-tag-create]"));
    await nextTick();

    expect(wrapper.emitted("createTag")?.[0]).toEqual([
      { name: "v0.9", message: null },
    ]);
  });

  it("disables create and shows an error for an invalid tag name", async () => {
    mountTags({ tags: [] });
    await nextTick();
    const nameInput = query<HTMLInputElement>("[data-git-tag-name-input]");
    if (!nameInput) throw new Error("missing name input");
    setInputValue(nameInput, "-leading");
    await nextTick();

    const submit = query<HTMLButtonElement>("[data-git-tag-create]");
    expect(submit?.disabled).toBe(true);
    expect(document.body.textContent).toContain("Tag name cannot start with");
  });

  it("filters the tag list through the search input", async () => {
    mountTags({
      tags: [
        { name: "v1.0", fullRef: "refs/tags/v1.0", shortSha: "abc" },
        { name: "v2.0", fullRef: "refs/tags/v2.0", shortSha: "def" },
      ],
    });
    await nextTick();
    const search = query<HTMLInputElement>("[data-git-tag-search]");
    if (!search) throw new Error("missing search input");
    setInputValue(search, "v2");
    await nextTick();

    const rows = document.body.querySelectorAll("[data-git-tag-row]");
    expect(rows).toHaveLength(1);
    expect(rows[0].getAttribute("data-git-tag")).toBe("v2.0");
  });

  it("emits deleteTag and pushTag from the row buttons", async () => {
    const wrapper = mountTags({
      tags: [{ name: "v1.0", fullRef: "refs/tags/v1.0", shortSha: "abc" }],
    });
    await nextTick();
    click(query('[data-git-tag-delete="v1.0"]'));
    await nextTick();
    expect(wrapper.emitted("deleteTag")?.[0]).toEqual(["v1.0"]);

    click(query('[data-git-tag-push="v1.0"]'));
    await nextTick();
    expect(wrapper.emitted("pushTag")?.[0]).toEqual(["v1.0"]);
  });
});
