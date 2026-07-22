import { createPinia, setActivePinia } from "pinia";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { useWorkspacesPiniaStore } from "./workspacesPinia";

vi.mock("@/modules/workspace/workspaceNative", () => ({
  getWslHome: vi.fn(),
  authorizeWorkspace: vi.fn(async (path: string) => path),
}));

vi.mock("@/modules/settings/store", () => ({
  DEFAULT_PREFERENCES: {},
  loadPreferences: vi.fn(async () => ({})),
  setOpenWorkspaces: vi.fn(async () => {}),
  setActiveWorkspaceId: vi.fn(async () => {}),
  setLastWorkspace: vi.fn(async () => {}),
  setRecentWorkspaces: vi.fn(async () => {}),
}));

describe("workspaces pinia store", () => {
  beforeEach(() => {
    setActivePinia(createPinia());
    vi.clearAllMocks();
  });

  it("adds a workspace and sets it active", async () => {
    const workspaces = useWorkspacesPiniaStore();
    const { instance, created } = await workspaces.addWorkspace("/repo", {
      kind: "local",
    });

    expect(created).toBe(true);
    expect(instance.rootPath).toBe("/repo");
    expect(instance.env).toEqual({ kind: "local" });
    expect(instance.name).toBe("repo");
    expect(workspaces.activeWorkspaceId).toBe(instance.id);
    expect(workspaces.hasWorkspaces).toBe(true);
  });

  it("dedupes an already-open workspace instead of adding a duplicate", async () => {
    const workspaces = useWorkspacesPiniaStore();
    const first = await workspaces.addWorkspace("/repo", { kind: "local" });
    const second = await workspaces.addWorkspace("/repo", { kind: "local" });

    expect(second.created).toBe(false);
    expect(second.instance.id).toBe(first.instance.id);
    expect(workspaces.workspaces).toHaveLength(1);
  });

  it("keeps local and WSL workspaces with the same path distinct", async () => {
    const workspaces = useWorkspacesPiniaStore();
    const local = await workspaces.addWorkspace("/home/user/proj", {
      kind: "local",
    });
    const wsl = await workspaces.addWorkspace("/home/user/proj", {
      kind: "wsl",
      distro: "Ubuntu",
    });

    expect(local.instance.id).not.toBe(wsl.instance.id);
    expect(workspaces.workspaces).toHaveLength(2);
  });

  it("switches active workspace without removing others", async () => {
    const workspaces = useWorkspacesPiniaStore();
    const a = await workspaces.addWorkspace("/a", { kind: "local" });
    await workspaces.addWorkspace("/b", { kind: "local" });

    workspaces.setActive(a.instance.id);
    expect(workspaces.activeWorkspaceId).toBe(a.instance.id);
    expect(workspaces.workspaces).toHaveLength(2);
  });

  it("removes a workspace and falls back to another active", async () => {
    const workspaces = useWorkspacesPiniaStore();
    const a = await workspaces.addWorkspace("/a", { kind: "local" });
    const b = await workspaces.addWorkspace("/b", { kind: "local" });

    await workspaces.removeWorkspace(b.instance.id);
    expect(workspaces.workspaces).toHaveLength(1);
    expect(workspaces.workspaces[0].id).toBe(a.instance.id);
  });

  it("clears the active id when the last workspace is removed", async () => {
    const workspaces = useWorkspacesPiniaStore();
    const a = await workspaces.addWorkspace("/a", { kind: "local" });

    await workspaces.removeWorkspace(a.instance.id);
    expect(workspaces.workspaces).toHaveLength(0);
    expect(workspaces.activeWorkspaceId).toBeNull();
    expect(workspaces.hasWorkspaces).toBe(false);
  });

  it("reorders workspaces", async () => {
    const workspaces = useWorkspacesPiniaStore();
    const a = await workspaces.addWorkspace("/a", { kind: "local" });
    await workspaces.addWorkspace("/b", { kind: "local" });
    await workspaces.addWorkspace("/c", { kind: "local" });

    workspaces.reorder(a.instance.id, 2);
    expect(workspaces.workspaces[2].id).toBe(a.instance.id);
  });

  it("finds an open workspace by selection", async () => {
    const workspaces = useWorkspacesPiniaStore();
    await workspaces.addWorkspace("/repo", { kind: "wsl", distro: "Ubuntu" });

    const found = workspaces.findBySelection("/repo", {
      kind: "wsl",
      distro: "Ubuntu",
    });
    expect(found).not.toBeNull();
    expect(found?.env).toEqual({ kind: "wsl", distro: "Ubuntu" });

    const miss = workspaces.findBySelection("/repo", { kind: "local" });
    expect(miss).toBeNull();
  });
});
