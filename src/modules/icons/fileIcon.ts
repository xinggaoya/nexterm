/**
 * 文件 / 目录图标解析。
 *
 * 解析顺序：精确文件名 → 扩展名 → 语言 ID → 通用回落图标。
 * 扩展名支持逐段回退（`foo.tar.gz` → 先试 `tar.gz`，再试 `gz`）。
 *
 * 入参可以是完整路径，解析前会先取 basename —— 因此
 * `fileIconUrl("apps/cli/package.json")` 与 `fileIconUrl("package.json")`
 * 结果一致。
 */

import { basename } from "@/lib/path";
import {
  buildIconDataUrl,
  DEFAULT_FILE_ICON,
  DEFAULT_FOLDER_ICON,
  DEFAULT_FOLDER_OPEN_ICON,
} from "./lib/iconSet";
import * as fileIconsMod from "./lib/fileIcons";
import * as folderIconsMod from "./lib/folderIcons";
import { EXT_TO_LANGUAGE_ID } from "./lib/languageIds";

const catFileNames = fileIconsMod.fileNames as Record<string, string>;
const catFileExtensions = fileIconsMod.fileExtensions as Record<string, string>;
const catLanguageIds = fileIconsMod.languageIds as Record<string, string>;
const catFolderNames = folderIconsMod.folderNames as Record<string, string>;

/** 取扩展名（不含点，全小写）；无扩展名或点开头即返回空串。 */
function extOf(name: string): string {
  const lower = name.toLowerCase();
  const dot = lower.indexOf(".");
  if (dot === -1 || dot === lower.length - 1) return "";
  return lower.slice(dot + 1);
}

/**
 * 文件图标 data-URL。`name` 可以是文件名，也可以是完整路径。
 */
export function fileIconUrl(name: string): string {
  const base = basename(name).toLowerCase();

  const byName = catFileNames[base];
  if (byName) {
    const url = buildIconDataUrl(byName);
    if (url) return url;
  }

  let ext = extOf(base);
  while (ext) {
    const iconName = catFileExtensions[ext];
    if (iconName) {
      const url = buildIconDataUrl(iconName);
      if (url) return url;
    }
    const langId = EXT_TO_LANGUAGE_ID[ext];
    if (langId) {
      const iconByLang = catLanguageIds[langId];
      if (iconByLang) {
        const url = buildIconDataUrl(iconByLang);
        if (url) return url;
      }
    }
    const nextDot = ext.indexOf(".");
    if (nextDot === -1) break;
    ext = ext.slice(nextDot + 1);
  }

  return buildIconDataUrl(DEFAULT_FILE_ICON) ?? "";
}

/**
 * 目录图标 data-URL。`expanded` 决定用展开态还是收起态图标。
 */
export function folderIconUrl(name: string, expanded: boolean): string {
  const base = basename(name).toLowerCase();

  const mapped = catFolderNames[base];
  if (mapped) {
    const target = expanded ? `${mapped}-open` : mapped;
    const url = buildIconDataUrl(target);
    if (url) return url;
  }

  return (
    buildIconDataUrl(expanded ? DEFAULT_FOLDER_OPEN_ICON : DEFAULT_FOLDER_ICON) ??
    ""
  );
}
