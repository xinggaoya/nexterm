/**
 * 路径重映射的纯函数集合。
 *
 * `followPath`（目录被搬走后，已打开的 tab 跟着走）和 `dropPath`（路径消失后
 * 关掉指向它的 tab）都只依赖「一个路径字符串 → 另一个路径字符串或 null」这
 * 一条规则。抽出来是为了能脱离 Pinia 单测 —— 这两条是文件树与标签联动里
 * 最容易写错（少一个 `/` 就会变成前缀误匹配）的地方。
 */

/** 尾部分隔符归一：前端路径一律用 `/`，且不带尾斜杠。 */
export function normalizePathPrefix(path: string): string {
  return path.replace(/\\/g, "/").replace(/\/+$/, "");
}

/**
 * 若 `path` 命中 `from`（本身相等，或位于 `from` 之内），返回重映射后的路径。
 *
 * 关键：比较用的是**带尾斜杠的前缀**。直接 `path.startsWith(from)` 会让
 * `/repo/src-legacy/a.ts` 被 `/repo/src` 命中 —— 搬走 `src` 时把
 * `src-legacy` 也改掉，那正是要避免的误伤。
 */
export function remapUnderPath(path: string, from: string, to: string): string | null {
  const fromNormalized = normalizePathPrefix(from);
  const toNormalized = normalizePathPrefix(to);
  const pathNormalized = normalizePathPrefix(path);

  if (pathNormalized === fromNormalized) return toNormalized;
  const prefix = `${fromNormalized}/`;
  if (pathNormalized.startsWith(prefix)) {
    return `${toNormalized}/${pathNormalized.slice(prefix.length)}`;
  }
  return null;
}

/**
 * 判断 `path` 是否落在 `root` 之内（`path === root` 也算）。
 *
 * 目录删除时用它决定哪些 tab 要一起关掉。
 */
export function isUnderPath(path: string, root: string): boolean {
  return remapUnderPath(path, root, root) !== null;
}
