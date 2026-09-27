import { ref, shallowRef, watch, type Ref } from "vue";

/**
 * 文件树的**选择层**：多选集、键盘光标、Shift 锚点、键盘导航，以及
 * "行集合变化后剔除不可见选中项"的剪枝。
 *
 * 单独成层的理由：多选语义（Ctrl 切换 / Shift 范围 / 锚点）在
 * FileExplorer 内部与"行是怎么算出来的"强相关，但与"目录怎么加载"无关。
 * 拆开后拖拽（useTreeTransfer）只需要读 `orderedSelectedPaths()`，
 * 不必知道选择是怎么来的。
 *
 * 剪枝 watch 放在这里而不是数据层：选择集的写权限归本层所有，数据层
 * 反向持有会形成环。
 */
export type TreeSelectionOptions = {
  /** 当前可见的 entry 路径（树的可见顺序）。 */
  entryPaths: Ref<string[]>;
  /** path → 行下标，用于键盘导航取行。 */
  entryIndexByPath: Ref<Map<string, number>>;
  /** 某个路径是否是一个（可见的）目录。 */
  isDirPath: (path: string) => boolean;
  /** 目录的父路径。 */
  parentOf: (path: string) => string;
  /** 某个路径当前是否已展开。 */
  isExpanded: (path: string) => boolean;
  /** 根目录（ArrowLeft 到顶后停在这里）。 */
  rootPath: Ref<string | null>;
  /** 展开 / 折叠一个目录。 */
  toggleDir: (path: string) => void;
  /** 打开一个文件（双击 / Enter）。 */
  openFile: (path: string) => void;
};

export function useTreeSelection(options: TreeSelectionOptions) {
  // selectedPaths：当前高亮的全部行；每次变更整体替换 Set，shallowRef 即可
  // 触发更新。
  // focusedPath：键盘导航的光标行（最近一次操作的行）。
  // anchorPath：Shift 范围选择的起点，普通点击 / Ctrl 点击会把它移到该行。
  const selectedPaths = shallowRef<ReadonlySet<string>>(new Set());
  const focusedPath = ref<string | null>(null);
  const anchorPath = ref<string | null>(null);

  function selectOnly(path: string | null) {
    selectedPaths.value = path ? new Set([path]) : new Set();
    focusedPath.value = path;
    anchorPath.value = path;
  }

  function toggleSelection(path: string) {
    const next = new Set(selectedPaths.value);
    if (next.has(path)) next.delete(path);
    else next.add(path);
    selectedPaths.value = next;
    focusedPath.value = path;
    anchorPath.value = path;
  }

  /** 锚点到目标行（含）之间的可见行全部选中；锚点不动，光标移到目标行。 */
  function selectRange(toPath: string) {
    const paths = options.entryPaths.value;
    const anchor = anchorPath.value ?? toPath;
    const from = paths.indexOf(anchor);
    const to = paths.indexOf(toPath);
    if (from < 0 || to < 0) {
      selectOnly(toPath);
      return;
    }
    const [start, end] = from <= to ? [from, to] : [to, from];
    selectedPaths.value = new Set(paths.slice(start, end + 1));
    focusedPath.value = toPath;
    anchorPath.value = anchor;
  }

  function selectAll() {
    const paths = options.entryPaths.value;
    if (paths.length === 0) return;
    selectedPaths.value = new Set(paths);
    if (!focusedPath.value) focusedPath.value = paths[0]!;
    if (!anchorPath.value) anchorPath.value = paths[0]!;
  }

  /** 选中路径按树的可见顺序返回，供上下文菜单与拖拽批量操作使用。 */
  function orderedSelectedPaths(): string[] {
    const selected = selectedPaths.value;
    if (selected.size === 0) return [];
    return options.entryPaths.value.filter((path) => selected.has(path));
  }

  function reset() {
    selectOnly(null);
  }

  /**
   * 树的键盘导航。焦点判定与“正在输入”（内联重命名 / 新建 / 搜索框）由
   * 调用方用 `isBusy` 提前拦掉，不在这里重复判断。
   */
  function handleKeydown(event: KeyboardEvent): void {
    const paths = options.entryPaths.value;
    if (paths.length === 0) return;

    if ((event.ctrlKey || event.metaKey) && event.key.toLowerCase() === "a") {
      event.preventDefault();
      selectAll();
      return;
    }

    const currentIdx = focusedPath.value ? paths.indexOf(focusedPath.value) : -1;

    if (event.key === "ArrowDown") {
      event.preventDefault();
      moveSelection(currentIdx < 0 ? 0 : currentIdx + 1, event.shiftKey);
    } else if (event.key === "ArrowUp") {
      event.preventDefault();
      moveSelection(currentIdx < 0 ? paths.length - 1 : currentIdx - 1, event.shiftKey);
    } else if (event.key === "ArrowRight") {
      if (currentIdx < 0) return;
      event.preventDefault();
      const path = paths[currentIdx]!;
      if (!options.isDirPath(path)) return;
      // 折叠 → 展开；已展开 → 进入第一项。与文件管理器一致。
      if (options.isExpanded(path)) moveSelection(currentIdx + 1);
      else options.toggleDir(path);
    } else if (event.key === "ArrowLeft") {
      if (currentIdx < 0) return;
      event.preventDefault();
      const path = paths[currentIdx]!;
      if (options.isDirPath(path) && options.isExpanded(path)) {
        options.toggleDir(path);
        return;
      }
      // 走到父目录行，让键盘导航能一路往上退出嵌套。
      const parent = options.parentOf(path);
      const root = options.rootPath.value;
      if (parent && parent !== root && options.entryIndexByPath.value.has(parent)) {
        selectOnly(parent);
      }
    } else if (event.key === "Enter") {
      if (currentIdx < 0) return;
      event.preventDefault();
      const path = paths[currentIdx]!;
      if (options.isDirPath(path)) options.toggleDir(path);
      else options.openFile(path);
    }
  }

  function moveSelection(index: number, extend = false) {
    const paths = options.entryPaths.value;
    if (paths.length === 0) return;
    const clamped = Math.max(0, Math.min(paths.length - 1, index));
    if (extend) selectRange(paths[clamped]!);
    else selectOnly(paths[clamped]!);
  }

  // 行集合变化（折叠、刷新、重命名、过滤）后剔除已不可见的选中项，
  // 避免选择集里残留"幽灵路径"参与批量删除。
  watch(options.entryPaths, () => {
    const index = options.entryIndexByPath.value;
    const selected = selectedPaths.value;
    if (selected.size > 0) {
      const next = new Set<string>();
      for (const path of selected) {
        if (index.has(path)) next.add(path);
      }
      if (next.size !== selected.size) selectedPaths.value = next;
    }
    if (focusedPath.value && !index.has(focusedPath.value)) focusedPath.value = null;
    if (anchorPath.value && !index.has(anchorPath.value)) anchorPath.value = null;
  });

  return {
    selectedPaths,
    focusedPath,
    anchorPath,
    selectOnly,
    toggleSelection,
    selectRange,
    selectAll,
    orderedSelectedPaths,
    moveSelection,
    reset,
    handleKeydown,
  };
}
