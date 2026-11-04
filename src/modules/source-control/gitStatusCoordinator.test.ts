import { describe, expect, it, vi } from "vitest";
import {
  createGitStatusCoordinator,
  gitStatusRequestKey,
} from "./gitStatusCoordinator";
import type { GitStatusSnapshot, WorkspaceNative } from "@/lib/native";

function snapshot(repoRoot: string): GitStatusSnapshot {
  return {
    repoRoot,
    branch: "master",
    upstream: null,
    ahead: 0,
    behind: 0,
    isDetached: false,
    truncated: false,
    changedFiles: [],
  };
}

function nativeWith(gitStatus: WorkspaceNative["gitStatus"]): WorkspaceNative {
  return { gitStatus } as unknown as WorkspaceNative;
}

describe("git status 协调器", () => {
  it("同一请求的并发调用只打一次后端", async () => {
    const gitStatus = vi.fn(async () => snapshot("C:/repo"));
    const coordinator = createGitStatusCoordinator();
    const input = {
      scope: "local",
      repoRoot: "C:/repo",
      untrackedMode: "normal" as const,
      wsNative: nativeWith(gitStatus),
    };

    const results = await Promise.all([
      coordinator.request(input),
      coordinator.request(input),
      coordinator.request(input),
    ]);

    expect(gitStatus).toHaveBeenCalledTimes(1);
    expect(results[0]).toBe(results[1]);
    expect(results[1]).toBe(results[2]);
    expect(coordinator.stats()).toEqual({ issued: 1, coalesced: 2 });
  });

  it("不同工作区环境 / 仓库 / 模式互不合并", async () => {
    const gitStatus = vi.fn(async (repoRoot: string) => snapshot(repoRoot));
    const coordinator = createGitStatusCoordinator();
    const base = {
      scope: "local",
      repoRoot: "C:/repo",
      untrackedMode: "normal" as const,
      wsNative: nativeWith(gitStatus),
    };

    await Promise.all([
      coordinator.request(base),
      coordinator.request({ ...base, scope: "wsl:Ubuntu" }),
      coordinator.request({ ...base, repoRoot: "C:/other" }),
      coordinator.request({ ...base, untrackedMode: "all" }),
    ]);

    expect(gitStatus).toHaveBeenCalledTimes(4);
    expect(coordinator.stats().coalesced).toBe(0);
  });

  it("顺序调用仍然每次打后端（不做 TTL 缓存）", async () => {
    const gitStatus = vi.fn(async () => snapshot("C:/repo"));
    const coordinator = createGitStatusCoordinator();
    const input = {
      scope: "local",
      repoRoot: "C:/repo",
      untrackedMode: "normal" as const,
      wsNative: nativeWith(gitStatus),
    };

    await coordinator.request(input);
    await coordinator.request(input);

    expect(gitStatus).toHaveBeenCalledTimes(2);
    expect(coordinator.stats().coalesced).toBe(0);
  });

  it("失败也会清掉在途状态，后续请求可以重试", async () => {
    let attempt = 0;
    const gitStatus = vi.fn(async () => {
      attempt += 1;
      if (attempt === 1) throw new Error("git failed");
      return snapshot("C:/repo");
    });
    const coordinator = createGitStatusCoordinator();
    const input = {
      scope: "local",
      repoRoot: "C:/repo",
      untrackedMode: "normal" as const,
      wsNative: nativeWith(gitStatus),
    };

    await expect(coordinator.request(input)).rejects.toThrow("git failed");
    await expect(coordinator.request(input)).resolves.toBeTruthy();
    expect(gitStatus).toHaveBeenCalledTimes(2);
  });

  it("缓存键区分 scope / repoRoot / untrackedMode", () => {
    const base = {
      scope: "local",
      repoRoot: "C:/repo",
      untrackedMode: "normal" as const,
    };
    expect(gitStatusRequestKey(base)).not.toBe(
      gitStatusRequestKey({ ...base, scope: "wsl:Ubuntu" }),
    );
    expect(gitStatusRequestKey(base)).not.toBe(
      gitStatusRequestKey({ ...base, repoRoot: "C:/other" }),
    );
    expect(gitStatusRequestKey(base)).not.toBe(
      gitStatusRequestKey({ ...base, untrackedMode: "all" }),
    );
  });
});
