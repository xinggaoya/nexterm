import { computed, ref, type Ref } from "vue";

/**
 * 文件剪贴板：文件树的"剪切 / 复制 / 粘贴"。
 *
 * 为什么不用系统剪贴板：文件树内部的剪切/复制与 Cmd+C/Cmd+V 复制文本是
 * 同一个物理按键。放进系统剪贴板会互相覆盖 —— 用户选中一个文件按 Cmd+C，
 * 期望粘到另一个目录，却在别处粘贴出了这一串路径。编辑器 / 终端的文本
 * 剪贴板已经由 `@/lib/clipboard` 负责，这里刻意只存在于内存。
 *
 * 生命周期：每次 `useFileClipboard()` 返回一个**独立实例**，由 FileExplorer
 * 持有。文件树在每个 WorkspaceHost 里各有一份，所以剪贴板天然按工作区隔离，
 * 且组件卸载即丢弃，不需要额外的清理逻辑（也不需要模块级单例）。
 */
export type FileClipboardMode = "copy" | "cut";

export type FileClipboardState = {
  /** null = 剪贴板为空。 */
  mode: FileClipboardMode | null;
  paths: string[];
};

export type FileClipboard = {
  /** 当前剪贴板内容；空时 mode 为 null。 */
  state: Ref<FileClipboardState>;
  /** 是否有可粘贴内容（右键菜单据此启用"粘贴"）。 */
  isEmpty: Ref<boolean>;
  /** 当前是否处于"剪切"态（用于菜单项高亮与提示）。 */
  isCut: Ref<boolean>;
  setCopy: (paths: readonly string[]) => void;
  setCut: (paths: readonly string[]) => void;
  clear: () => void;
};

export function useFileClipboard(): FileClipboard {
  const state = ref<FileClipboardState>({ mode: null, paths: [] });
  const isEmpty = computed(() => state.value.paths.length === 0);
  const isCut = computed(() => !isEmpty.value && state.value.mode === "cut");

  function assign(mode: FileClipboardMode, paths: readonly string[]): void {
    // 零项时清空而不是存一个空壳：否则"粘贴"会变成一个必定失败的操作。
    if (paths.length === 0) {
      state.value = { mode: null, paths: [] };
      return;
    }
    state.value = { mode, paths: [...paths] };
  }

  return {
    state,
    isEmpty,
    isCut,
    setCopy: (paths) => assign("copy", paths),
    setCut: (paths) => assign("cut", paths),
    clear: () => {
      state.value = { mode: null, paths: [] };
    },
  };
}
