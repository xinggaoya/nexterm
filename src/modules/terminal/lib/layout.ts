/**
 * Pane tree model (v2). Each tab owns a tree of terminal panes organized as
 * either `leaf` nodes (one running shell) or `split` nodes (row/column
 * containers with children). All operations accept whatever id type the
 * caller already uses and produce new immutable nodes so Pinia's reactivity
 * sees a top-level identity change.
 */

export type SplitDir = "row" | "col";

export type LeafId = string | number;

export type PaneLeaf = {
  kind: "leaf";
  id: LeafId;
  cwd?: string;
  /** Per-leaf title tracked independently from the tab-level title. */
  terminalTitle?: string;
  /** Initial input queued for the PTY after the session opens. */
  startupInput?: string;
  /** Flex share inside a split; defaults to 1 when omitted. */
  size?: number;
};

export type PaneSplit = {
  kind: "split";
  id: LeafId;
  dir: SplitDir;
  size?: number;
  children: PaneNode[];
};

export type PaneNode = PaneLeaf | PaneSplit;

export function isLeaf(node: PaneNode): node is PaneLeaf {
  return node.kind === "leaf";
}

let stringCounter = 0;
export function newPaneId(): LeafId {
  stringCounter = (stringCounter + 1) & 0xffff;
  return `p${stringCounter.toString(36)}${Math.random().toString(36).slice(2, 5)}`;
}

export function createLeaf(cwd?: string): PaneLeaf {
  return { kind: "leaf", id: newPaneId(), cwd, size: 1 };
}

export function createSplit(
  dir: SplitDir,
  children: PaneNode[],
): PaneSplit {
  return {
    kind: "split",
    id: newPaneId(),
    dir,
    size: 1,
    children,
  };
}

function transformLeaf(
  node: PaneNode,
  leafId: LeafId,
  fn: (leaf: PaneLeaf) => PaneNode,
): PaneNode {
  if (node.kind === "leaf") {
    return node.id === leafId ? fn(node) : node;
  }
  return {
    ...node,
    children: node.children.map((c) => transformLeaf(c, leafId, fn)),
  };
}

function transformNode(
  node: PaneNode,
  id: LeafId,
  fn: (node: PaneNode) => PaneNode,
): PaneNode {
  if (node.id === id) return fn(node);
  if (node.kind === "leaf") return node;
  return { ...node, children: node.children.map((c) => transformNode(c, id, fn)) };
}

export function hasLeaf(root: PaneNode, leafId: LeafId): boolean {
  return findLeaf(root, leafId) !== null;
}

export function findLeaf(root: PaneNode, leafId: LeafId): PaneLeaf | null {
  if (root.kind === "leaf") {
    return root.id === leafId ? root : null;
  }
  for (const child of root.children) {
    const hit = findLeaf(child, leafId);
    if (hit) return hit;
  }
  return null;
}

export function leafIds(root: PaneNode): LeafId[] {
  if (root.kind === "leaf") return [root.id];
  return root.children.flatMap(leafIds);
}

export function findLeafCwd(
  root: PaneNode,
  leafId: LeafId,
): string | undefined {
  return findLeaf(root, leafId)?.cwd;
}

export function findLeafTitle(
  root: PaneNode,
  leafId: LeafId,
): string | undefined {
  return findLeaf(root, leafId)?.terminalTitle;
}

export function setLeafCwd(
  root: PaneNode,
  leafId: LeafId,
  cwd: string,
): PaneNode {
  return transformLeaf(root, leafId, (leaf) => ({ ...leaf, cwd }));
}

export function setLeafTitle(
  root: PaneNode,
  leafId: LeafId,
  terminalTitle: string,
): PaneNode {
  return transformLeaf(root, leafId, (leaf) => ({ ...leaf, terminalTitle }));
}

export function splitLeaf(
  root: PaneNode,
  targetLeafId: LeafId,
  dir: SplitDir,
  newLeafId?: LeafId,
  cwd?: string,
  newSplitId?: LeafId,
): { tree: PaneNode; leafId: LeafId; splitId: LeafId } {
  const leafId = newLeafId ?? newPaneId();
  const splitId = newSplitId ?? newPaneId();
  const newLeaf: PaneLeaf = { kind: "leaf", id: leafId, cwd, size: 1 };
  return {
    tree: transformLeaf(root, targetLeafId, (leaf) => ({
      kind: "split",
      id: splitId,
      dir,
      size: 1,
      children: [leaf, newLeaf],
    })),
    leafId,
    splitId,
  };
}

export function removeLeaf(
  root: PaneNode,
  leafId: LeafId,
): PaneNode | null {
  if (root.kind === "leaf") {
    return root.id === leafId ? null : root;
  }
  const newChildren: PaneNode[] = [];
  for (const child of root.children) {
    if (child.kind === "leaf" && child.id === leafId) continue;
    const replaced = removeLeaf(child, leafId);
    if (replaced !== null) newChildren.push(replaced);
  }
  if (newChildren.length === 0) return null;
  if (newChildren.length === 1) return newChildren[0];
  return { ...root, children: newChildren };
}

