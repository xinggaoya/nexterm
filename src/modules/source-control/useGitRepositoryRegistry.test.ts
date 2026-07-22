// @vitest-environment jsdom
import { nextTick, ref } from "vue";
import { afterEach, describe, expect, it, vi } from "vitest";
import type {
  GitRepositoryDiscovery,
  GitWorkspaceRepo,
  WorkspaceFsChangedEvent,
  WorkspaceNative,
} from "@/lib/native";
import { useGitRepositoryRegistry } from "./useGitRepositoryRegistry";

function repository(
  repoRoot: string,
  relativePath: string,
  branch = "main",
): GitWorkspaceRepo {
  return {
    repoRoot,
    relativePath,
    name: relativePath === "." ? "workspace" : relativePath,
    branch,
    upstream: null,
    isDetached: false,
    isWorktree: false,
  };
}

async function flush() {
  await Promise.resolve();
  await nextTick();
}

describe("useGitRepositoryRegistry", () => {
  afterEach(() => {
    vi.useRealTimers();
  });

  it("loads repositories and chooses the first repository when no selection exists", async () => {
    const rootPath = ref<string | null>("/workspace");
    const workspaceScope = ref("local");
    const fsEvent = ref<WorkspaceFsChangedEvent | null>(null);
    const wsNative = {
      gitDiscoverRepositories: vi
        .fn<(root: string, options?: { maxDepth?: number; maxRepos?: number }) => Promise<GitRepositoryDiscovery>>()
        .mockResolvedValue({
          repositories: [
            repository("/workspace/apps/web", "apps/web"),
            repository("/workspace/packages/core", "packages/core"),
          ],
          truncated: false,
        }),
    };

    const registry = useGitRepositoryRegistry({ rootPath, workspaceScope, fsEvent, wsNative: wsNative as unknown as WorkspaceNative });
    await flush();

    let activeRepoRoot: string | null = null;
    if (!registry.isValidRepoRoot(activeRepoRoot)) {
      activeRepoRoot = registry.repositories.value[0]?.repoRoot ?? null;
    }

    expect(wsNative.gitDiscoverRepositories).toHaveBeenCalledWith("/workspace", {
      maxDepth: 4,
      maxRepos: 32,
    });
    expect(registry.repositories.value).toHaveLength(2);
    expect(activeRepoRoot).toBe("/workspace/apps/web");
    expect(registry.loading.value).toBe(false);
    expect(registry.error.value).toBeNull();
    registry.dispose();
  });

  it("does not replace newer discovery results with an older request", async () => {
    const rootPath = ref<string | null>("/workspace");
    const workspaceScope = ref("local");
    const fsEvent = ref<WorkspaceFsChangedEvent | null>(null);
    const resolvers: Array<(result: GitRepositoryDiscovery) => void> = [];
    const wsNative = {
      gitDiscoverRepositories: vi.fn(
        () =>
          new Promise<GitRepositoryDiscovery>((resolve) => {
            resolvers.push(resolve);
          }),
      ),
    };

    const registry = useGitRepositoryRegistry({ rootPath, workspaceScope, fsEvent, wsNative: wsNative as unknown as WorkspaceNative });
    await nextTick();
    const newerRefresh = registry.refresh();
    expect(resolvers).toHaveLength(2);

    resolvers[1]({
      repositories: [repository("/workspace/newer", "newer")],
      truncated: true,
    });
    await newerRefresh;
    expect(registry.repositories.value[0]?.repoRoot).toBe("/workspace/newer");
    expect(registry.truncated.value).toBe(true);

    resolvers[0]({
      repositories: [repository("/workspace/older", "older")],
      truncated: false,
    });
    await flush();

    expect(registry.repositories.value[0]?.repoRoot).toBe("/workspace/newer");
    expect(registry.truncated.value).toBe(true);
    registry.dispose();
  });

  it("refreshes after a matching workspace filesystem event", async () => {
    vi.useFakeTimers();
    const rootPath = ref<string | null>("/workspace");
    const workspaceScope = ref("local");
    const fsEvent = ref<WorkspaceFsChangedEvent | null>(null);
    const wsNative = {
      gitDiscoverRepositories: vi
        .fn<(root: string, options?: { maxDepth?: number; maxRepos?: number }) => Promise<GitRepositoryDiscovery>>()
        .mockResolvedValue({
          repositories: [repository("/workspace", ".")],
          truncated: false,
        }),
    };

    const registry = useGitRepositoryRegistry({ rootPath, workspaceScope, fsEvent, wsNative: wsNative as unknown as WorkspaceNative });
    await flush();
    expect(wsNative.gitDiscoverRepositories).toHaveBeenCalledTimes(1);

    fsEvent.value = {
      rootPath: "/workspace",
      paths: ["/workspace/apps/new-repo/.git/HEAD"],
      gitRelated: true,
    };
    await nextTick();
    await vi.advanceTimersByTimeAsync(249);
    expect(wsNative.gitDiscoverRepositories).toHaveBeenCalledTimes(1);

    await vi.advanceTimersByTimeAsync(1);
    await flush();
    expect(wsNative.gitDiscoverRepositories).toHaveBeenCalledTimes(2);
    registry.dispose();
  });

  it("rejects an active root that is no longer in the discovery result", async () => {
    const rootPath = ref<string | null>("/workspace");
    const workspaceScope = ref("local");
    const fsEvent = ref<WorkspaceFsChangedEvent | null>(null);
    const wsNative = {
      gitDiscoverRepositories: vi
        .fn<(root: string, options?: { maxDepth?: number; maxRepos?: number }) => Promise<GitRepositoryDiscovery>>()
        .mockResolvedValueOnce({
          repositories: [
            repository("/workspace/repo-a", "repo-a"),
            repository("/workspace/repo-b", "repo-b"),
          ],
          truncated: false,
        })
        .mockResolvedValueOnce({
          repositories: [repository("/workspace/repo-a", "repo-a")],
          truncated: false,
        }),
    };

    const registry = useGitRepositoryRegistry({ rootPath, workspaceScope, fsEvent, wsNative: wsNative as unknown as WorkspaceNative });
    await flush();
    let activeRepoRoot: string | null = "/workspace/repo-b";
    expect(registry.isValidRepoRoot(activeRepoRoot)).toBe(true);

    await registry.refresh();
    if (!registry.isValidRepoRoot(activeRepoRoot)) {
      activeRepoRoot = registry.repositories.value[0]?.repoRoot ?? null;
    }

    expect(registry.isValidRepoRoot("/workspace/repo-b")).toBe(false);
    expect(activeRepoRoot).toBe("/workspace/repo-a");
    registry.dispose();
  });

  it("clears repository ownership when switching workspaces and discovery fails", async () => {
    const rootPath = ref<string | null>("/workspace-a");
    const workspaceScope = ref("local");
    const fsEvent = ref<WorkspaceFsChangedEvent | null>(null);
    const wsNative = {
      gitDiscoverRepositories: vi
        .fn<(root: string, options?: { maxDepth?: number; maxRepos?: number }) => Promise<GitRepositoryDiscovery>>()
        .mockResolvedValueOnce({
          repositories: [repository("/workspace-a/repo", "repo")],
          truncated: true,
        })
        .mockRejectedValueOnce(new Error("workspace B discovery failed")),
    };

    const registry = useGitRepositoryRegistry({ rootPath, workspaceScope, fsEvent, wsNative: wsNative as unknown as WorkspaceNative });
    await flush();
    expect(registry.isValidRepoRoot("/workspace-a/repo")).toBe(true);
    expect(registry.truncated.value).toBe(true);

    rootPath.value = "/workspace-b";

    expect(registry.repositories.value).toEqual([]);
    expect(registry.truncated.value).toBe(false);
    expect(registry.error.value).toBeNull();
    expect(registry.isValidRepoRoot("/workspace-a/repo")).toBe(false);

    await flush();

    expect(wsNative.gitDiscoverRepositories).toHaveBeenLastCalledWith(
      "/workspace-b",
      { maxDepth: 4, maxRepos: 32 },
    );
    expect(registry.repositories.value).toEqual([]);
    expect(registry.error.value).toBe("workspace B discovery failed");
    expect(registry.isValidRepoRoot("/workspace-a/repo")).toBe(false);
    registry.dispose();
  });

  it("invalidates repository ownership when only the workspace scope changes", async () => {
    const rootPath = ref<string | null>("/workspace");
    const workspaceScope = ref("local");
    const fsEvent = ref<WorkspaceFsChangedEvent | null>(null);
    const wsNative = {
      gitDiscoverRepositories: vi
        .fn<(root: string, options?: { maxDepth?: number; maxRepos?: number }) => Promise<GitRepositoryDiscovery>>()
        .mockResolvedValueOnce({
          repositories: [repository("/workspace/repo", "repo")],
          truncated: true,
        })
        .mockRejectedValueOnce(new Error("WSL discovery failed")),
    };

    const registry = useGitRepositoryRegistry({
      rootPath,
      workspaceScope,
      fsEvent,
      wsNative: wsNative as unknown as WorkspaceNative,
    });
    await flush();
    expect(registry.isValidRepoRoot("/workspace/repo")).toBe(true);

    workspaceScope.value = "wsl:Ubuntu";

    expect(registry.repositories.value).toEqual([]);
    expect(registry.truncated.value).toBe(false);
    expect(registry.error.value).toBeNull();
    expect(registry.isValidRepoRoot("/workspace/repo")).toBe(false);

    await flush();

    expect(wsNative.gitDiscoverRepositories).toHaveBeenCalledTimes(2);
    expect(registry.repositories.value).toEqual([]);
    expect(registry.error.value).toBe("WSL discovery failed");
    expect(registry.isValidRepoRoot("/workspace/repo")).toBe(false);
    registry.dispose();
  });
});
