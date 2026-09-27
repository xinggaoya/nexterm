import { basename, dirname } from "@/lib/path";
import { useEventListener } from "@/lib/useEventListener";
import { usePointerDragReorder } from "@/lib/usePointerDragReorder";
import { hasTauriInternals } from "@/lib/tauriRuntime";
import { onFsTransferProgress, onOsFileDragDrop } from "@/lib/native";
import type {
  FsConflictPolicy,
  FsTransferProgress,
  FsTransferResult,
  OsFileDragEvent,
  WorkspaceNative,
} from "@/lib/native";
import {
  notifyError,
  notifyInfo,
  notifySuccess,
} from "@/modules/notifications/notificationCenter";
import { t, type MessageKey } from "@/modules/i18n/translate";
import { computed, onBeforeUnmount, ref, watch, type Ref } from "vue";
import { useFileClipboard } from "../lib/fileClipboard";
import {
  canTransferInto,
  describeRejections,
  isInsideDir,
  planTransfer,
  summarizeTransfer,
  type PlanPolicy,
  type RejectReason,
  type TransferMode,
} from "../lib/fileTransfer";
import type { ConflictRequest } from "../FileTransferConflictDialog.vue";

/**
 * 文件搬运层：拖拽、剪贴板、OS 拖入三条入口共用同一套计划解析、冲突
 * 征询、执行与结果汇报。
 *
 * 为什么必须合在一起：三者只是"什么时候触发"不同。如果各自实现一遍，
 * 迟早出现"拖拽能搬、粘贴不能搬"或者"拖拽会问覆盖、粘贴直接失败"这种
 * 行为分叉 —— 而这类分叉极难在 review 里发现。
 *
 * 边界：
 * - 不负责渲染（只暴露拖拽 ghost / 落点状态给模板）
 * - 不负责打开文件 / 跳标签（只 emit pathRenamed 给宿主）
 * - 不直接改树数据（只调 loadChildren 让数据层重读）
 */
export type TreeTransferOptions = {
  wsNative: WorkspaceNative;
  /** 工作区根（props.rootPath）。null 时所有搬运入口都不可用。 */
  rootPath: Ref<string | null>;
  /** 树的滚动容器（边缘自动滚动用）。 */
  treeScroll: Ref<HTMLElement | null>;
  /** 数据层：重读一个目录。 */
  loadChildren: (path: string, options?: { silent?: boolean }) => Promise<void>;
  /** 路径的父目录。 */
  parentOf: (path: string) => string;
  /** 当前可见的 entry 路径（树的可见顺序）。 */
  entryPaths: Ref<string[]>;
  /** 当前多选集（拖拽源、粘贴落点都要读它）。 */
  selectedPaths: Ref<ReadonlySet<string>>;
  /** 展开中的目录集合（搬运完成后展开目标目录）。 */
  expanded: Set<string>;
  /** 行集变化后由数据层重建。 */
  rebuildSnapshot: () => void;
  /** 已加载目录的条目名集合；未加载返回 null（表示"判不了"）。 */
  entryNamesOf: (dir: string) => Set<string> | null;
  /** 目录里的某个条目是否是目录。 */
  isEntryDir: (dir: string, name: string) => boolean;
  /** 移动完成后让已打开的编辑器标签跟随新路径。 */
  onPathRenamed: (from: string, to: string) => void;
  /** 拖拽是否允许启动（搜索模式 / 内联输入中 / 搬运进行中）。 */
  isDragBlocked: () => boolean;
};

type PendingTransfer = {
  sources: string[];
  targetDir: string;
  mode: TransferMode;
};

type DragGhost = { path: string; count: number; names: string[] };

/** 一次进行中的搬运：operationId 用于订阅进度与发起取消。 */
export type ActiveTransfer = {
  operationId: number;
  mode: TransferMode;
  /** 总条目数，进度条未收到事件前也有值。 */
  total: number;
  progress: FsTransferProgress;
};

