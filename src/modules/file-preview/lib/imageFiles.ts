/**
 * 图片扩展名判定。路径可能来自 Windows、Unix 或 OSC 7,统一按
 * `[\\/]` 切分取末段,再取最后一个 `.` 之后的扩展名。
 *
 * 二进制图片(png/jpg 等)双击直接开预览 tab;svg 是文本,双击仍进
 * 编辑器保持可编辑,预览通过右键"打开预览"进入。
 */
const BINARY_IMAGE_EXTENSIONS = new Set([
  "avif",
  "bmp",
  "gif",
  "ico",
  "jpeg",
  "jpg",
  "png",
  "webp",
]);

const TEXT_IMAGE_EXTENSIONS = new Set(["svg"]);

export function fileExtension(path: string): string {
  const name = path.split(/[\\/]/).pop() ?? "";
  const dot = name.lastIndexOf(".");
  return dot === -1 ? "" : name.slice(dot + 1).toLowerCase();
}

/** 双击路由用:二进制图片在文本编辑器里没有意义,直接进预览。 */
export function isBinaryImagePath(path: string): boolean {
  return BINARY_IMAGE_EXTENSIONS.has(fileExtension(path));
}

/** "打开预览"菜单项用:二进制图片 + svg。 */
export function isPreviewableImagePath(path: string): boolean {
  return (
    isBinaryImagePath(path) || TEXT_IMAGE_EXTENSIONS.has(fileExtension(path))
  );
}

const MIME_BY_EXTENSION: Record<string, string> = {
  avif: "image/avif",
  bmp: "image/bmp",
  gif: "image/gif",
  ico: "image/x-icon",
  jpeg: "image/jpeg",
  jpg: "image/jpeg",
  png: "image/png",
  svg: "image/svg+xml",
  webp: "image/webp",
};

export function imageMimeFromPath(path: string): string | null {
  return MIME_BY_EXTENSION[fileExtension(path)] ?? null;
}
