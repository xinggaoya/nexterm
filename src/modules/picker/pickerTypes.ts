import type { WorkspaceEnv } from "@/modules/workspace/workspaceEnvSnapshot";

/** directory: 选文件夹（如工作区根）；file: 选文件。 */
export type PickerMode = "directory" | "file";

/** 快捷位置（面包屑旁的一排 chip，如“主目录 / 文件系统 / 最近工作区”）。 */
export type PickerPlace = {
  key: string;
  label: string;
  path: string;
};

export type FilePickerOptions = {
  mode: PickerMode;
  /**
   * 目标环境。选择器通过 createNativeForEnv(workspace) 列目录，
   * 因此浏览的永远是该 env 自己的文件系统：
   * WSL 发行版内是 Linux 路径（/home/...），本机是 Windows 路径（C:/...）。
   * 这保证了“WSL 里选出来的就是 Linux 路径”，不会混入 UNC / 盘符歧义。
   */
  workspace: WorkspaceEnv;
  /** 标题；缺省时按 mode + env 自动生成。 */
  title?: string;
  /** 初始目录（env 内部路径）。 */
  initialPath?: string;
  /** file 模式下预填的文件名。 */
  fileName?: string;
  /** 额外快捷位置（如同一发行版的最近工作区）。 */
  places?: PickerPlace[];
};
