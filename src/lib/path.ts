/**
 * POSIX-style `basename`: returns the last path segment.
 *
 * Splits on either `/` or `\` so it works for both Unix and Windows paths
 * (the front-end normalises internally but the source path coming from
 * the explorer may still carry a Windows separator). Empty inputs return
 * the original value to make the helper safe for tail-call chains.
 */
export function basename(path: string): string {
  const parts = path.split(/[\\/]/).filter(Boolean);
  return parts.length ? parts[parts.length - 1] : path;
}

/**
 * POSIX-style `dirname`: 去掉最后一段路径。根与单段路径返回 "/"。
 */
export function dirname(path: string): string {
  const i = path.lastIndexOf("/");
  if (i <= 0) return "/";
  return path.slice(0, i);
}

/** 以 "/" 拼接父子路径（parent 已带尾 "/" 时不再重复）。 */
export function joinPath(parent: string, name: string): string {
  if (parent.endsWith("/")) return `${parent}${name}`;
  return `${parent}/${name}`;
}

/**
 * 把路径拆成“文件名 + 目录”两段，供两段式展示使用（图标 + 文件名 + 弱化目录）。
 *
 * 与 `dirname` 的区别：单段路径（`package.json`）的 `dir` 是空串而不是 `"/"`，
 * 直接渲染不会多出一个孤零零的斜杠。同时兼容 `/` 与 `\` 分隔符。
 */
export function splitPathLabel(path: string): { name: string; dir: string } {
  const normalized = path.replace(/\\/g, "/").replace(/\/+$/, "");
  const index = normalized.lastIndexOf("/");
  if (index < 0) return { name: normalized, dir: "" };
  return { name: normalized.slice(index + 1), dir: normalized.slice(0, index) };
}
