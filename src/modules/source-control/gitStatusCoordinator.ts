/**
 * `git status` 的跨实例 single-flight 协调器。
 *
 * ## 为什么需要
 *
 * `git status` 每次都要 fork 一个 git 子进程，在大仓库里单次 100~450ms。
 * 而 `useSourceControlState` 的 in-flight 合并是**组件实例内**的：多工作区
 * 场景下每个工作区都挂着一套 source-control 面板（隐藏面板也挂载），
 * 外加文件监听每次 FS 变更都会触发一次刷新 —— 这些实例之间互相看不见，
 * 于是同一次面板刷新会并发打出 8~13 条 `git_status`（实测，见
 * `docs/architecture/06-crabnebula-devtools.md` 的性能小节）。
 *
 * 这里把合并提升到 **workspace 级单例**：同一个
 * （工作区环境, 仓库根, untracked 模式）的请求共享同一条后端调用，
 * 并发的调用方拿到同一份快照。
 *
 * 只做 single-flight、**不做 TTL 缓存**：缓存会让「刚暂存完立刻刷新」
 * 拿到旧快照（用户看到暂存没生效），而 single-flight 只影响并发窗口，
 * 顺序调用依然是每次都打后端，语义不变。
 */

import type { GitStatusSnapshot, WorkspaceNative } from "@/lib/native";

export type GitStatusUntrackedMode = "all" | "normal" | "none";

export type GitStatusRequest = {
  /**
   * 工作区环境标识（`local` / `wsl:Ubuntu` / `ssh:<profile>`）。
   *
   * 必须参与缓存键：同一个仓库路径在 local 与 WSL 下是两份完全不同的仓库。
   */
  scope: string;
  repoRoot: string;
  /**
   * `--untracked-files=` 模式。`undefined` = 交给后端用默认值（`normal`），
   * 缓存键按 `normal` 归一（两者对后端等价）。
   */
  untrackedMode?: GitStatusUntrackedMode;
  wsNative: WorkspaceNative;
};

export type GitStatusCoordinatorStats = {
  /** 实际打向后端的次数。 */
  issued: number;
  /** 被合并掉的并发请求数。 */
  coalesced: number;
};

export type GitStatusCoordinator = {
  request(input: GitStatusRequest): Promise<GitStatusSnapshot>;
  stats(): GitStatusCoordinatorStats;
  /** 清空在途状态（测试用）。 */
  reset(): void;
};

/** 生成缓存键。分隔符用 `\0`，避免路径里的字符造成歧义。 */
export function gitStatusRequestKey(input: {
  scope: string;
  repoRoot: string;
  untrackedMode?: GitStatusUntrackedMode;
}): string {
  return `${input.scope}\0${input.repoRoot}\0${input.untrackedMode ?? "normal"}`;
}

export function createGitStatusCoordinator(): GitStatusCoordinator {
  const inflight = new Map<string, Promise<GitStatusSnapshot>>();
  let issued = 0;
  let coalesced = 0;

  async function request(input: GitStatusRequest): Promise<GitStatusSnapshot> {
    const key = gitStatusRequestKey(input);
    const existing = inflight.get(key);
    if (existing) {
      coalesced += 1;
      return existing;
    }
    issued += 1;
    let promise: Promise<GitStatusSnapshot>;
    promise = input.wsNative
      .gitStatus(input.repoRoot, input.untrackedMode)
      .finally(() => {
        if (inflight.get(key) === promise) inflight.delete(key);
      });
    inflight.set(key, promise);
    return promise;
  }

  return {
    request,
    stats: () => ({ issued, coalesced }),
    reset: () => {
      inflight.clear();
      issued = 0;
      coalesced = 0;
    },
  };
}

/**
 * 全局协调器。
 *
 * 必须是单例：合并的价值就在于「跨面板实例」。放在模块级而不是
 * Pinia 里，是因为它不承载任何 UI 状态，只是请求去重。
 */
export const gitStatusCoordinator = createGitStatusCoordinator();
