import type { Extension } from "@codemirror/state";

type LoaderResult = Extension | { token: unknown };
type LanguageLoader = () => Promise<LoaderResult>;
type LanguageDescriptor = {
  label: string;
  loader: LanguageLoader;
};

const rubyLoader: LanguageLoader = () =>
  import("@codemirror/legacy-modes/mode/ruby").then((m) => m.ruby);

const jsonLoader: LanguageLoader = () =>
  import("@codemirror/lang-json").then((m) => m.json());

const propertiesLoader: LanguageLoader = () =>
  import("@codemirror/legacy-modes/mode/properties").then(
    (m) => m.properties,
  );

const sqlLoader: LanguageLoader = () =>
  import("@codemirror/legacy-modes/mode/sql").then((m) => m.standardSQL);
const pgsqlLoader: LanguageLoader = () =>
  import("@codemirror/legacy-modes/mode/sql").then((m) => m.pgSQL);
const mysqlLoader: LanguageLoader = () =>
  import("@codemirror/legacy-modes/mode/sql").then((m) => m.mySQL);
const sqliteLoader: LanguageLoader = () =>
  import("@codemirror/legacy-modes/mode/sql").then((m) => m.sqlite);
const mariadbLoader: LanguageLoader = () =>
  import("@codemirror/legacy-modes/mode/sql").then((m) => m.mariaDB);
const mssqlLoader: LanguageLoader = () =>
  import("@codemirror/legacy-modes/mode/sql").then((m) => m.msSQL);
const plsqlLoader: LanguageLoader = () =>
  import("@codemirror/legacy-modes/mode/sql").then((m) => m.plSQL);

/**
 * Extension → loader. Each loader is a dynamic import so language packs
 * only enter the bundle when a matching file is opened.
 *
 * Loaders may return either a ready Extension (lang-* packages) or a raw
 * StreamParser (legacy-modes). `resolveLanguage` wraps the latter in
 * StreamLanguage before returning.
 */
