import { basename, dirname, joinPath } from "@/lib/path";
import type {
  FsConflictPolicy,
  FsTransferItem,
  FsTransferResult,
} from "@/lib/native";

/**
 * 搬运计划器：把「一堆源 + 一个目标目录 + 移动还是复制」翻译成后端
 * `fs_move_many` / `fs_copy_many` 能直接吃的条目数组。
 *
 * 纯函数，无 IPC、无 Vue —— 拖拽、剪贴板粘贴、OS 拖入三条入口共用它，
 * 因此"哪一步算非法落点""冲突时怎么办"只有一处定义。
 *
 * 为什么冲突检测在前端也做一遍（后端同样会判）：批量搬运的**策略**要由
 * 人来定（覆盖不可逆，多选拖拽更不能默认覆盖），而后端只能拿到已经定好的
 * `to` 路径。前端负责发现冲突并征询用户，后端负责在同批次内继续避让
 * （第一条改名成 `a copy` 后，第二条同名项要接着往后找序号）。
 */

/** `child` 是否位于 `parent` 之内（含相等）。与后端 `is_inside` 同语义。 */
export function isInsideDir(child: string, parent: string): boolean {
  return child === parent || child.startsWith(`${parent}/`);
}

/**
 * 自动改名序列：`foo.ext` → `foo copy.ext` → `foo copy 2.ext` → ...
 *
 * 与后端 `next_free_target` 保持同一套规则（点开头的名字整体当词干，
 * 多点扩展名只拆最后一个点），否则"前端预判不冲突、后端却改名"会让用户
 * 看到的落点与实际落点对不上。
 */
export function copyTargetName(source: string, copyIndex = 0): string {
  const name = basename(source);
  // Some(0) 与 None 都视为"无扩展名"：`.gitignore` 整体是词干。
  const dot = name.lastIndexOf(".");
  const stem = dot > 0 ? name.slice(0, dot) : name;
  const ext = dot > 0 ? name.slice(dot) : "";
  return copyIndex === 0 ? `${stem} copy${ext}` : `${stem} copy ${copyIndex + 1}${ext}`;
}

/** 搬运模式。`cut` 走移动，其余走复制。 */
export type TransferMode = "move" | "copy";

export type TransferPlan = {
  /** 交给后端的条目（`to` 是按策略解析后的目标）。 */
  items: FsTransferItem[];
  /**
   * 需要征询用户的目标：键是源路径，值是**已经存在的**目标路径。
   * 非空时调用方必须先弹冲突对话框再执行。
   */
  conflicts: Array<{ from: string; existingTo: string; isDir: boolean }>;
  /** 被守卫生拦下的条目（拖进自身子目录、同目录移动等），不会进入 items。 */
  rejected: Array<{ from: string; reason: RejectReason }>;
};

export type RejectReason =
  | "self"
  | "own-subtree"
  | "same-directory"
  | "missing-source";

/**
 * 计划策略。
 * - `detect`：**尚未征询用户**。冲突会被记录进 `conflicts`，`items` 里按
 *   自动改名预解（安全默认值的预览）。
 * - `overwrite` / `skip` / `rename`：用户已定。`items` 里直接用请求的目标
 *   （或自动改名后的落点），不再记录冲突。
 */
export type PlanPolicy = FsConflictPolicy | "detect";

/** 目标是否已存在。由调用方注入（读已加载的目录条目，不额外发 IPC）。 */
export type ExistsProbe = (path: string) => boolean;

function rejectReasonFor(
  source: string,
  targetDir: string,
  mode: TransferMode,
): RejectReason | null {
  if (source === targetDir) return "self";
  if (mode === "move") {
    if (dirname(source) === targetDir) return "same-directory";
    // 拖进自己的子目录：跨设备回落会变成 copy + delete，把源一路吞掉。
    if (isInsideDir(targetDir, source)) return "own-subtree";
  }
  return null;
}

/**
 * 落点是否可行 —— 拖拽过程中做实时反馈用（非法落点要提前变禁用态，
 * 不能等松手才报错）。
 *
 * 任何一条源非法就整体不可行：多选拖拽里"搬 3 个成功 1 个失败"体验更差。
 */