/** 悬停折叠目录多久自动展开。 */
const HOVER_EXPAND_DELAY_MS = 600;
/** 距容器上下边缘多少像素开始自动滚动。 */
const EDGE_SCROLL_ZONE = 28;
/** 单帧最大滚动量。 */
const EDGE_SCROLL_SPEED = 12;

/** 字节数的人类可读形式（与 i18n 的单位无关，数字部分仍走 i18n）。 */
/** 路径的父目录（搬运层要用它算撤销的目标目录）。 */
function dirnameOfPath(path: string): string {
  return dirname(path);
}

function formatBytes(bytes: number): string {
  const units = ["B", "KB", "MB", "GB", "TB"] as const;
  let value = bytes;
  let unit = 0;
  while (value >= 1024 && unit < units.length - 1) {
    value /= 1024;
    unit += 1;
  }
  return `${value >= 100 || unit === 0 ? Math.round(value) : value.toFixed(1)} ${units[unit]}`;
}

const REJECTION_MESSAGE: Record<RejectReason, MessageKey> = {
  self: "explorer.transferRejectedSelf",
  "own-subtree": "explorer.transferRejectedSubtree",
  "same-directory": "explorer.transferRejectedSameDir",
  "missing-source": "explorer.transferRejected",
};

export function useTreeTransfer(options: TreeTransferOptions) {
  const clipboard = useFileClipboard();
  const transferBusy = ref(false);
  /**
   * 正在进行的搬运的进度（大目录复制几 GB 时没有反馈 = 用户以为卡死）。
   * 为 null 表示当前没有搬运。
   */
  const transferProgress = ref<ActiveTransfer | null>(null);
  /**
   * 最近一次**移动**的撤销栈（复制不可撤销 —— 复制出来的副本删掉就够了，
   * 而移动一旦撤销就是"东西回不去了"，所以只记 move）。
   * 栈深 1：VS Code 的文件移动撤销也是单步，避免"撤销到用户记不清的状态"。
   */
  const lastMoveUndo = ref<{ from: string; to: string } | null>(null);
  const canUndoMove = computed(() => lastMoveUndo.value !== null);
  const pendingConflict = ref<ConflictRequest | null>(null);
  let pendingTransfer: PendingTransfer | null = null;

  /** 拖拽中的源集（多选时是整批）。 */
  const dragSources = ref<readonly string[]>([]);
  /** 移动 / 复制随修饰键实时切换。 */
  const dragMode = ref<TransferMode>("move");
  /** 当前落点目录；null 表示无落点。 */
  const dropTargetDir = ref<string | null>(null);
  const dropAllowed = ref(false);
  /**
   * 同级插入线落在哪一行、哪一侧。null 表示当前是"放进目录"（高亮整行），
   * 而不是"插到某一行前面/后面"。
   */
  const dropLine = ref<{ path: string; side: "before" | "after" } | null>(null);

  // ── 落点探测 ──────────────────────────────────────────────────────
  /**
   * 目标是否已存在。
   *
   * 只看已加载的目录 —— 未加载时返回 false（"判不了"），由后端的 rename
   * 策略兜底（同样不丢数据）。这样不必为了一次拖拽把整条路径上的目录都
   * 拉起来。代价是：目标目录未加载时**永远不会**提供"覆盖/跳过"选项。
   * 为了不让用户误以为那个选项坏了，这里在整批条目都判不了时提示一次。
   */
  function transferTargetExists(path: string): boolean {
    const names = options.entryNamesOf(options.parentOf(path));
    return names ? names.has(basename(path)) : false;
  }

  /** 本批是否有条目的目标目录没加载过。 */
  function hasUnloadedTarget(items: readonly string[]): boolean {
    return items.some(
      (item) => options.entryNamesOf(options.parentOf(item)) === null,
    );
  }

  /** 同一次会话只提示一次，别每次拖拽都弹。 */
  let warnedUnloadedTarget = false;

  function transferSourceIsDir(path: string): boolean {
    return options.isEntryDir(options.parentOf(path), basename(path));
  }

  function buildTransferPlan(pending: PendingTransfer, policy: PlanPolicy) {
    return planTransfer({
      sources: pending.sources,
      targetDir: pending.targetDir,
      mode: pending.mode,
      policy,
      exists: transferTargetExists,
      isDir: transferSourceIsDir,
    });
  }

  function reportRejections(
    rejected: Array<{ from: string; reason: RejectReason }>,
  ): void {
    if (rejected.length === 0) return;
    // 单一原因时给出具体说法（“不能把文件夹移动到自己的子目录里”）比
    // “3 个项目无法移动”有用得多；原因混杂时退回到通用标题。
    const reasons = Array.from(new Set(rejected.map((entry) => entry.reason)));
    const title =
      reasons.length === 1
        ? t(REJECTION_MESSAGE[reasons[0]!])
        : t("explorer.transferRejected");
    notifyInfo(title, describeRejections(rejected));
  }

  /**
   * 搬运入口。拖拽、粘贴、OS 拖入都调它。
   *
   * 有同名冲突时先弹对话框拿到策略再执行 —— 覆盖不可逆，而多选拖拽很容易
   * 撞名，默认策略必须是安全的“全部改名”。
   */
  async function runTransfer(
    sources: readonly string[],
    targetDir: string,
    mode: TransferMode,
  ): Promise<void> {
    if (transferBusy.value || sources.length === 0 || !targetDir) return;
    const pending: PendingTransfer = { sources: [...sources], targetDir, mode };
    if (!warnedUnloadedTarget && hasUnloadedTarget(sources)) {
      warnedUnloadedTarget = true;
      notifyInfo(
        t("explorer.transferTargetUnloaded"),
        t("explorer.transferTargetUnloadedDetail"),
      );
    }
    const probe = buildTransferPlan(pending, "detect");
    reportRejections(probe.rejected);
    if (probe.items.length === 0) return;
    if (probe.conflicts.length > 0) {
      pendingTransfer = pending;
      pendingConflict.value = {
        targetDir,
        conflicts: probe.conflicts,
        dirCount: probe.conflicts.filter((conflict) => conflict.isDir).length,
      };
      return;
    }
    await executeTransfer(pending, "rename");
  }

  function onConflictResolved(policy: FsConflictPolicy): void {
    const pending = pendingTransfer;
    pendingTransfer = null;
    pendingConflict.value = null;
    if (pending) void executeTransfer(pending, policy);
  }

  function onConflictCanceled(): void {
    pendingTransfer = null;
    pendingConflict.value = null;
  }

  /** operationId 自增：同一窗口内多次搬运互不串扰。 */
  let nextOperationId = 1;

  async function executeTransfer(
    pending: PendingTransfer,
    policy: FsConflictPolicy,
  ): Promise<void> {
    const plan = buildTransferPlan(pending, policy);
    if (plan.items.length === 0) return;
    const operationId = nextOperationId++;
    transferBusy.value = true;
    transferProgress.value = {
      operationId,
      mode: pending.mode,
      total: plan.items.length,
      progress: {
        done: 0,
        total: plan.items.length,
        current: plan.items[0]?.from ?? null,
        bytesDone: 0,
        bytesTotal: 0,
      },
    };
    try {
      const result =
        pending.mode === "move"
          ? await options.wsNative.fsMoveMany(plan.items, policy, operationId)
          : await options.wsNative.fsCopyMany(plan.items, policy, operationId);
      reportTransferResult(result, pending.mode);
      await settleAfterTransfer(result, pending);
    } catch (error) {
      notifyError(
        t("explorer.transferFailed", { failed: pending.sources.length }),
        error,
      );
    } finally {
      transferBusy.value = false;
      transferProgress.value = null;
    }
  }

  /**
   * 撤销上一次移动：把落点搬回原处。
   *
   * 走的是同一套搬运链路，因此目标位置被占时自动改名而不是失败或覆盖，
   * 同样有进度与取消，同样把已打开的 tab 跟着搬回去。
   */
  async function undoLastMove(): Promise<void> {
    const last = lastMoveUndo.value;
    if (!last) return;
    lastMoveUndo.value = null;
    await runTransfer([last.to], dirnameOfPath(last.from), "move");
    notifySuccess(t("explorer.moveUndone", { name: basename(last.from) }));
  }

  /**
   * 用户点“取消”：协作式中止，后端在下一个检查点停下。
   *
   * 用 async + try/catch 而不是 `void x().catch()`：后者在返回值不是 Promise
   * 时会直接抛 "Cannot read properties of undefined (reading 'catch')"，
   * 而且这个异常发生在 Vue 的事件处理器里 —— 用户看到的是"点了没反应"，
   * 日志里只有一条无关的堆栈。
   */
  async function cancelTransfer(): Promise<void> {
    const active = transferProgress.value;
    if (!active) return;
    try {
      await options.wsNative.fsCancelTransfer(active.operationId);
    } catch {
      // 取消失败（operation 已结束 / 后端已断开）无需打扰用户：搬运本身
      // 仍会自己结束。
    }
  }

  /** 逐条汇报，而不是只报成功：多选搬运经常是“一部分成功一部分失败”。 */
  function reportTransferResult(
    result: FsTransferResult,
    mode: TransferMode,
  ): void {
    const summary = summarizeTransfer(result);
    if (summary.moved === 0) {
      if (summary.failed > 0) {
        notifyError(
          t("explorer.transferFailed", { failed: summary.failed }),
          result.failed[0]?.error ?? null,
        );
      } else if (summary.skipped > 0) {
        notifyInfo(
          t("explorer.transferSkipped", { skipped: summary.skipped }),
          t("explorer.conflictSkipAll"),
        );
      }
      return;
    }
    const verbKey =
      mode === "move" ? "explorer.transferDoneMove" : "explorer.transferDoneCopy";
    notifySuccess(t(verbKey, { count: summary.moved }));
    if (summary.skipped > 0) {
      notifyInfo(t("explorer.transferSkipped", { skipped: summary.skipped }));
    }
    if (summary.failed > 0) {
      notifyError(
        t("explorer.transferFailed", { failed: summary.failed }),
        result.failed[0]?.error ?? null,
      );
    }
    if (summary.crossDevice > 0) {
      // 跨设备移动实际是 copy + delete：中途失败会在磁盘上留下两份，
      // 必须区别提示，不能混进普通成功里。
      notifyInfo(t("explorer.transferCrossDevice", { count: summary.crossDevice }));
    }
    for (const warning of summary.warnings) {
      notifyInfo(t("explorer.transferFailed", { failed: 0 }), warning);
    }
  }

  /** 搬运后收尾：跟随新路径、重读受影响目录、展开目标目录。 */
  async function settleAfterTransfer(
    result: FsTransferResult,
    pending: PendingTransfer,
  ): Promise<void> {
    const moved = [...result.completed, ...result.crossDevice];
    if (pending.mode === "move") {
      const undone: Array<{ from: string; to: string }> = [];
      for (const item of moved) {
        if (item.from === item.to) continue;
        options.onPathRenamed(item.from, item.to);
        // 跨设备回落（copy + delete）也在列：它的"移动"同样是删除 + 重建，
        // 撤销回去要同时考虑两边都能不存在。
        undone.push({ from: item.from, to: item.to });
      }
      if (undone.length === 1) {
        lastMoveUndo.value = undone[0]!;
      } else {
        // 批量移动的撤销要么全做要么不做，逐条撤销会让用户算不清状态。
        lastMoveUndo.value = null;
      }
    } else {
      // 一次复制会作废上一次移动的撤销：用户看到"可撤销"却撤销到与当前
      // 状态无关的位置，比不给撤销更困惑。
      lastMoveUndo.value = null;
    }
    if (!options.expanded.has(pending.targetDir)) {
      options.expanded.add(pending.targetDir);
      options.rebuildSnapshot();
    }
    const dirs = new Set<string>();
    for (const item of [...moved, ...result.skipped]) {
      dirs.add(options.parentOf(item.from));
      dirs.add(options.parentOf(item.to));
    }
    for (const dir of dirs) {
      if (isInsideDir(dir, rootAccessor())) {
        void options.loadChildren(dir, { silent: true });
      }
    }
  }

  // ── 树内指针拖拽 ──────────────────────────────────────────────────
  const rootAccessor = (): string => options.rootPath.value ?? "";

  /**
   * 行内"上/下缘带"占行高的比例：落在带内 = 同级插入，落在中间 = 放进目录。
   *
   * 25% 不是随手取的：行高只有 24px，带太窄几乎命中不到；太宽则"想放进
   * 目录"的操作会被误判成插入。
   */
  const ROW_EDGE_RATIO = 0.25;

  /**
   * 命中测试，三种落点：
   * - 行的上/下缘带 → **同级插入**（落到该行的父目录里，插在它前/后）
   * - 目录行的中间 → **放进该目录**（既有行为）
   * - 文件行的中间 → 不是合法落点（不能把东西放进文件里）
   * - 树的空白区 → 放进工作区根
   *
   * 同级插入的 `id` 是**父目录**而不是该行本身：搬运引擎只认
   * "源 + 目标目录"，位置信息由前端在计划里保留。
   */
  function treeDropTarget(clientX: number, clientY: number) {
    const hit = document.elementFromPoint(clientX, clientY);
    if (!hit) return null;
    const row = hit.closest<HTMLElement>("[data-explorer-row-path]");
    if (row) {
      const path = row.dataset.explorerRowPath;
      if (!path) return null;
      const isDir = row.dataset.isDir === "true";
      const rect = row.getBoundingClientRect();
      const ratio = rect.height > 0 ? (clientY - rect.top) / rect.height : 0.5;
      const atTop = ratio <= ROW_EDGE_RATIO;
      const atBottom = ratio >= 1 - ROW_EDGE_RATIO;
      if (atTop || atBottom) {
        return {
          id: options.parentOf(path),
          el: row,
          placement: atTop ? ("before" as const) : ("after" as const),
        };
      }
      if (isDir) return { id: path, el: row, placement: "after" as const };
      return null;
    }
    const container = hit.closest<HTMLElement>("[data-explorer-drop-root]");
    if (container) {
      const root = rootAccessor();
      return root ? { id: root, el: container } : null;
    }
    return null;
  }

  const treeDrag = usePointerDragReorder<DragGhost, string>({
    enabled: () => !options.isDragBlocked(),
    // 方位由命中测试按纵向位置算出（行的上/下缘带 = 同级插入），
    // 因此不需要默认的水平中线二分。
    resolveTarget: (x, y) => treeDropTarget(x, y),
    placementOf: () => "after",
    resolveGhost: (path) => ({
      path,
      count: dragSources.value.length,
      names: dragSources.value.map((source) => basename(source)).slice(0, 3),
    }),
    onDraggingChange: (dragging) => {
      if (dragging) return;
      // 结束或取消：清掉所有拖拽态，避免 ghost / 落点高亮残留。
      dropTargetDir.value = null;
      dropAllowed.value = false;
      dropLine.value = null;
      cancelHoverExpand();
    },
    onDrop: (sourceId, targetId) => {
      const sources = dragSources.value.length > 0 ? dragSources.value : [sourceId];
      void runTransfer(sources, targetId, dragMode.value);
    },
  });

  const dragGhost = treeDrag.ghost;

  function beginRowDrag(rowPath: string, event: PointerEvent) {
    // 拖拽源 = 多选集：拖其中一行就拖走整批（VS Code 行为）。非多选时只拖它。
    const selected = options.entryPaths.value.filter((path) =>
      options.selectedPaths.value.has(path),
    );
    dragSources.value =
      selected.includes(rowPath) && selected.length > 1 ? selected : [rowPath];
    if (event.altKey || event.ctrlKey) dragMode.value = "copy";
    treeDrag.startDrag(event, rowPath);
  }

  /** 拖拽结束后紧跟的 click 要被吃掉，否则松手会先落 drop 再触发选中。 */
  function consumeDragClick(path: string): boolean {
    return treeDrag.consumeSuppressedClick(path);
  }

  // ── 修饰键：拖拽中实时切换移动与复制 ──────────────────────────────
  // 靠 keydown/keyup 而不是每帧读 event.altKey：按下修饰键会产生独立的
  // 键盘事件，比在 pointermove 里反复取 modifier 状态可靠。
  function syncDragMode(event: KeyboardEvent) {
    if (treeDrag.draggingId.value === null) return;
    dragMode.value = event.altKey || event.ctrlKey ? "copy" : "move";
  }

  useEventListener(window, "keydown", syncDragMode);
  useEventListener(window, "keyup", syncDragMode);

  watch(
    () => treeDrag.dropTarget.value ?? null,
    (target) => {
      dropTargetDir.value = target?.id ?? null;
      dropAllowed.value = target?.id
        ? canTransferInto(dragSources.value, target.id, dragMode.value)
        : false;
      // 命中的是行且方位是 before/after → 画插入线；命中目录 → 高亮整行。
      dropLine.value = target?.el?.dataset?.explorerRowPath
        ? target.placement === "before"
          ? { path: target.el.dataset.explorerRowPath, side: "before" }
          : { path: target.el.dataset.explorerRowPath, side: "after" }
        : null;
      scheduleHoverExpand(target?.id ?? null);
    },
  );

  watch(dragMode, () => {
    const target = dropTargetDir.value;
    dropAllowed.value = target
      ? canTransferInto(dragSources.value, target, dragMode.value)
      : false;
  });

  // ── 悬停自动展开 ──────────────────────────────────────────────────
  let hoverExpandTimer: ReturnType<typeof setTimeout> | null = null;
  let hoverExpandTarget: string | null = null;

  function cancelHoverExpand() {
    if (hoverExpandTimer) clearTimeout(hoverExpandTimer);
    hoverExpandTimer = null;
    hoverExpandTarget = null;
  }

  function scheduleHoverExpand(target: string | null) {  // eslint-disable-line
    cancelHoverExpand();
    if (!target || !rootAccessor()) return;
    if (target === rootAccessor()) return;
    if (options.expanded.has(target)) return;
    // 源自身与其子目录不展开：展开后用户只会看到自己正在拖走的东西。
    if (dragSources.value.some((source) => isInsideDir(target, source))) return;
    hoverExpandTarget = target;
    hoverExpandTimer = setTimeout(() => {
      hoverExpandTimer = null;
      const dir = hoverExpandTarget;
      hoverExpandTarget = null;
      if (!dir) return;
      options.expanded.add(dir);
      options.rebuildSnapshot();
      void options.loadChildren(dir);
    }, HOVER_EXPAND_DELAY_MS);
  }

  // ── 边缘自动滚动 ──────────────────────────────────────────────────
  let edgeScrollFrame: number | null = null;

  function stopEdgeScroll() {
    if (edgeScrollFrame !== null) {
      cancelAnimationFrame(edgeScrollFrame);
      edgeScrollFrame = null;
    }
  }

  function edgeScrollStep() {
    const ghost = dragGhost.value;
    const scroller = options.treeScroll.value;
    if (!ghost || !scroller) {
      stopEdgeScroll();
      return;
    }
    const rect = scroller.getBoundingClientRect();
    let delta = 0;
    if (ghost.y < rect.top + EDGE_SCROLL_ZONE) {
      delta =
        -EDGE_SCROLL_SPEED * (1 - (ghost.y - rect.top) / EDGE_SCROLL_ZONE);
    } else if (ghost.y > rect.bottom - EDGE_SCROLL_ZONE) {
      delta =
        EDGE_SCROLL_SPEED * (1 - (rect.bottom - ghost.y) / EDGE_SCROLL_ZONE);
    }
    if (delta !== 0) {
      scroller.scrollTop += Math.max(
        -EDGE_SCROLL_SPEED,
        Math.min(EDGE_SCROLL_SPEED, delta),
      );
    }
    // 持续跑：指针不动时也要继续滚（虚拟滚动还要靠 scroll 事件更新 range）。
    edgeScrollFrame = requestAnimationFrame(edgeScrollStep);
  }

  // ghost 出现就启动 rAF 滚动循环，消失就停：指针不动时也要继续滚
  // （虚拟滚动还要靠 scroll 事件更新可视区）。
  watch(dragGhost, (ghost) => {
    if (ghost && edgeScrollFrame === null) {
      edgeScrollFrame = requestAnimationFrame(edgeScrollStep);
    } else if (!ghost) {
      stopEdgeScroll();
    }
  });

  // ── OS 文件拖入 ───────────────────────────────────────────────────
  // 走 Tauri 的 webview drag-drop 事件通道（Tauri v2 默认 dragDropEnabled
  // 为 true，系统拖拽由 Tauri 拦截后广播），与树内指针拖拽共存。
  // 一律当**复制**：从系统拖进来永远不会删掉源文件。
  let unlistenOsDrag: (() => void) | null = null;

  function handleOsDragEvent(event: OsFileDragEvent): void {
    if (options.isDragBlocked() || !rootAccessor()) {
      if (event.kind !== "leave") clearOsDropTarget();
      return;
    }
    if (event.kind === "leave") {
      clearOsDropTarget();
      return;
    }
    const hit = document.elementFromPoint(event.position.x, event.position.y);
    if (!hit) {
      clearOsDropTarget();
      return;
    }
    const row = hit.closest<HTMLElement>("[data-explorer-row-path]");
    let target: string | null = null;
    if (row) {
      target =
        row.dataset.isDir === "true" ? row.dataset.explorerRowPath ?? null : null;
    } else if (hit.closest("[data-explorer-drop-root]")) {
      target = rootAccessor();
    }
    if (!target) {
      clearOsDropTarget();
      return;
    }
    if (event.kind === "drop") {
      clearOsDropTarget();
      // 可行性在 drop 时才算得出（Tauri 只在 drop 事件里给 paths），over
      // 阶段只做高亮；非法落点由 runTransfer 的守卫拒绝并提示。
      void runTransfer(event.paths, target, "copy");
      return;
    }
    dropTargetDir.value = target;
    dropAllowed.value = true;
  }

  function clearOsDropTarget(): void {
    dropTargetDir.value = null;
    dropAllowed.value = false;
  }

  // 搬运进度订阅。事件按 operationId 分流，别的搬运（含另一个工作区的）进度
  // 一律忽略。
  if (hasTauriInternals()) {
    void onFsTransferProgress((event) => {
      const active = transferProgress.value;
      if (!active || active.operationId !== event.operationId) return;
      active.progress = {
        done: event.done,
        total: event.total,
        current: event.current,
        bytesDone: event.bytesDone,
        bytesTotal: event.bytesTotal,
      };
    }).catch((error) => {
      console.warn("[explorer] transfer progress unavailable:", error);
    });
  }

  // 部分 Linux Wayland 组合不支持 drag-drop：订阅失败就降级为“不支持拖入”，
  // 而不是让整棵文件树挂掉。
  if (hasTauriInternals()) {
    void onOsFileDragDrop(handleOsDragEvent)
      .then((unlisten) => {
        unlistenOsDrag = unlisten;
      })
      .catch((error) => {
        console.warn("[explorer] OS file drag & drop unavailable:", error);
      });
  }

  // ── 剪贴板动作 ───────────────────────────────────────────────────
  /** 粘贴落点：选中恰好一个目录就用它，否则粘到工作区根。 */
  function pasteTargetDir(selectedPaths: readonly string[]): string | null {
    const root = rootAccessor();
    if (!root) return null;
    if (selectedPaths.length !== 1) return root;
    const path = selectedPaths[0]!;
    return transferSourceIsDir(path) ? path : root;
  }

  function copySelection(paths: readonly string[]): void {
    if (paths.length > 0) clipboard.setCopy(paths);
  }

  function cutSelection(paths: readonly string[]): void {
    if (paths.length > 0) clipboard.setCut(paths);
  }

  async function paste(paths: readonly string[]): Promise<void> {
    const state = clipboard.state.value;
    const target = pasteTargetDir(paths);
    if (!target || state.paths.length === 0) return;
    const mode: TransferMode = state.mode === "cut" ? "move" : "copy";
    await runTransfer(state.paths, target, mode);
    // 剪切是一次性的：粘贴完成后剪贴板失效，避免重复剪切引发意外搬运。
    if (state.mode === "cut") clipboard.clear();
  }

  // ── 行级视觉判定（virtual 与非 virtual 两处循环共用）─────────────
  function isRowDragSource(path: string): boolean {
    return dragSources.value.includes(path);
  }

  /**
   * 该行是否处于"已剪切、等待粘贴"状态。
   *
   * 没有这个提示的话，用户剪切完就看不出哪些条目在被"悬着"——他得自己记住，
   * 或者去别处粘贴一次才发现。VS Code 把待剪切行变淡，这里同理。
   */
  function isRowCut(path: string): boolean {
    return clipboard.isCut.value && clipboard.state.value.paths.includes(path);
  }

  function isRowDropTarget(path: string): boolean {
    return dropTargetDir.value === path;
  }

  /** 该行是否要画同级插入线（`side` 为 null 表示不画）。 */
  function isRowDropLine(path: string): "before" | "after" | null {
    return dropLine.value?.path === path ? dropLine.value.side : null;
  }

  function isRowDropForbidden(path: string): boolean {
    return dropTargetDir.value === path && !dropAllowed.value;
  }

  /** 进度百分比：优先用字节（更细），退化到条目数。总量未知时为 null。 */
  const transferPercent = computed<number | null>(() => {
    const active = transferProgress.value;
    if (!active) return null;
    const { progress } = active;
    if (progress.bytesTotal > 0) {
      return Math.min(100, Math.round((progress.bytesDone * 100) / progress.bytesTotal));
    }
    if (progress.total > 0) {
      return Math.min(100, Math.round((progress.done * 100) / progress.total));
    }
    return null;
  });

  /** 进度文案：条目级 vs 字节级，取决于后端能否算出总量。 */
  const transferProgressLabel = computed<string | null>(() => {
    const active = transferProgress.value;
    if (!active) return null;
    const verb = active.mode === "move" ? t("explorer.dragMove") : t("explorer.dragCopy");
    if (active.progress.bytesTotal > 0) {
      return t("explorer.transferProgressBytes", {
        verb,
        done: formatBytes(active.progress.bytesDone),
        total: formatBytes(active.progress.bytesTotal),
      });
    }
    return t("explorer.transferProgressItems", {
      verb,
      done: active.progress.done,
      total: active.progress.total,
    });
  });

  /** ghost 文案：跟随修饰键在「移动 / 复制」之间实时切换。 */
  const dragGhostLabel = computed(() => {
    const ghost = dragGhost.value;
    if (!ghost) return "";
    const verb =
      dragMode.value === "move" ? t("explorer.dragMove") : t("explorer.dragCopy");
    const names = ghost.item.names.join("、");
    const more =
      ghost.item.count > ghost.item.names.length
        ? t("explorer.dragMore", {
            count: ghost.item.count - ghost.item.names.length,
          })
        : "";
    return ghost.item.count > 1
      ? `${verb} ${ghost.item.count} 项：${names}${more}`
      : `${verb} ${names}`;
  });

  onBeforeUnmount(() => {
    stopEdgeScroll();
    cancelHoverExpand();
    unlistenOsDrag?.();
    unlistenOsDrag = null;
  });

  return {
    // 状态
    clipboard,
    transferBusy,
    transferProgress,
    canUndoMove,
    undoLastMove,
    transferPercent,
    transferProgressLabel,
    cancelTransfer,
    pendingConflict,
    dragMode,
    dropAllowed,
    dragGhost,
    dragGhostLabel,
    // 拖拽
    beginRowDrag,
    consumeDragClick,
    // 搬运
    runTransfer,
    onConflictResolved,
    onConflictCanceled,
    // 剪贴板
    copySelection,
    cutSelection,
    paste,
    // 行级视觉
    isRowDragSource,
    isRowCut,
    isRowDropLine,
    isRowDropTarget,
    isRowDropForbidden,
  };
}