const languages: Record<string, LanguageDescriptor> = {
  // JavaScript / TypeScript family
  js: {
    label: "JavaScript",
    loader: () => import("@codemirror/lang-javascript").then((m) => m.javascript()),
  },
  jsx: {
    label: "JSX",
    loader: () =>
      import("@codemirror/lang-javascript").then((m) =>
        m.javascript({ jsx: true }),
      ),
  },
  mjs: {
    label: "JavaScript",
    loader: () => import("@codemirror/lang-javascript").then((m) => m.javascript()),
  },
  cjs: {
    label: "JavaScript",
    loader: () => import("@codemirror/lang-javascript").then((m) => m.javascript()),
  },
  ts: {
    label: "TypeScript",
    loader: () =>
      import("@codemirror/lang-javascript").then((m) =>
        m.javascript({ typescript: true }),
      ),
  },
  tsx: {
    label: "TSX",
    loader: () =>
      import("@codemirror/lang-javascript").then((m) =>
        m.javascript({ jsx: true, typescript: true }),
      ),
  },

  vue: {
    label: "Vue",
    loader: () => import("@codemirror/lang-vue").then((m) => m.vue()),
  },
  rs: {
    label: "Rust",
    loader: () => import("@codemirror/lang-rust").then((m) => m.rust()),
  },
  go: {
    label: "Go",
    loader: () => import("@codemirror/lang-go").then((m) => m.go()),
  },
  py: {
    label: "Python",
    loader: () => import("@codemirror/lang-python").then((m) => m.python()),
  },
  json: { label: "JSON", loader: jsonLoader },
  jsonc: { label: "JSONC", loader: jsonLoader },
  json5: { label: "JSON5", loader: jsonLoader },

  sql: { label: "SQL", loader: sqlLoader },
  psql: { label: "PostgreSQL", loader: pgsqlLoader },
  pgsql: { label: "PostgreSQL", loader: pgsqlLoader },
  mysql: { label: "MySQL", loader: mysqlLoader },
  sqlite: { label: "SQLite", loader: sqliteLoader },
  mariadb: { label: "MariaDB", loader: mariadbLoader },
  mssql: { label: "MS SQL", loader: mssqlLoader },
  plsql: { label: "PL/SQL", loader: plsqlLoader },

  md: {
    label: "Markdown",
    loader: () => import("@codemirror/lang-markdown").then((m) => m.markdown()),
  },
  markdown: {
    label: "Markdown",
    loader: () => import("@codemirror/lang-markdown").then((m) => m.markdown()),
  },
  mdx: {
    label: "MDX",
    loader: () => import("@codemirror/lang-markdown").then((m) => m.markdown()),
  },

  html: {
    label: "HTML",
    loader: () => import("@codemirror/lang-html").then((m) => m.html()),
  },
  htm: {
    label: "HTML",
    loader: () => import("@codemirror/lang-html").then((m) => m.html()),
  },
  xml: {
    label: "XML",
    loader: () => import("@codemirror/lang-xml").then((m) => m.xml()),
  },
  svg: {
    label: "SVG",
    loader: () => import("@codemirror/lang-xml").then((m) => m.xml()),
  },
  css: {
    label: "CSS",
    loader: () => import("@codemirror/lang-css").then((m) => m.css()),
  },
  scss: {
    label: "SCSS",
    loader: () => import("@codemirror/lang-sass").then((m) => m.sass()),
  },
  sass: {
    label: "Sass",
    loader: () =>
      import("@codemirror/lang-sass").then((m) => m.sass({ indented: true })),
  },
  less: {
    label: "Less",
    loader: () => import("@codemirror/legacy-modes/mode/css").then((m) => m.less),
  },

  php: {
    label: "PHP",
    loader: () => import("@codemirror/lang-php").then((m) => m.php({ plain: true })),
  },
  rb: { label: "Ruby", loader: rubyLoader },
  rake: { label: "Ruby", loader: rubyLoader },
  gemspec: { label: "Ruby", loader: rubyLoader },
  ru: { label: "Ruby", loader: rubyLoader },

  // C / C++ family
  c: {
    label: "C",
    loader: () => import("@codemirror/legacy-modes/mode/clike").then((m) => m.c),
  },
  h: {
    label: "C/C++ Header",
    loader: () => import("@codemirror/legacy-modes/mode/clike").then((m) => m.c),
  },
  cpp: {
    label: "C++",
    loader: () => import("@codemirror/legacy-modes/mode/clike").then((m) => m.cpp),
  },
  cc: {
    label: "C++",
    loader: () => import("@codemirror/legacy-modes/mode/clike").then((m) => m.cpp),
  },
  cxx: {
    label: "C++",
    loader: () => import("@codemirror/legacy-modes/mode/clike").then((m) => m.cpp),
  },
  hpp: {
    label: "C++ Header",
    loader: () => import("@codemirror/legacy-modes/mode/clike").then((m) => m.cpp),
  },
  hxx: {
    label: "C++ Header",
    loader: () => import("@codemirror/legacy-modes/mode/clike").then((m) => m.cpp),
  },

  // Java
  java: {
    label: "Java",
    loader: () => import("@codemirror/legacy-modes/mode/clike").then((m) => m.java),
  },

  // C#
  cs: {
    label: "C#",
    loader: () => import("@codemirror/legacy-modes/mode/clike").then((m) => m.csharp),
  },

  // Legacy-modes: loaders return the raw StreamParser; wrapped below.
  sh: {
    label: "Shell",
    loader: () => import("@codemirror/legacy-modes/mode/shell").then((m) => m.shell),
  },
  bash: {
    label: "Shell",
    loader: () => import("@codemirror/legacy-modes/mode/shell").then((m) => m.shell),
  },
  zsh: {
    label: "Shell",
    loader: () => import("@codemirror/legacy-modes/mode/shell").then((m) => m.shell),
  },
  ps1: {
    label: "PowerShell",
    loader: () =>
      import("@codemirror/legacy-modes/mode/powershell").then((m) => m.powerShell),
  },
  toml: {
    label: "TOML",
    loader: () => import("@codemirror/legacy-modes/mode/toml").then((m) => m.toml),
  },
  yaml: {
    label: "YAML",
    loader: () => import("@codemirror/legacy-modes/mode/yaml").then((m) => m.yaml),
  },
  yml: {
    label: "YAML",
    loader: () => import("@codemirror/legacy-modes/mode/yaml").then((m) => m.yaml),
  },
  dockerfile: {
    label: "Dockerfile",
    loader: () =>
      import("@codemirror/legacy-modes/mode/dockerfile").then(
        (m) => m.dockerFile,
      ),
  },
  diff: {
    label: "Diff",
    loader: () => import("@codemirror/legacy-modes/mode/diff").then((m) => m.diff),
  },
  patch: {
    label: "Diff",
    loader: () => import("@codemirror/legacy-modes/mode/diff").then((m) => m.diff),
  },
  env: { label: "Env", loader: propertiesLoader },
  ini: { label: "INI", loader: propertiesLoader },
  properties: { label: "Properties", loader: propertiesLoader },
  conf: { label: "Config", loader: propertiesLoader },
  nginx: {
    label: "Nginx",
    loader: () => import("@codemirror/legacy-modes/mode/nginx").then((m) => m.nginx),
  },
  cmake: {
    label: "CMake",
    loader: () => import("@codemirror/legacy-modes/mode/cmake").then((m) => m.cmake),
  },
  lua: {
    label: "Lua",
    loader: () => import("@codemirror/legacy-modes/mode/lua").then((m) => m.lua),
  },
  pl: {
    label: "Perl",
    loader: () => import("@codemirror/legacy-modes/mode/perl").then((m) => m.perl),
  },
  r: {
    label: "R",
    loader: () => import("@codemirror/legacy-modes/mode/r").then((m) => m.r),
  },
  swift: {
    label: "Swift",
    loader: () => import("@codemirror/legacy-modes/mode/swift").then((m) => m.swift),
  },
};

