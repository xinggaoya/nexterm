import { describe, expect, it, vi } from "vitest";
import {
  createGitDiscoverCoordinator,
  gitDiscoverRequestKey,
} from "./gitDiscoverCoordinator";
import type { GitRepositoryDiscovery, WorkspaceNative } from "@/lib/native";

function discovery(repoRoot: string): GitRepositoryDiscovery {
  return {
    repositories: [
      {
        repoRoot,
        relativePath: ".",
        name: "workspace",
        branch: "main",
        upstream: null,
        isDetached: false,
        isWorktree: false,
      },
    ],
    truncated: false,
  };
}

function nativeWith(
  gitDiscoverRepositories: WorkspaceNative["gitDiscoverRepositories"],
): WorkspaceNative {
  return { gitDiscoverRepositories } as unknown as WorkspaceNative;
}

describe("git discover 协调器", () => {
  it("同一请求的并发调用只打一次后端", async () => {
    const gitDiscoverRepositories = vi.fn(async () => discovery("C:/repo"));
    const coordinator = createGitDiscoverCoordinator();
    const input = {
      scope: "local",
      rootPath: "C:/repo",
      wsNative: nativeWith(gitDiscoverRepositories),
    };

    const results = await Promise.all([
      coordinator.request(input),
      coordinator.request(input),
      coordinator.request(input),
    ]);

    expect(gitDiscoverRepositories).toHaveBeenCalledTimes(1);
    expect(results[0]).toBe(results[1]);
    expect(results[1]).toBe(results[2]);
    expect(coordinator.stats()).toEqual({
      issued: 1,
      coalesced: 2,
      cached: 0,
    });
  });

  it("不同工作区环境 / 根路径 / 深度互不合并", async () => {
    const gitDiscoverRepositories = vi.fn(async () => discovery("C:/repo"));
    const coordinator = createGitDiscoverCoordinator();
    const base = {
      scope: "local",
      rootPath: "C:/repo",
      wsNative: nativeWith(gitDiscoverRepositories),
    };

    await Promise.all([
      coordinator.request(base),
      coordinator.request({ ...base, scope: "wsl:Ubuntu" }),
      coordinator.request({ ...base, rootPath: "C:/other" }),
      coordinator.request({ ...base, maxDepth: 2 }),
    ]);

    expect(gitDiscoverRepositories).toHaveBeenCalledTimes(4);
    expect(coordinator.stats().coalesced).toBe(0);
  });

  it("TTL 窗口内的顺序调用复用缓存，不打后端", async () => {
    const gitDiscoverRepositories = vi.fn(async () => discovery("C:/repo"));
    const coordinator = createGitDiscoverCoordinator();
    const input = {
      scope: "local",
      rootPath: "C:/repo",
      wsNative: nativeWith(gitDiscoverRepositories),
    };

    await coordinator.request(input);
    await coordinator.request(input);

    expect(gitDiscoverRepositories).toHaveBeenCalledTimes(1);
    expect(coordinator.stats().cached).toBe(1);
  });

  it("TTL 过期后重新打后端", async () => {
    vi.useFakeTimers();
    try {
      const gitDiscoverRepositories = vi.fn(async () => discovery("C:/repo"));
      const coordinator = createGitDiscoverCoordinator({ ttlMs: 1000 });
      const input = {
        scope: "local",
        rootPath: "C:/repo",
        wsNative: nativeWith(gitDiscoverRepositories),
      };

      await coordinator.request(input);
      vi.advanceTimersByTime(1001);
      await coordinator.request(input);

      expect(gitDiscoverRepositories).toHaveBeenCalledTimes(2);
    } finally {
      vi.useRealTimers();
    }
  });

  it("fresh 请求跳过缓存，重新打后端", async () => {
    const gitDiscoverRepositories = vi.fn(async () => discovery("C:/repo"));
    const coordinator = createGitDiscoverCoordinator();
    const base = {
      scope: "local",
      rootPath: "C:/repo",
      wsNative: nativeWith(gitDiscoverRepositories),
    };

    await coordinator.request(base);
    expect(gitDiscoverRepositories).toHaveBeenCalledTimes(1);

    // fresh 绕过缓存 → 重新打后端
    await coordinator.request({ ...base, fresh: true });
    expect(gitDiscoverRepositories).toHaveBeenCalledTimes(2);
  });

  it("fresh 请求不与更早的非 fresh 在途请求合并", async () => {
    const resolvers: Array<(value: GitRepositoryDiscovery) => void> = [];
    const gitDiscoverRepositories = vi.fn(
      () =>
        new Promise<GitRepositoryDiscovery>((resolve) => {
          resolvers.push(resolve);
        }),
    );
    const coordinator = createGitDiscoverCoordinator();
    const base = {
      scope: "local",
      rootPath: "C:/repo",
      wsNative: nativeWith(gitDiscoverRepositories),
    };

    // 一个未完成的普通请求 —— 它的快照可能已经过时
    const stale = coordinator.request(base);
    // fresh 请求不能复用它
    const fresh = coordinator.request({ ...base, fresh: true });
    expect(gitDiscoverRepositories).toHaveBeenCalledTimes(2);

    resolvers[1](discovery("C:/repo"));
    await fresh;
    resolvers[0](discovery("C:/repo"));
    await stale;
  });

  it("同批 fresh 请求互相合并", async () => {
    const gitDiscoverRepositories = vi.fn(async () => discovery("C:/repo"));
    const coordinator = createGitDiscoverCoordinator();
    const base = {
      scope: "local",
      rootPath: "C:/repo",
      fresh: true,
      wsNative: nativeWith(gitDiscoverRepositories),
    };

    await Promise.all([
      coordinator.request(base),
      coordinator.request(base),
      coordinator.request(base),
    ]);

    expect(gitDiscoverRepositories).toHaveBeenCalledTimes(1);
    expect(coordinator.stats().coalesced).toBe(2);
  });

  it("失败不会写缓存，后续请求可以重试", async () => {
    let attempt = 0;
    const gitDiscoverRepositories = vi.fn(async () => {
      attempt += 1;
      if (attempt === 1) throw new Error("discover failed");
      return discovery("C:/repo");
    });
    const coordinator = createGitDiscoverCoordinator();
    const input = {
      scope: "local",
      rootPath: "C:/repo",
      wsNative: nativeWith(gitDiscoverRepositories),
    };

    await expect(coordinator.request(input)).rejects.toThrow("discover failed");
    await expect(coordinator.request(input)).resolves.toBeTruthy();
    expect(gitDiscoverRepositories).toHaveBeenCalledTimes(2);
  });

  it("缓存命中返回的是副本，调用方改不到缓存内容", async () => {
    const gitDiscoverRepositories = vi.fn(async () => discovery("C:/repo"));
    const coordinator = createGitDiscoverCoordinator();
    const input = {
      scope: "local",
      rootPath: "C:/repo",
      wsNative: nativeWith(gitDiscoverRepositories),
    };

    const first = await coordinator.request(input);
    first.repositories[0].branch = "mutated";
    const second = await coordinator.request(input);

    expect(second.repositories[0].branch).toBe("main");
    expect(second).not.toBe(first);
  });

  it("缓存键区分 scope / rootPath / maxDepth / maxRepos", () => {
    const base = {
      scope: "local",
      rootPath: "C:/repo",
      maxDepth: 4,
      maxRepos: 32,
    };
    expect(gitDiscoverRequestKey(base)).not.toBe(
      gitDiscoverRequestKey({ ...base, scope: "wsl:Ubuntu" }),
    );
    expect(gitDiscoverRequestKey(base)).not.toBe(
      gitDiscoverRequestKey({ ...base, rootPath: "C:/other" }),
    );
    expect(gitDiscoverRequestKey(base)).not.toBe(
      gitDiscoverRequestKey({ ...base, maxDepth: 2 }),
    );
    expect(gitDiscoverRequestKey(base)).not.toBe(
      gitDiscoverRequestKey({ ...base, maxRepos: 8 }),
    );
  });
});
