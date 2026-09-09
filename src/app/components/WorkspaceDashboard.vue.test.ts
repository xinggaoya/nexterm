// @vitest-environment jsdom
import { mount } from "@vue/test-utils";
import { createPinia } from "pinia";
import { describe, expect, it } from "vitest";
import { LOCAL_WORKSPACE, type WorkspaceSelection } from "@/modules/workspace";

import WorkspaceDashboard from "./WorkspaceDashboard.vue";

const recent: (WorkspaceSelection & { openedAt?: number })[] = [
  { path: "/dev/nexterm", env: LOCAL_WORKSPACE, openedAt: 2 },
  { path: "/home/dev/blog", env: { kind: "wsl", distro: "Ubuntu" }, openedAt: 1 },
];

function mountDashboard() {
  return mount(WorkspaceDashboard, {
    props: { recentWorkspaces: recent, loading: false, error: null },
    global: { plugins: [createPinia()] },
  });
}

describe("WorkspaceDashboard.vue", () => {
  it("渲染 hero、打开按钮与最近工作区卡片", () => {
    const wrapper = mountDashboard();

    expect(wrapper.find("[data-workspace-dashboard]").text()).toContain("Nexterm");
    expect(wrapper.find("[data-dashboard-open]").exists()).toBe(true);

    const recents = wrapper.findAll("[data-dashboard-recent]");
    expect(recents).toHaveLength(2);
    // monogram 取路径末段首字母。
    expect(recents[0]?.text()).toContain("nexterm");
    expect(recents[1]?.text()).toContain("WSL · Ubuntu");
  });

  it("点击打开按钮以当前 pendingEnv 发起 chooseWorkspace", async () => {
    const wrapper = mountDashboard();
    await wrapper.find("[data-dashboard-open]").trigger("click");
    expect(wrapper.emitted("chooseWorkspace")).toEqual([[{ kind: "local" }]]);
  });

  it("点击最近卡片发出 openRecent", async () => {
    const wrapper = mountDashboard();
    await wrapper.findAll("[data-dashboard-recent]")[1]!.trigger("click");
    expect(wrapper.emitted("openRecent")?.[0]?.[0]).toMatchObject({
      path: "/home/dev/blog",
    });
  });

  it("错误信息透出显示", () => {
    const wrapper = mount(WorkspaceDashboard, {
      props: { recentWorkspaces: [], loading: false, error: "boom" },
      global: { plugins: [createPinia()] },
    });
    expect(wrapper.find("[data-dashboard-error]").text()).toBe("boom");
  });
});
