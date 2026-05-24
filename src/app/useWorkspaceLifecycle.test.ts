import { computed, reactive } from "vue";
import { describe, expect, it, vi } from "vitest";
import type { StoredWorkspace } from "@/modules/settings/store";
import type { Tab } from "@/modules/tabs/tabsTypes";
import type { WorkspaceEnv } from "@/modules/workspace";
import { useWorkspaceLifecycle } from "./useWorkspaceLifecycle";

const LOCAL: WorkspaceEnv = { kind: "local" };
const WSL: WorkspaceEnv = { kind: "wsl", distro: "Ubuntu" };

function stored(path: string, env: WorkspaceEnv = LOCAL): StoredWorkspace {
  return { path, env, openedAt: 1 };
}

function createHarness(rootPath: string | null = "/repo") {
  const workspaceEnv = reactive({ env: LOCAL });
  const workspaceRootStore = reactive({
    rootPath,
    recentWorkspaces: [] as StoredWorkspace[],
    loading: false,
    error: null as string | null,
    openWorkspace: vi.fn(async (path: string, env: WorkspaceEnv) => {
      workspaceRootStore.rootPath = path;
      workspaceEnv.env = env;
      return stored(path, env);
    }),
    chooseWorkspace: vi.fn(async () => stored("/chosen")),
  });
  const tabs = reactive({
    initialized: false,
    tabs: [] as Tab[],
    init: vi.fn((path?: string) => {
      tabs.initialized = true;
      tabs.tabs = [
        {
          id: 1,
          kind: "terminal",
          title: "shell",
          cwd: path,
          paneTree: { kind: "leaf", id: 2, cwd: path },
          activeLeafId: 2,
        },
      ];
    }),
    resetWorkspace: vi.fn((path?: string) => {
      tabs.initialized = true;
      tabs.tabs = [
        {
          id: 3,
          kind: "terminal",
          title: "shell",
          cwd: path,
          paneTree: { kind: "leaf", id: 4, cwd: path },
          activeLeafId: 4,
        },
      ];
    }),
  });
  return { tabs, workspaceEnv, workspaceRootStore };
}

describe("useWorkspaceLifecycle", () => {
  it("blocks workspace switches when editors are dirty", async () => {
    const harness = createHarness("/repo");
    harness.tabs.initialized = true;
    harness.tabs.tabs = [
      {
        id: 1,
        kind: "editor",
        title: "main.ts",
        path: "/repo/src/main.ts",
        dirty: true,
        preview: false,
      },
    ];
    const alert = vi.fn();
    const lifecycle = useWorkspaceLifecycle({
      ...harness,
      workspaceRoot: computed(() => harness.workspaceRootStore.rootPath),
      t: (key) => key,
      alert,
      hasRuntime: () => false,
    });

    await lifecycle.openWorkspacePath("/other", LOCAL);

    expect(alert).toHaveBeenCalledWith("app.unsaved.switchWorkspaceBlocked");
    expect(harness.workspaceRootStore.openWorkspace).not.toHaveBeenCalled();
  });

  it("opens chosen workspaces and initializes tabs when none exist", async () => {
    const harness = createHarness(null);
    const lifecycle = useWorkspaceLifecycle({
      ...harness,
      workspaceRoot: computed(() => harness.workspaceRootStore.rootPath),
      t: (key) => key,
      hasRuntime: () => false,
    });

    await lifecycle.chooseWorkspace();

    expect(harness.workspaceRootStore.chooseWorkspace).toHaveBeenCalled();
    expect(harness.tabs.init).toHaveBeenCalledWith("/chosen");
    expect(harness.tabs.resetWorkspace).not.toHaveBeenCalled();
  });

  it("resets tabs when opening a different workspace after one is active", async () => {
    const harness = createHarness("/repo");
    harness.tabs.initialized = true;
    harness.tabs.tabs = [
      {
        id: 1,
        kind: "terminal",
        title: "shell",
        cwd: "/repo",
        paneTree: { kind: "leaf", id: 2, cwd: "/repo" },
        activeLeafId: 2,
      },
    ];
    const lifecycle = useWorkspaceLifecycle({
      ...harness,
      workspaceRoot: computed(() => harness.workspaceRootStore.rootPath),
      t: (key) => key,
      hasRuntime: () => false,
    });

    await lifecycle.openWorkspacePath("/other", LOCAL);

    expect(harness.workspaceRootStore.openWorkspace).toHaveBeenCalledWith(
      "/other",
      LOCAL,
    );
    expect(harness.tabs.resetWorkspace).toHaveBeenCalledWith("/other");
  });

  it("listens for filesystem changes only from the active workspace root", async () => {
    const harness = createHarness("/repo");
    const native = {
      fsWatchWorkspace: vi.fn(async () => undefined),
      fsUnwatchWorkspace: vi.fn(async () => undefined),
    };
    type FsHandler = (event: {
      payload: { rootPath: string; paths: string[]; gitRelated: boolean };
    }) => void;
    let handler: FsHandler | undefined;
    const listen = vi.fn(async (_event: string, nextHandler: FsHandler) => {
      handler = nextHandler;
      return vi.fn();
    });
    const lifecycle = useWorkspaceLifecycle({
      ...harness,
      workspaceRoot: computed(() => harness.workspaceRootStore.rootPath),
      t: (key) => key,
      hasRuntime: () => true,
      listen,
      native,
    });

    await lifecycle.startWorkspaceLifecycle();
    handler!({
      payload: { rootPath: "/elsewhere", paths: ["/elsewhere/a"], gitRelated: false },
    });
    expect(lifecycle.workspaceFsEvent.value).toBeNull();

    handler!({
      payload: { rootPath: "/repo", paths: ["/repo/src/main.ts"], gitRelated: true },
    });

    expect(native.fsUnwatchWorkspace).toHaveBeenCalled();
    expect(native.fsWatchWorkspace).toHaveBeenCalledWith("/repo");
    expect(lifecycle.workspaceFsEvent.value?.paths).toEqual(["/repo/src/main.ts"]);
  });

  it("switches WSL workspace by resolving the distro home", async () => {
    const harness = createHarness("/repo");
    const lifecycle = useWorkspaceLifecycle({
      ...harness,
      workspaceRoot: computed(() => harness.workspaceRootStore.rootPath),
      t: (key) => key,
      getWslHome: vi.fn(async () => "/home/dev"),
      hasRuntime: () => false,
    });

    await lifecycle.switchWorkspace(WSL);

    expect(harness.workspaceRootStore.openWorkspace).toHaveBeenCalledWith(
      "/home/dev",
      WSL,
    );
  });
});