const filenameOverrides: Record<string, LanguageDescriptor> = {
  dockerfile: languages.dockerfile!,
  "dockerfile.dev": languages.dockerfile!,
  "dockerfile.prod": languages.dockerfile!,
  ".env": languages.env!,
  ".env.local": languages.env!,
  ".env.development": languages.env!,
  ".env.production": languages.env!,
  ".editorconfig": languages.ini!,
  "nginx.conf": languages.nginx!,
  "cmakelists.txt": languages.cmake!,
  gemfile: languages.rb!,
  rakefile: languages.rb!,
  podfile: languages.rb!,
  fastfile: languages.rb!,
  guardfile: languages.rb!,
  brewfile: languages.rb!,
};

function extOf(name: string): string | null {
  const lower = name.toLowerCase();
  const dot = lower.lastIndexOf(".");
  if (dot === -1 || dot === lower.length - 1) return null;
  return lower.slice(dot + 1);
}

function baseName(filename: string): string {
  const lower = filename.toLowerCase();
  return lower.split(/[\\/]/).pop() ?? lower;
}

function isStreamParser(v: unknown): boolean {
  return (
    typeof v === "object" &&
    v !== null &&
    typeof (v as { token?: unknown }).token === "function"
  );
}

const cache = new Map<string, Extension | null>();

function descriptorForPath(filename: string): LanguageDescriptor | null {
  const base = baseName(filename);
  return filenameOverrides[base] ?? languages[extOf(base) ?? ""] ?? null;
}

export function isMarkdownPath(filename: string): boolean {
  const base = baseName(filename);
  const ext = extOf(base);
  return ext === "md" || ext === "markdown" || ext === "mdx";
}

export function languageLabelForPath(filename: string): string {
  return descriptorForPath(filename)?.label ?? "Plain Text";
}

function cacheKey(filename: string): string | null {
  const base = baseName(filename);
  if (filenameOverrides[base]) return `name:${base}`;
  const ext = extOf(base);
  return ext ? `ext:${ext}` : null;
}

export function resolveLanguageSync(filename: string): Extension | null {
  const key = cacheKey(filename);
  return key ? (cache.get(key) ?? null) : null;
}

export async function resolveLanguage(
  filename: string,
): Promise<Extension | null> {
  const key = cacheKey(filename);
  if (!key) return null;
  const cached = cache.get(key);
  if (cached !== undefined) return cached;

  const descriptor = descriptorForPath(filename);
  if (!descriptor) {
    cache.set(key, null);
    return null;
  }

  const result = await descriptor.loader();
  let ext: Extension;
  if (isStreamParser(result)) {
    const { StreamLanguage } = await import("@codemirror/language");
    ext = StreamLanguage.define(
      result as Parameters<typeof StreamLanguage.define>[0],
    );
  } else {
    ext = result as Extension;
  }
  cache.set(key, ext);
  return ext;
}

export function preloadLanguages(filenames: string[]): void {
  for (const f of filenames) {
    void resolveLanguage(f).catch(() => {});
  }
}
