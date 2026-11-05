/**
 * Catppuccin 图标集的底层访问层。
 *
 * 只做三件事：把图标名归一成 Iconify slug、在图标集里查出 SVG body、
 * 把 body 包成可直接用于 `<img src>` 的 data-URL。查表策略在
 * `../fileIcon.ts`，映射表在 `./fileIcons.ts` / `./folderIcons.ts`。
 *
 * 全部图标离线内置（`@iconify-json/catppuccin`），不发起任何网络请求。
 */

import catppuccinIcons from "@iconify-json/catppuccin/icons.json";

type IconifySet = {
  icons: Record<string, { body: string }>;
  aliases?: Record<string, { parent: string }>;
  width?: number;
  height?: number;
};

const cat = catppuccinIcons as unknown as IconifySet;
const CAT_W = cat.width ?? 16;
const CAT_H = cat.height ?? 16;

/** 通用文件图标（未识别类型时的回落）。 */
export const DEFAULT_FILE_ICON = "file";
/** 通用目录图标（未识别目录时的回落）。 */
export const DEFAULT_FOLDER_ICON = "folder";
/** 通用目录图标（展开态）。 */
export const DEFAULT_FOLDER_OPEN_ICON = "folder-open";

const dataUrlCache = new Map<string, string>();

// Catppuccin's manifest emits names like `folder_src`/`typescript-react`, but
// the iconify export normalizes everything to hyphenated slugs.
function toIconifySlug(name: string): string {
  return name.replace(/_/g, "-");
}

/** 查出图标 SVG body；查不到返回 null（可能是别名指向的父图标也不存在）。 */
function iconBody(iconName: string): string | null {
  const slug = toIconifySlug(iconName);
  const direct = cat.icons[slug];
  if (direct) return direct.body;
  const alias = cat.aliases?.[slug];
  if (alias) {
    const parent = cat.icons[alias.parent];
    if (parent) return parent.body;
  }
  return null;
}

/**
 * 构造 SVG data-URL。命中缓存时直接返回，未命中的空结果也会被缓存，
 * 避免同一个未知图标反复走查表。
 */
export function buildIconDataUrl(iconName: string): string | null {
  const cached = dataUrlCache.get(iconName);
  if (cached !== undefined) return cached || null;
  const body = iconBody(iconName);
  if (!body) {
    dataUrlCache.set(iconName, "");
    return null;
  }
  const svg = `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 ${CAT_W} ${CAT_H}">${body}</svg>`;
  const url = `data:image/svg+xml;utf8,${encodeURIComponent(svg)}`;
  dataUrlCache.set(iconName, url);
  return url;
}