export function siblingLeafOf(
  root: PaneNode,
  leafId: LeafId,
): LeafId | null {
  if (root.kind === "leaf") return null;
  for (let i = 0; i < root.children.length; i++) {
    const child = root.children[i];
    if (child.kind === "leaf" && child.id === leafId) {
      if (i > 0) {
        const prev = root.children[i - 1];
        return prev.kind === "leaf" ? prev.id : lastLeafId(prev);
      }
      return null;
    }
    const nested = siblingLeafOf(child, leafId);
    if (nested !== null) return nested;
  }
  return null;
}

function lastLeafId(node: PaneNode): LeafId {
  if (node.kind === "leaf") return node.id;
  return lastLeafId(node.children[node.children.length - 1]);
}

export function nextLeafInDir(
  root: PaneNode,
  leafId: LeafId,
  dir: "left" | "right" | "up" | "down",
): LeafId | null {
  const bounds = leafBounds(root);
  if (!bounds) return null;
  const target = bounds.find((b) => b.leafId === leafId);
  if (!target) return null;
  let best: { leafId: LeafId; score: number } | null = null;
  for (const b of bounds) {
    if (b.leafId === leafId) continue;
    const isHorizontal = dir === "left" || dir === "right";
    const primary = isHorizontal ? b.centerX - target.centerX : b.centerY - target.centerY;
    const primaryOverlap = isHorizontal
      ? rangeOverlap(target.y1, target.y2, b.y1, b.y2)
      : rangeOverlap(target.x1, target.x2, b.x1, b.x2);
    if (dir === "left" || dir === "up") {
      if (primary >= 0) continue;
    } else {
      if (primary <= 0) continue;
    }
    const distance = Math.abs(primary);
    const score = primaryOverlap / Math.max(distance, 1);
    if (best === null || score > best.score) {
      best = { leafId: b.leafId, score };
    }
  }
  return best?.leafId ?? null;
}

type LeafBounds = {
  leafId: LeafId;
  x1: number;
  x2: number;
  y1: number;
  y2: number;
  centerX: number;
  centerY: number;
};

function leafBounds(root: PaneNode): LeafBounds[] | null {
  const out: LeafBounds[] = [];
  const walk = (node: PaneNode, frame: { x1: number; y1: number; x2: number; y2: number }) => {
    if (frame.x2 <= frame.x1 || frame.y2 <= frame.y1) return;
    if (node.kind === "leaf") {
      out.push({
        leafId: node.id,
        x1: frame.x1,
        x2: frame.x2,
        y1: frame.y1,
        y2: frame.y2,
        centerX: (frame.x1 + frame.x2) / 2,
        centerY: (frame.y1 + frame.y2) / 2,
      });
      return;
    }
    const totalSize = node.children.reduce(
      (sum, c) => sum + (c.size || 1),
      0,
    );
    const isRow = node.dir === "row";
    const totalLength = isRow
      ? frame.x2 - frame.x1
      : frame.y2 - frame.y1;
    let cursor = isRow ? frame.x1 : frame.y1;
    for (const child of node.children) {
      const share = (child.size || 1) / totalSize;
      const length = totalLength * share;
      if (isRow) {
        walk(child, { x1: cursor, x2: cursor + length, y1: frame.y1, y2: frame.y2 });
      } else {
        walk(child, { x1: frame.x1, x2: frame.x2, y1: cursor, y2: cursor + length });
      }
      cursor += length;
    }
  };
  walk(root, { x1: 0, y1: 0, x2: 100, y2: 100 });
  return out.length > 0 ? out : null;
}

function rangeOverlap(a1: number, a2: number, b1: number, b2: number): number {
  const start = Math.max(a1, b1);
  const end = Math.min(a2, b2);
  return Math.max(0, end - start);
}

export function resizeSplit(
  root: PaneNode,
  splitId: LeafId,
  childIndex: number,
  delta: number,
  containerSize: number,
): PaneNode {
  return transformNode(root, splitId, (node) => {
    if (node.kind !== "split") return node;
    const a = node.children[childIndex];
    const b = node.children[childIndex + 1];
    if (!a || !b) return node;
    const aSize = a.size || 1;
    const bSize = b.size || 1;
    const total = aSize + bSize;
    const pxPerSize = containerSize / total;
    const newASizePx = aSize * pxPerSize + delta;
    const clampedPx = Math.max(40, Math.min(containerSize - 40, newASizePx));
    const newASize = clampedPx / pxPerSize;
    const newBSize = total - newASize;
    return {
      ...node,
      children: node.children.map((c, idx) =>
        idx === childIndex
          ? { ...c, size: newASize }
          : idx === childIndex + 1
            ? { ...c, size: newBSize }
            : c,
      ),
    };
  });
}

export function resetSplitSizes(split: PaneSplit): PaneSplit {
  const equal = 1;
  return {
    ...split,
    children: split.children.map((c) => ({ ...c, size: equal })),
  };
}

export function findSplitWithChild(root: PaneNode, leafId: LeafId): {
  split: PaneSplit;
  index: number;
} | null {
  if (root.kind === "leaf") return null;
  for (let i = 0; i < root.children.length; i++) {
    const child = root.children[i];
    if (child.kind === "leaf" && child.id === leafId) {
      return { split: root, index: i };
    }
    if (child.kind === "split") {
      const nested = findSplitWithChild(child, leafId);
      if (nested) return nested;
    }
  }
  return null;
}
