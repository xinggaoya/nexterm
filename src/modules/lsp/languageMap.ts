export type SupportedLanguage =
  | "rust"
  | "python"
  | "go"
  | "typescript"
  | "javascript";

const EXT_TO_LANGUAGE: Record<string, SupportedLanguage> = {
  rs: "rust",
  py: "python",
  go: "go",
  ts: "typescript",
  tsx: "typescript",
  mts: "typescript",
  cts: "typescript",
  js: "javascript",
  jsx: "javascript",
  mjs: "javascript",
  cjs: "javascript",
};

const FILENAME_OVERRIDES: Record<string, SupportedLanguage> = {
  rust: "rust",
  python: "python",
  golang: "go",
  typescript: "typescript",
  javascript: "javascript",
};

function baseName(filename: string): string {
  const lower = filename.toLowerCase();
  return lower.split(/[\\/]/).pop() ?? lower;
}

function extOf(filename: string): string | null {
  const base = baseName(filename);
  const dot = base.lastIndexOf(".");
  if (dot === -1 || dot === base.length - 1) return null;
  return base.slice(dot + 1);
}

export function detectLspLanguage(
  filename: string,
): SupportedLanguage | null {
  const base = baseName(filename);
  if (FILENAME_OVERRIDES[base]) return FILENAME_OVERRIDES[base];
  const ext = extOf(base);
  if (ext && EXT_TO_LANGUAGE[ext]) return EXT_TO_LANGUAGE[ext];
  return null;
}
