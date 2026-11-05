/**
 * `icons` 模块公开出口。
 *
 * 全应用的文件 / 目录类型图标与品牌 Logo 都从这里取，保证各展示面
 * （文件树、搜索、命令面板、文件选择器、Git 历史、Git 变更、标签条、
 * 编辑器头部、状态栏）视觉一致。
 */

export { fileIconUrl, folderIconUrl } from "./fileIcon";
export {
  languageIconUrl,
  languageIconUrlForPath,
  logoIconUrl,
  programIconUrl,
  shellIconUrl,
} from "./logo";
