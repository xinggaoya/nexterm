const EXT_MAP: Record<string, string> = {
  ts: "typescript",
  tsx: "typescript",
  mts: "typescript",
  cts: "typescript",
  js: "javascript",
  jsx: "javascript",
  mjs: "javascript",
  cjs: "javascript",
  json: "json",
  jsonc: "json",
  json5: "json",
  vue: "vue",
  rs: "rust",
  go: "go",
  py: "python",
  md: "markdown",
  markdown: "markdown",
  mdx: "markdown",
  html: "html",
  htm: "html",
  xml: "xml",
  svg: "xml",
  css: "css",
  scss: "scss",
  sass: "scss",
  less: "less",
  php: "php",
  rb: "ruby",
  rake: "ruby",
  gemspec: "ruby",
  ru: "ruby",
  sh: "shell",
  bash: "shell",
  zsh: "shell",
  ps1: "powershell",
  toml: "ini",
  yaml: "yaml",
  yml: "yaml",
  env: "ini",
  ini: "ini",
  conf: "ini",
  properties: "ini",
  nginx: "nginx",
  cmake: "cmake",
  lua: "lua",
  pl: "perl",
  r: "r",
  swift: "swift",
  c: "c",
  h: "c",
  cpp: "cpp",
  cc: "cpp",
  cxx: "cpp",
  hpp: "cpp",
  hxx: "cpp",
  java: "java",
  cs: "csharp",
  diff: "diff",
  patch: "diff",
  dockerfile: "dockerfile",
};

const FILENAME_OVERRIDES: Record<string, string> = {
  dockerfile: "dockerfile",
  "dockerfile.dev": "dockerfile",
  "dockerfile.prod": "dockerfile",
  ".env": "ini",
  ".env.local": "ini",
  ".env.development": "ini",
  ".env.production": "ini",
  ".editorconfig": "ini",
  "nginx.conf": "nginx",
  cmakelists: "cmake",
  "cmakelists.txt": "cmake",
  gemfile: "ruby",
  rakefile: "ruby",
  podfile: "ruby",
  fastfile: "ruby",
  guardfile: "ruby",
  brewfile: "ruby",
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

export function isMarkdownPath(filename: string): boolean {
  const ext = extOf(filename);
  return ext === "md" || ext === "markdown" || ext === "mdx";
}

export function resolveMonacoLanguageId(filename: string): string | null {
  const base = baseName(filename);
  if (FILENAME_OVERRIDES[base]) return FILENAME_OVERRIDES[base];
  const ext = extOf(base);
  if (!ext) return null;
  return EXT_MAP[ext] ?? null;
}
