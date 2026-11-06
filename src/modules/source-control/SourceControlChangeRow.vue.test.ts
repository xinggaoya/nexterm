// @vitest-environment jsdom
import { mount } from "@vue/test-utils";
import { ref } from "vue";
import { describe, expect, it, vi } from "vitest";
import SourceControlChangeRow from "./SourceControlChangeRow.vue";
import type { SourceControlFileEntry } from "./sourceControlModel";

vi.mock("@/modules/icons", () => ({
  fileIconUrl: vi.fn((name: string) => `file-icon:${name}`),
  folderIconUrl: vi.fn(() => "folder-icon"),
}));

function entry(
  overrides: Partial<SourceControlFileEntry> = {},
): SourceControlFileEntry {
  return {
    key: "staged:apps/cli/package.json",
    group: "staged",
    path: "apps/cli/package.json",
    originalPath: null,
    statusCode: "M",
    statusLabel: "modified",
    statusKind: "modified",
    diffMode: "+",
    checkState: "checked",
    staged: true,
    unstaged: false,
    untracked: false,
    insertions: 0,
    deletions: 0,
    ...overrides,
  };
}

function mountRow(file: SourceControlFileEntry) {
  return mount(SourceControlChangeRow, {
    props: { entry: file, selected: false },
    global: {
      // 行组件从父级注入当前 busy action；缺失时组件会解引用 null。
      provide: { sourceControlBusyAction: ref(null) },
    },
  });
}

describe("SourceControlChangeRow", () => {
  it("shows the file type icon of the changed file", () => {
    const wrapper = mountRow(entry());
    const icon = wrapper.find("img[data-source-file-icon]");

    expect(icon.exists()).toBe(true);
    expect(icon.attributes("src")).toBe("file-icon:package.json");
  });

  it("splits the path into a file name and a muted directory prefix", () => {
    const wrapper = mountRow(entry());
    const label = wrapper.get("span[data-source-file-label]");

    expect(label.get("span[data-source-file-name]").text()).toBe("package.json");
    expect(label.get("span[data-source-file-dir]").text()).toBe("apps/cli");
  });

  it("omits the directory prefix for single-segment paths", () => {
    const wrapper = mountRow(
      entry({ path: "package.json", key: "staged:package.json" }),
    );
    const label = wrapper.get("span[data-source-file-label]");

    expect(label.get("span[data-source-file-name]").text()).toBe("package.json");
    expect(label.find("span[data-source-file-dir]").exists()).toBe(false);
  });

  it("shows the added and deleted line counts", () => {
    const wrapper = mountRow(
      entry({ insertions: 12, deletions: 3, group: "changes" }),
    );
    const counts = wrapper.get("[data-source-line-counts]");

    expect(counts.text()).toContain("+12");
    expect(counts.text()).toContain("-3");
  });

  it("omits the line counts when the file has none", () => {
    const wrapper = mountRow(entry({ insertions: 0, deletions: 0 }));
    const counts = wrapper.get("[data-source-line-counts]");

    expect(counts.text()).toBe("");
  });

  it("keeps the git status code and the stage label", () => {
    const wrapper = mountRow(entry());

    expect(wrapper.get("[data-source-status-code]").text()).toBe("M");
    expect(wrapper.get("[data-source-stage-label]").text().length).toBeGreaterThan(
      0,
    );
  });

  it("keeps the full path on the clickable button for automation", () => {
    const wrapper = mountRow(entry());
    const button = wrapper.get("button[data-source-file]");

    expect(button.attributes("data-source-file")).toBe("apps/cli/package.json");
  });
});