export function canTransferInto(
  sources: readonly string[],
  targetDir: string,
  mode: TransferMode,
): boolean {
  if (sources.length === 0 || !targetDir) return false;
  return sources.every((source) => rejectReasonFor(source, targetDir, mode) === null);
}

export type PlanTransferInput = {
  sources: readonly string[];
  targetDir: string;
  mode: TransferMode;
  policy: PlanPolicy;
  /** 目标是否已存在。由调用方注入（读已加载的目录条目，不额外发 IPC）。 */
  exists: ExistsProbe;
  /**
   * 判断源是否为目录（覆盖目录不可逆，对话框要额外提示"递归替换整个
   * 目录"）。未知时按文件处理。
   */
  isDir?: (path: string) => boolean;
};

/**
 * 生成搬运计划。**不做任何 IO**，只依据注入的 `exists` / `isDir` 判定。
 *
 * 冲突一律按 `rename` 预解，即使策略是 `overwrite` —— 真正的覆盖/跳过
 * 判定交给后端（它在同批次内逐条结算，避让更准）。这里只负责"哪些条目
 * 会撞名、该问用户哪个策略"，以及把落点预排出来。
 */
export function planTransfer(input: PlanTransferInput): TransferPlan {
  const { sources, targetDir, mode, exists, policy } = input;
  const items: FsTransferItem[] = [];
  const conflicts: TransferPlan["conflicts"] = [];
  const rejected: TransferPlan["rejected"] = [];
  // 计划阶段已经占用的目标名：避免两条源解析到同一个落点。
  const claimed = new Set<string>();

  for (const from of sources) {
    const reason = rejectReasonFor(from, targetDir, mode);
    if (reason) {
      rejected.push({ from, reason });
      continue;
    }
    const desired = joinPath(targetDir, basename(from));
    let to = desired;
    if (exists(desired) || claimed.has(desired)) {
      if (policy === "detect") {
        conflicts.push({
          from,
          existingTo: desired,
          isDir: input.isDir?.(from) ?? false,
        });
      }
      // 沿用后端计数序列预占一个落点：下一条同名源要接着往后排。
      for (let n = 0; n < 100; n += 1) {
        const candidate = joinPath(targetDir, copyTargetName(from, n));
        if (!exists(candidate) && !claimed.has(candidate)) {
          to = candidate;
          break;
        }
      }
    }
    claimed.add(to);
    items.push({ from, to });
  }

  return { items, conflicts, rejected };
}

/** 把"多条拒绝原因"折叠成一句用户可读的提示。 */
export function describeRejections(
  rejected: TransferPlan["rejected"],
): string | null {
  if (rejected.length === 0) return null;
  const only = (reason: RejectReason): boolean =>
    rejected.every((entry) => entry.reason === reason);
  if (only("own-subtree")) return "不能把文件夹移动到它自己的子目录里";
  if (only("same-directory")) return "项目已经在该目录中";
  if (only("self")) return "不能把文件夹移动到它自己";
  return `${rejected.length} 个项目无法移动到该位置`;
}

/** 执行结果的用户可读摘要。返回 null 表示全部成功且无告警。 */
export type TransferSummary = {
  /** 成功条数（含跨设备回落）。 */
  moved: number;
  /** 因冲突策略被跳过的条数。 */
  skipped: number;
  /** 失败条数。 */
  failed: number;
  /** 跨设备回落条数：语义是移动但中途可能留下双份，需要区别提示。 */
  crossDevice: number;
  /** 符号链接等非致命告警。 */
  warnings: string[];
  /** 是否有任何需要提示的事。 */
  notable: boolean;
};

export function summarizeTransfer(result: FsTransferResult): TransferSummary {
  const crossDevice = result.crossDevice.length;
  const warnings = result.warnings;
  return {
    moved: result.completed.length + crossDevice,
    skipped: result.skipped.length,
    failed: result.failed.length,
    crossDevice,
    warnings,
    notable:
      result.skipped.length > 0 ||
      result.failed.length > 0 ||
      crossDevice > 0 ||
      warnings.length > 0,
  };
}
