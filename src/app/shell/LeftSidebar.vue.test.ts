// @vitest-environment jsdom
import { mount } from "@vue/test-utils";
import { defineComponent, h, ref } from "vue";
import { describe, expect, it } from "vitest";
import LeftSidebar from "./LeftSidebar.vue";

const StubActivityIcons = defineComponent({
  name: "ActivityIcons",
  emits: ["select-activity", "add-workspace", "open-in-new-window"],
  setup(_, { emit }) {
    return () =>
      h("div", {
        "data-stub-activity-icons": "true",
        onClick: () => emit("select-activity", "workspace"),
      });
  },
});

const StubSourceControlPanel = defineComponent({
  name: "SourceControlPanel",
  setup() {
    return () => h("div", { "data-stub-source-control": "true" });
  },
});

const StubWorkspaceBar = defineComponent({
  name: "WorkspaceBar",
  emits: ["add-workspace"],
  setup(_, { emit }) {
    return () =>
      h(
        "button",
        {
          "data-stub-workspace-bar": "true",
          onClick: () =>
            emit("add-workspace", { kind: "wsl", distro: "Ubuntu" }),
        },
        "add wsl",
      );
  },
});

const stubWorkspace = {
  id: "local:/repo",
  rootPath: "/repo",
  env: { kind: "local" as const },
  name: "repo",
  openedAt: 0,
};

const baseProps = {
  activity: "sourceControl" as const,
  open: true,
  width: 280,
  minWidth: 200,
  maxWidth: 480,
  workspace: stubWorkspace,
  activeRepoRoot: null,
  fsEvent: null,
  showBranchesModal: ref(false),
};

describe("LeftSidebar", () => {
  it("renders aside with current activity attribute", () => {
    const wrapper = mount(LeftSidebar, {
      props: baseProps,
      global: {
        stubs: {
          ActivityIcons: StubActivityIcons,
          SourceControlPanel: StubSourceControlPanel,
          WorkspaceBar: StubWorkspaceBar,
        },
      },
    });
    const aside = wrapper.find("aside");
    expect(aside.exists()).toBe(true);
    expect(aside.attributes("data-activity")).toBe("sourceControl");
  });

  it("hides itself when open=false", () => {
    const wrapper = mount(LeftSidebar, {
      props: { ...baseProps, open: false },
      global: {
        stubs: {
          ActivityIcons: StubActivityIcons,
          SourceControlPanel: StubSourceControlPanel,
          WorkspaceBar: StubWorkspaceBar,
        },
      },
    });
    expect(wrapper.find("aside").exists()).toBe(false);
  });

  it("emits select-activity from ActivityIcons", async () => {
    const wrapper = mount(LeftSidebar, {
      props: baseProps,
      global: {
        stubs: {
          ActivityIcons: StubActivityIcons,
          SourceControlPanel: StubSourceControlPanel,
          WorkspaceBar: StubWorkspaceBar,
        },
      },
    });
    await wrapper.find("[data-stub-activity-icons]").trigger("click");
    expect(wrapper.emitted("select-activity")?.[0]).toEqual(["workspace"]);
  });

  it("forwards the selected WSL environment from WorkspaceBar", async () => {
    const wrapper = mount(LeftSidebar, {
      props: { ...baseProps, activity: "workspace" },
      global: {
        stubs: {
          ActivityIcons: StubActivityIcons,
          SourceControlPanel: StubSourceControlPanel,
          WorkspaceBar: StubWorkspaceBar,
        },
      },
    });

    await wrapper.find("[data-stub-workspace-bar]").trigger("click");

    expect(wrapper.emitted("add-workspace")).toEqual([
      [{ kind: "wsl", distro: "Ubuntu" }],
    ]);
  });
});
