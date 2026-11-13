/**
 * `git discover` 的跨实例 single-flight 协调器 + 短 TTL 缓存。
 *
 * ## 为什么需要
 *
 * `git_discover_repositories` 会遍历工作区目录树，并对**每个**候选仓库
 * fork git 进程去问 branch / upstream —— 单次调用 0.7~1.5s（WSL 工作区
 * 更慢，因为它要先在 WSL 里跑一次 `find`）。
 *
 * 而调用方是**多份**的：每个工作区的左右两个停靠面板各挂一个
 * `SourceControlPanel`，每个面板又各有一个 `useGitRepositoryRegistry`。
 * 这些实例之间互相看不见，于是同一时刻会有多份发现请求并发打到后端；
 * 旧实现里左右面板还共享同一个「当前仓库」状态，会互相把对方的
 * 选择覆盖成 null 再打回来，形成 ping-pong —— 实测能把
 * `git_discover_repositories` 打到 **每秒 4 次以上**，把 tokio blocking
 * pool 占满，最终表现为「什么都没干但 CPU 占用 900%」。
 *
 * 这里把合并提升到 **workspace 级单例**：
 * - 同一 (scope, root, maxDepth, maxRepos) 的并发请求共享同一条后端调用；
 * - 再加一个很短的 TTL 缓存，吸收 ping-pong 造成的连续重复请求。
 *
 * ## 为什么 TTL 是安全的
 *
 * 仓库列表只会在「新建 / 删除 `.git`」时变化，而那种变化本身会触发
 * 工作区的 FS 事件 → 前端重新拉取。所以 1.5s 的窗口足够短，用户几乎
 * 不可能察觉；换来的是把「同一秒内的重复发现」彻底压成一次。
 *
 * 与 `gitStatusCoordinator` 的差别：git status 的结果是**工作区当前
 * 状态**（暂存区内容），缓存会直接让用户看到过期数据，所以那边坚持
 * 只做 single-flight；git discover 的结果是**仓库清单**，变化频率低
 * 得多，缓存代价可以接受。
 */

import type { GitRepositoryDiscovery, WorkspaceNative } from "@/lib/native";

/** 发现结果的默认缓存窗口（毫秒）。 */
export const GIT_DISCOVER_TTL_MS = 1500;

export type GitDiscoverRequest = {
  /**
   * 工作区环境标识（`local` / `wsl:Ubuntu` / `ssh:<profile>`）。
   *
   * 必须参与缓存键：同一个仓库路径在 local 与 WSL 下是两份完全不同的仓库。
   */
  scope: string;
  rootPath: string;
  /** `--max-depth`，与后端默认一致。 */
  maxDepth?: number;
  /** `--max-repos`，与后端默认一致。 */
  maxRepos?: number;
  /**
   * 要求最新结果（工作区刚有文件变化）。
   *
   * 为 true 时跳过本地 TTL 缓存 —— 否则「刚 `git init` 出来的新仓库」
   * 会在缓存窗口内看不到，而且没有后续 FS 事件就永远看不到。
   * 并发合并（single-flight）依然生效。
   */
  fresh?: boolean;
  /** 绑定到目标 workspace 环境的 native 调用面。 */
  wsNative: WorkspaceNative;
};

export type GitDiscoverCoordinatorStats = {
  /** 实际打向后端的次数。 */
  issued: number;
  /** 被 single-flight 合并掉的并发请求数。 */
  coalesced: number;
  /** 被 TTL 缓存挡下的请求数。 */
  cached: number;
};

export type GitDiscoverCoordinator = {
  request(input: GitDiscoverRequest): Promise<GitRepositoryDiscovery>;
  stats(): GitDiscoverCoordinatorStats;
  /** 清空在途状态与缓存（测试用）。 */
  reset(): void;
};

/** 生成缓存键。分隔符用 `\0`，避免路径里的字符造成歧义。 */
export function gitDiscoverRequestKey(input: {
  scope: string;
  rootPath: string;
  maxDepth?: number;
  maxRepos?: number;
}): string {
  const depth = input.maxDepth ?? 4;
  const repos = input.maxRepos ?? 32;
  return `${input.scope}\0${input.rootPath}\0${depth}\0${repos}`;
}

/**
 * 深拷贝一份发现结果。
 *
 * 缓存命中时不能把同一个数组引用交给多个调用方 —— Vue 会把它包成
 * reactive proxy，多个 ref 共享同一份 proxy 会让一个实例的更新泄漏
 * 到另一个实例。
 */
function cloneDiscovery(
  value: GitRepositoryDiscovery,
): GitRepositoryDiscovery {
  return {
    repositories: value.repositories.map((repo) => ({ ...repo })),
    truncated: value.truncated,
  };
}

export function createGitDiscoverCoordinator(options?: {
  ttlMs?: number;
}): GitDiscoverCoordinator {
  const ttlMs = options?.ttlMs ?? GIT_DISCOVER_TTL_MS;
  const inflight = new Map<
    string,
    { fresh: boolean; promise: Promise<GitRepositoryDiscovery> }
  >();
  const cached = new Map<
    string,
    { at: number; value: GitRepositoryDiscovery }
  >();
  let issued = 0;
  let coalesced = 0;
  let hits = 0;

  function pruneExpired(now: number): void {
    for (const [key, entry] of cached) {
      if (now - entry.at >= ttlMs) cached.delete(key);
    }
  }

  async function request(
    input: GitDiscoverRequest,
  ): Promise<GitRepositoryDiscovery> {
    const key = gitDiscoverRequestKey(input);
    const now = Date.now();
    pruneExpired(now);
    if (!input.fresh) {
      const hit = cached.get(key);
      if (hit) {
        hits += 1;
        return cloneDiscovery(hit.value);
      }
    }
    const existing = inflight.get(key);
    if (existing) {
      // fresh 请求要的是「工作区变化之后」的快照，不能合并到**更早**的
      // 非 fresh 请求上 —— 那份快照可能是变化之前的。
      // 但同批的 fresh 请求之间可以合并：它们要的是同一份数据。
      if (!input.fresh || existing.fresh) {
        coalesced += 1;
        return existing.promise;
      }
    }
    issued += 1;
    let promise: Promise<GitRepositoryDiscovery>;
    promise = input.wsNative
      .gitDiscoverRepositories(input.rootPath, {
        maxDepth: input.maxDepth,
        maxRepos: input.maxRepos,
        fresh: input.fresh,
      })
      .then((value) => {
        cached.set(key, { at: Date.now(), value: cloneDiscovery(value) });
        return value;
      })
      .finally(() => {
        if (inflight.get(key)?.promise === promise) inflight.delete(key);
      });
    inflight.set(key, { fresh: Boolean(input.fresh), promise });
    return promise;
  }

  return {
    request,
    stats: () => ({ issued, coalesced, cached: hits }),
    reset: () => {
      inflight.clear();
      cached.clear();
      issued = 0;
      coalesced = 0;
      hits = 0;
    },
  };
}

/**
 * 全局协调器。
 *
 * 必须是单例：合并的价值就在于「跨面板实例」。放在模块级而不是
 * Pinia 里，是因为它不承载任何 UI 状态，只是请求去重。
 */
export const gitDiscoverCoordinator = createGitDiscoverCoordinator();
