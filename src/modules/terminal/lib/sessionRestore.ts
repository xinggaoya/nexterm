/**
 * 终端布局的持久化与恢复。
 *
 * 能恢复什么、不能恢复什么，说在前面：
 *
 * - **能恢复**：标签的排列、每个分屏叶子的 `cwd`、以及任务终端的启动命令。
 *   重启后这些终端会重新拉起，落在同一个工作目录。
 * - **不能恢复**：运行中的进程与回滚缓冲。PTY 的内存缓冲无法序列化，
 *   试图"热恢复"一个已经死掉的 shell 只会得到比重新开一个更糟的结果。
 *   因此这里明确只恢复"意图"（我打开过哪些终端、在哪），不假装恢复"状态"。
 *
 * 纯函数：持久化形状 → 标签描述 的转换在这里做，store 只负责读写存储。
 */
import type { LeafId, PaneLeaf, PaneNode } from "./layout";

/** 持久化的一个分屏叶子。 */
export type PersistedLeaf = {
  /** 相对布局的路径（如 "0.3"），恢复时按路径重新分配 id。 */
  path: string;
  cwd?: string;
  /** 任务终端的启动命令；普通 shell 为空。 */
  startupInput?: string;
};

export type PersistedTerminal = {
  title: string;
  /** 是否"固定"（非预览）标签。预览标签恢复意义不大且会占位。 */
  pinned: boolean;
  activeLeafPath: string;
  leaves: PersistedLeaf[];
};

export type PersistedTerminalLayout = {
  terminals: PersistedTerminal[];
  activeTerminalIndex: number;
};

/** 单个标签的恢复描述（tabs store 据此重建）。 */
export type RestoredTerminal = {
  title: string;
  activeLeafIndex: number;
  leaves: Array<{ cwd?: string; startupInput?: string }>;
};

/**
 * 叶子路径（相对下标序列）→ 在新树里的位置。
 *
 * 用下标而不是持久化 leaf id：id 是运行时生成的 `pXXXX`，重启后必然冲突。
 * 布局的**形状**（嵌套与分屏比例）由 PaneNode 本身重建，路径只用来把
 * `cwd` / `startupInput` 对应回正确的位置。
 */
/** 叶子路径（相对下标序列）→ 叶子节点本身。 */
function resolveLeaf(node: PaneNode, path: string): PaneLeaf | null {
  let cursor: PaneNode = node;
  for (const step of path.split(".").filter(Boolean)) {
    if (cursor.kind !== "split") return null;
    const child = cursor.children[Number(step)];
    if (!child) return null;
    cursor = child;
  }
  return cursor.kind === "leaf" ? cursor : null;
}

function collectLeafPaths(node: PaneNode, prefix: string, out: string[]): void {
  if (node.kind === "leaf") {
    out.push(prefix);
    return;
  }
  node.children.forEach((child, index) => {
    // 不产生前导点：根的子节点路径是 "0" 而不是 ".0"
    collectLeafPaths(child, prefix === "" ? `${index}` : `${prefix}.${index}`, out);
  });
}

type TerminalLike = {
  kind: string;
  title: string;
  paneTree: PaneNode;
  activeLeafId: LeafId;
  /** 任务终端一般不固定；缺失时按固定处理。 */
  isPinnedTerminal?: boolean;
};

/** 终端标签 → 持久化形状。 */
export function serializeTerminal(tab: TerminalLike): PersistedTerminal | null {
  if (tab.kind !== "terminal") return null;
  const paths: string[] = [];
  collectLeafPaths(tab.paneTree, "", paths);
  const activePath = paths.find(
    (path) => resolveLeaf(tab.paneTree, path)?.id === tab.activeLeafId,
  );
  return {
    title: tab.title,
    pinned: tab.isPinnedTerminal ?? true,
    activeLeafPath: activePath ?? paths[0] ?? "",
    // 把 cwd / 启动命令一并带出：它们才是恢复时真正有用的信息，
    // 路径本身只用于恢复时的位置对应。
    leaves: paths.map((path) => {
      const leaf = resolveLeaf(tab.paneTree, path);
      return {
        path,
        ...(leaf?.cwd ? { cwd: leaf.cwd } : {}),
        ...(leaf?.startupInput ? { startupInput: leaf.startupInput } : {}),
      };
    }),
  };
}

/** 从布局的持久化形状 → 恢复描述。 */
export function deserializeTerminals(
  layout: PersistedTerminalLayout | null | undefined,
): { terminals: RestoredTerminal[]; activeIndex: number } {
  const list = layout?.terminals ?? [];
  const terminals = list
    .filter((entry) => entry && Array.isArray(entry.leaves) && entry.leaves.length > 0)
    .map((entry) => {
      const activeIndex = Math.max(
        entry.leaves.findIndex((leaf) => leaf.path === entry.activeLeafPath),
        0,
      );
      return {
        title: entry.title,
        activeLeafIndex: Math.min(activeIndex, entry.leaves.length - 1),
        leaves: entry.leaves.map((leaf) => ({
          cwd: leaf.cwd,
          startupInput: leaf.startupInput,
        })),
      };
    });
  const activeIndex = Math.min(
    Math.max(layout?.activeTerminalIndex ?? 0, 0),
    Math.max(terminals.length - 1, 0),
  );
  return { terminals, activeIndex };
}

/** 布局是否值得持久化（只有一个裸 shell 时不值得，重启后开一个就行）。 */
export function isWorthPersisting(tabs: readonly TerminalLike[]): boolean {
  const meaningful = tabs.filter((tab) => tab.kind === "terminal");
  return meaningful.length > 1 || meaningful.some((tab) => tab.paneTree.kind === "split");
}
