# Nexterm Monaco Editor 骨架迁移实施计划（Section 1）

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** 把 `src/modules/editor/` 从 CodeMirror 6 全量迁移到 Monaco Editor（主编辑器 + Git Diff），保留 9 套主题、Vim、Markdown split/preview、保存冲突对话框、外部变更检测、行/列状态栏与 `editor.save` / `editor.gotoLine` 命令合约。

**Architecture:** 在 `src/modules/editor/` 下新增 `editorConfig.ts` / `themes.ts` / `languageMap.ts` 三个 lib 适配层，主编辑器用 `monaco.editor.create`，Diff 用 `monaco.editor.createDiffEditor`，Vim 用 `monaco-vim`。workers 由 `vite-plugin-monaco-editor` 自动注入。CodeMirror 与 Monaco 短暂共存直至最后任务统一清理。

**Tech Stack:**
- `monaco-editor ^0.52.x`（主依赖）
- `monaco-vim ^0.4.x`（Vim 模式）
- `monaco-themes ^0.1.x`（9 套主题 token 等价映射）
- `vite-plugin-monaco-editor ^1.1.x`（worker 自动注入 + 按需分包）
- 移除：`@codemirror/*`（28 包）、`@uiw/codemirror-theme-*`（9 包）、`@replit/codemirror-vim`、`@lezer/highlight`

## Global Constraints

- 包管理器：`pnpm`（强制）
- 提交前缀遵循 Conventional Commits（`feat:` / `fix:` / `refactor:` / `chore:` / `docs:` / `test:`）；commit 信息用中文，前缀英文
- 路径别名：`@/` 映射到 `src/`，禁止深层相对路径
- 命名：Vue 组件 `PascalCase.vue`；lib 文件 `camelCase.ts`；测试 `*.test.ts` / `*.vue.test.ts`
- 所有 IPC 必须经由 `@/lib/native.ts`（沿用 `nativeBoundary.test.ts` 守卫）
- 每个任务结束前必须跑 `pnpm test` + `pnpm build`（Section 1 暂不涉及 LSP，故不要求 `cargo clippy`）
- Monaco 主题 id 与现有 `EditorThemeId` 偏好保持一致（`atomone` / `aura` / `copilot` / `github-dark` / `github-light` / `nord` / `tokyo-night` / `xcode-dark` / `xcode-light`），不在 settings 中新增
- `EditorPaneHandle` 移除 `setQuery` / `findNext` / `findPrevious` / `clearQuery`（无外部消费方；Monaco 自带搜索面板）
- 不重写 Markdown 渲染、不重写 Tab / Diff 缓存、不引入新 IPC 总线

## File Structure

### 新增

```
src/modules/editor/
  DiffEditor.vue                    # 替换 DiffCodeMirror.vue（基于 createDiffEditor）
  lib/
    editorConfig.ts                 # IStandaloneEditorConstructionOptions 工厂
    themes.ts                       # 9 套 monaco.editor.defineTheme 注册
    languageMap.ts                  # 文件名 → monaco 语言 id（替代 languageResolver.ts）

docs/superpowers/plans/
  2026-07-16-monaco-lsp-migration.md  # 本计划
```

### 修改

```
package.json                                  # 增删依赖
vite.config.ts                                # 注册插件 + 更新 manualChunks
src/modules/editor/EditorPane.vue             # 整文件重写（CodeMirror → Monaco）
src/modules/editor/GitDiffPane.vue            # 引用 DiffCodeMirror → DiffEditor
src/modules/editor/lib/vim.ts                 # 用 monaco-vim 重写
src/modules/editor/editorTypes.ts             # EditorPaneHandle 简化
src/modules/editor/index.ts                   # 仍导出 EditorPaneHandle + GitDiffStack
src/modules/editor/EditorPane.vue.test.ts     # 选择器重写（.cm-* → .view-line / .monaco-editor）
src/modules/editor/editorVueBoundary.test.ts  # Monaco 守卫（禁用 codemirror 名称回归）
```

### 删除（最后任务执行）

```
src/modules/editor/DiffCodeMirror.vue
src/modules/editor/lib/languageResolver.ts
src/modules/editor/lib/extensions.ts          # CodeMirror compartments，Monaco 不再需要
```

### Section 2/3 暂不实施（占位，不在本计划任务中）

```
src-tauri/src/modules/lsp/                    # Section 2 引入
src/modules/lsp/                              # Section 2 引入
```

---

## Task 1: 引入 Monaco 依赖与构建配置

**Files:**
- Modify: `package.json`
- Modify: `vite.config.ts`

**Interfaces:**
- Consumes: 现有 package.json（Version 0.1.2）、现有 vite.config.ts
- Produces: 新的 monaco 依赖被 install；Monaco 的 worker 在构建时按需分包

- [ ] **Step 1: 添加 monaco 相关 npm 依赖**

```bash
cd /home/xinggao/dev/rust/nexterm
pnpm add monaco-editor@^0.52 monaco-vim@^0.4 monaco-themes@^0.1 vite-plugin-monaco-editor@^1.1
```

预期：package.json `dependencies` 增加 4 个包。

- [ ] **Step 2: 移除 CodeMirror 相关依赖**

```bash
pnpm remove \
  @codemirror/autocomplete @codemirror/commands @codemirror/lang-css \
  @codemirror/lang-go @codemirror/lang-html @codemirror/lang-javascript \
  @codemirror/lang-json @codemirror/lang-markdown @codemirror/lang-php \
  @codemirror/lang-python @codemirror/lang-rust @codemirror/lang-sass \
  @codemirror/lang-vue @codemirror/lang-xml @codemirror/language \
  @codemirror/legacy-modes @codemirror/lint @codemirror/merge \
  @codemirror/search @codemirror/state @codemirror/view \
  @replit/codemirror-vim @lezer/highlight \
  @uiw/codemirror-theme-atomone @uiw/codemirror-theme-aura \
  @uiw/codemirror-theme-copilot @uiw/codemirror-theme-github \
  @uiw/codemirror-theme-nord @uiw/codemirror-theme-tokyo-night \
  @uiw/codemirror-theme-xcode @uiw/codemirror-themes
```

预期：所有 codemirror/uiw/replit/lezer 相关包从 `package.json` 与 `pnpm-lock.yaml` 消失。**注意此时构建会失败**——这是预期的，下一个任务会修复。

- [ ] **Step 3: 在 vite.config.ts 中注册 monaco-editor plugin**

修改 `vite.config.ts`：

```typescript
import tailwindcss from "@tailwindcss/vite";
import vue from "@vitejs/plugin-vue";
import { readFileSync } from "node:fs";
import path from "path";
import AutoImport from "unplugin-auto-import/vite";
import Components from "unplugin-vue-components/vite";
import { NaiveUiResolver } from "unplugin-vue-components/resolvers";
import monacoEditorPluginRaw from "vite-plugin-monaco-editor";
import { defineConfig } from "vite";

const monacoEditorPlugin = (monacoEditorPluginRaw as any).default ?? monacoEditorPluginRaw;
const host = process.env.TAURI_DEV_HOST;
const packageJson = JSON.parse(
  readFileSync(new URL("./package.json", import.meta.url), "utf8"),
) as { version: string };

export default defineConfig(async ({ mode }) => ({
  plugins: [
    vue(),
    AutoImport({
      imports: ["vue", "vue-router", "pinia"],
      vueTemplate: true,
      dts: "src/auto-imports.d.ts",
    }),
    Components({
      resolvers: [NaiveUiResolver()],
      dts: "src/components.d.ts",
    }),
    monacoEditorPlugin({
      languageWorkers: ["editorWorkerService", "typescript", "json", "html", "css"],
    }),
    tailwindcss(),
  ],
  resolve: {
    alias: {
      "@": path.resolve(__dirname, "./src"),
    },
  },
  define: {
    __NEXTERM_VERSION__: JSON.stringify(packageJson.version),
  },
  esbuild: {
    drop: mode === "production" ? (["debugger"] as ["debugger"]) : [],
    pure:
      mode === "production"
        ? ["console.debug", "console.info", "console.trace"]
        : [],
  },
  build: {
    target:
      process.env.TAURI_ENV_PLATFORM === "windows" ? "chrome120" : "es2022",
    chunkSizeWarningLimit: 1500,
    rollupOptions: {
      input: path.resolve(__dirname, "index.html"),
      output: {
        manualChunks(id: string) {
          if (!id.includes("node_modules")) return;
          if (id.includes("/xterm/") || id.includes("@xterm/")) return "xterm";
          if (
            id.includes("monaco-editor") ||
            id.includes("monaco-vim") ||
            id.includes("monaco-themes")
          )
            return "monaco";
          if (
            id.includes("/vue/") ||
            id.includes("/@vue/") ||
            id.includes("/naive-ui/") ||
            id.includes("/pinia/") ||
            id.includes("/vue-router/")
          )
            return "vue-vendor";
        },
      },
    },
  },
  clearScreen: false,
  server: {
    port: 3180,
    strictPort: true,
    host: host || false,
    hmr: host
      ? {
          protocol: "ws",
          host,
          port: 1421,
        }
      : undefined,
    watch: {
      ignored: ["**/src-tauri/**"],
    },
  },
}));
```

- [ ] **Step 4: 运行 pnpm install 让 lockfile 与新依赖同步**

```bash
pnpm install
```

预期：`Done` 一行；无 ERR_/ELSPV 错误；`pnpm-lock.yaml` 已更新。

- [ ] **Step 5: 提交**

```bash
git add package.json pnpm-lock.yaml vite.config.ts
git commit -m "chore(build): 引入 monaco-editor 依赖与 vite plugin，移除 codemirror"
```

此时 `pnpm build` 仍会失败（编辑器代码还在引用 CodeMirror），这是预期，下个任务修复。

---

## Task 2: 编辑器适配层（themes / languageMap / editorConfig）

**Files:**
- Create: `src/modules/editor/lib/themes.ts`
- Create: `src/modules/editor/lib/languageMap.ts`
- Create: `src/modules/editor/lib/editorConfig.ts`
- Create: `src/modules/editor/lib/languageMap.test.ts`

**Interfaces:**
- Consumes: `EditorThemeId`（来自 `@/modules/settings/store`）；`usePreferencesPiniaStore`（`prefs.editorTheme` / `prefs.editorFontSize` / `prefs.editorTabSize` / `prefs.editorWordWrap`）
- Produces:
  - `themes.ts` → `registerMonacoThemes()`：在 app 启动时调用，逐个 `monaco.editor.defineTheme`
  - `languageMap.ts` → `resolveMonacoLanguageId(filename: string): string | null`
  - `editorConfig.ts` → `buildMonacoEditorOptions(prefs, languageId): monaco.editor.IStandaloneEditorConstructionOptions`

- [ ] **Step 1: 写 languageMap.test.ts 失败测试**

新建 `src/modules/editor/lib/languageMap.test.ts`：

```ts
import { describe, expect, it } from "vitest";
import { isMarkdownPath, resolveMonacoLanguageId } from "./languageMap";

describe("languageMap", () => {
  it("maps common code extensions to monaco language ids", () => {
    expect(resolveMonacoLanguageId("src/main.ts")).toBe("typescript");
    expect(resolveMonacoLanguageId("src/App.tsx")).toBe("typescript");
    expect(resolveMonacoLanguageId("package.json")).toBe("json");
    expect(resolveMonacoLanguageId("Cargo.toml")).toBe("ini");
    expect(resolveMonacoLanguageId("README.md")).toBe("markdown");
    expect(resolveMonacoLanguageId("script.py")).toBe("python");
    expect(resolveMonacoLanguageId("main.go")).toBe("go");
    expect(resolveMonacoLanguageId("lib.rs")).toBe("rust");
    expect(resolveMonacoLanguageId("unknown.xyz")).toBeNull();
  });

  it("recognises override filenames", () => {
    expect(resolveMonacoLanguageId("Dockerfile")).toBe("dockerfile");
    expect(resolveMonacoLanguageId(".env")).toBe("ini");
    expect(resolveMonacoLanguageId("nginx.conf")).toBe("nginx");
  });

  it("detects markdown variants", () => {
    expect(isMarkdownPath("README.md")).toBe(true);
    expect(isMarkdownPath("page.markdown")).toBe(true);
    expect(isMarkdownPath("post.mdx")).toBe(true);
    expect(isMarkdownPath("main.ts")).toBe(false);
  });
});
```

- [ ] **Step 2: 跑测试，确认它们失败**

```bash
pnpm test src/modules/editor/lib/languageMap.test.ts
```

预期：FAIL 显示 `Cannot find module './languageMap'`。

- [ ] **Step 3: 实现 languageMap.ts**

新建 `src/modules/editor/lib/languageMap.ts`：

```ts
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
```

- [ ] **Step 4: 跑测试，确认通过**

```bash
pnpm test src/modules/editor/lib/languageMap.test.ts
```

预期：3 个 `it` 全 PASS。

- [ ] **Step 5: 实现 themes.ts**

新建 `src/modules/editor/lib/themes.ts`：

```ts
import * as monaco from "monaco-editor";
import { atomOneDark } from "monaco-themes/themes/Atom One Dark";
import { auraDark } from "monaco-themes/themes/Aura Dark";
import { copilot } from "monaco-themes/themes/Copilot";
import { githubDark, githubLight } from "monaco-themes/themes/GitHub Dark,GitHub Light";
import { nord } from "monaco-themes/themes/Nord";
import { tokyoNight } from "monaco-themes/themes/Tokyo Night";
import { xcodeDefault, xcodeDark } from "monaco-themes/themes/Xcode_default,Xcode_Dark";

const THEME_DATA: Record<string, monaco.editor.IStandaloneThemeData> = {
  atomone: atomOneDark,
  aura: auraDark,
  copilot: copilot,
  "github-dark": githubDark,
  "github-light": githubLight,
  nord: nord,
  "tokyo-night": tokyoNight,
  "xcode-dark": xcodeDark,
  "xcode-light": xcodeDefault,
};

let registered = false;

export function registerMonacoThemes(): void {
  if (registered) return;
  registered = true;
  for (const [id, data] of Object.entries(THEME_DATA)) {
    monaco.editor.defineTheme(id, data);
  }
}

export const MONACO_THEME_IDS = Object.keys(THEME_DATA) as Array<keyof typeof THEME_DATA>;

export function getMonacoThemeId(themeId: string): string {
  return themeId in THEME_DATA ? themeId : "atomone";
}
```

（如果 `monaco-themes` 包实际导出名称与上面不同——例如不同版本可能命名为 `AtomOneDark` 而不是 `atomOneDark` ——请按 `node_modules/monaco-themes/themes/` 下实际文件命名调整 import 路径。`pnpm build` 失败时按报错修复。）

- [ ] **Step 6: 实现 editorConfig.ts**

新建 `src/modules/editor/lib/editorConfig.ts`：

```ts
import * as monaco from "monaco-editor";
import { detectMonoFontFamily } from "@/lib/fonts";
import type { EditorThemeId } from "@/modules/settings/store";
import { getMonacoThemeId } from "./themes";

export type EditorPrefs = {
  editorTheme: EditorThemeId;
  editorFontSize: number;
  editorTabSize: number;
  editorWordWrap: boolean;
};

export function buildMonacoEditorOptions(
  prefs: EditorPrefs,
  languageId: string | null,
): monaco.editor.IStandaloneEditorConstructionOptions {
  return {
    automaticLayout: true,
    fontFamily: detectMonoFontFamily(),
    fontSize: prefs.editorFontSize,
    lineNumbers: "on",
    folding: true,
    bracketPairColorization: { enabled: true },
    autoClosingBrackets: "always",
    autoClosingQuotes: "always",
    tabSize: prefs.editorTabSize,
    wordWrap: prefs.editorWordWrap ? "on" : "off",
    minimap: { enabled: false },
    renderWhitespace: "none",
    scrollBeyondLastLine: false,
    smoothScrolling: true,
    fixedOverflowWidgets: true,
    renderLineHighlight: "all",
    roundedSelection: true,
    scrollbar: {
      verticalScrollbarSize: 10,
      horizontalScrollbarSize: 10,
      useShadows: false,
    },
    theme: getMonacoThemeId(prefs.editorTheme),
    language: languageId ?? undefined,
  };
}

export function buildMonacoDiffOptions(
  prefs: EditorPrefs,
): monaco.editor.IDiffEditorConstructionOptions {
  return {
    automaticLayout: true,
    enableSplitViewResizing: false,
    renderSideBySide: true,
    renderIndicators: true,
    ignoreTrimWhitespace: false,
    originalEditable: false,
    readOnly: true,
    fontFamily: detectMonoFontFamily(),
    fontSize: prefs.editorFontSize,
    minimap: { enabled: false },
    scrollBeyondLastLine: false,
    theme: getMonacoThemeId(prefs.editorTheme),
    renderLineHighlight: "all",
  };
}
```

- [ ] **Step 7: 跑测试 + 检查构建**

```bash
pnpm test src/modules/editor/lib/
```

预期：所有 lib 测试通过。`EditorPane.vue` 等仍在 import CodeMirror，**`pnpm build` 仍会失败**——下个任务解决。

- [ ] **Step 8: 提交**

```bash
git add src/modules/editor/lib/themes.ts \
        src/modules/editor/lib/languageMap.ts \
        src/modules/editor/lib/editorConfig.ts \
        src/modules/editor/lib/languageMap.test.ts
git commit -m "feat(editor): 新增 Monaco 适配层（themes / languageMap / editorConfig）"
```

---

## Task 3: EditorPane.vue 全量重写（CodeMirror → Monaco）

**Files:**
- Modify: `src/modules/editor/EditorPane.vue`（整文件）
- Modify: `src/modules/editor/EditorPane.vue.test.ts`（重写选择器）
- Create: `src/modules/editor/lib/editorRuntime.ts`（runtime 助手：mount / dispose）

**Interfaces:**
- Consumes: `props: { path, fsEvent? }`；`emit: { dirtyChange, saved }`；`prefs: usePreferencesPiniaStore()`
- Produces:
  - `defineExpose`：`save() / focus() / getSelection() / openGotoLine() / reload() / undo() / redo()`
  - DOM：保留 `data-editor-host` 与 `.nexterm-editor-scrollbar` 类名

- [ ] **Step 1: 实现 editorRuntime.ts**

新建 `src/modules/editor/lib/editorRuntime.ts`：

```ts
import * as monaco from "monaco-editor";

export type EditorMount = {
  editor: monaco.editor.IStandaloneCodeEditor;
  disposables: monaco.IDisposable[];
};

export function mountMonacoEditor(
  host: HTMLElement,
  options: monaco.editor.IStandaloneEditorConstructionOptions,
  value: string,
): EditorMount {
  host.innerHTML = "";
  const editor = monaco.editor.create(host, options);
  editor.setValue(value);
  const disposables: monaco.IDisposable[] = [];
  return { editor, disposables };
}

export function disposeEditor(mount: EditorMount | null): void {
  if (!mount) return;
  for (const d of mount.disposables) d.dispose();
  mount.editor.getModel()?.dispose();
  mount.editor.dispose();
}

export function safeReplaceValue(
  editor: monaco.editor.IStandaloneCodeEditor,
  value: string,
): void {
  const model = editor.getModel();
  if (!model) {
    editor.setValue(value);
    return;
  }
  const fullRange = model.getFullModelRange();
  editor.executeEdits("external-reload", [
    { range: fullRange, text: value, forceMoveMarkers: true },
  ]);
}
```

- [ ] **Step 2: 整文件重写 EditorPane.vue**

整文件替换 `src/modules/editor/EditorPane.vue`，关键骨架：

```vue
<script setup lang="ts">
import * as monaco from "monaco-editor";
import { NSpin, useDialog } from "naive-ui";
import { computed, nextTick, onBeforeUnmount, ref, shallowRef, watch } from "vue";
import { t } from "@/modules/i18n/translate";
import { usePreferencesPiniaStore } from "@/modules/settings/preferencesPinia";
import type { WorkspaceFsChangedEvent } from "@/lib/native";
import type { EditorViewMode } from "./editorTypes";
import EditorStatusBar from "./EditorStatusBar.vue";
import EditorToolbar from "./EditorToolbar.vue";
import MarkdownEditorPreview from "./MarkdownEditorPreview.vue";
import {
  readEditorDocument,
  writeEditorDocument,
  type EditorDocumentState,
} from "./lib/documentService";
import { buildMonacoEditorOptions } from "./lib/editorConfig";
import {
  disposeEditor,
  mountMonacoEditor,
  safeReplaceValue,
  type EditorMount,
} from "./lib/editorRuntime";
import {
  isMarkdownPath,
  resolveMonacoLanguageId,
} from "./lib/languageMap";
import { registerMonacoThemes } from "./lib/themes";

registerMonacoThemes();

const props = defineProps<{
  path: string;
  fsEvent?: WorkspaceFsChangedEvent | null;
}>();

const emit = defineEmits<{
  dirtyChange: [dirty: boolean];
  saved: [];
}>();

const dialog = useDialog();
const prefs = usePreferencesPiniaStore();
const host = ref<HTMLDivElement | null>(null);
const mount = shallowRef<EditorMount | null>(null);
const doc = ref<EditorDocumentState>({ status: "loading" });
const savedContent = ref("");
const buffer = ref("");
const dirty = ref(false);
const externalChangePending = ref(false);
const mode = ref<EditorViewMode>("source");
const line = ref(1);
const column = ref(1);
const selectionLength = ref(0);

const fileName = computed(() => {
  const parts = props.path.split(/[\\/]/).filter(Boolean);
  return parts.length > 0 ? parts[parts.length - 1] : props.path;
});

const markdown = computed(() => isMarkdownPath(props.path));
const languageLabel = computed(() => resolveMonacoLanguageId(props.path) ?? "Plain Text");

const sourcePaneClass = computed(() => {
  if (!markdown.value || mode.value === "source") return "h-full w-full";
  if (mode.value === "split") return "h-full w-1/2 border-r border-border/60";
  return "h-full w-0";
});

const previewPaneClass = computed(() =>
  mode.value === "split" ? "h-full w-1/2" : "h-full w-full",
);

const sizeLabel = computed(() => {
  const current = doc.value;
  return "size" in current ? formatBytes(current.size) : "0 B";
});

function formatBytes(n: number): string {
  if (n < 1024) return `${n} B`;
  if (n < 1024 * 1024) return `${(n / 1024).toFixed(1)} KB`;
  return `${(n / 1024 / 1024).toFixed(1)} MB`;
}

function setDirty(next: boolean) {
  if (dirty.value === next) return;
  dirty.value = next;
  emit("dirtyChange", next);
}

function setMode(next: EditorViewMode) {
  if (!markdown.value && next !== "source") return;
  mode.value = next;
  void nextTick(() => mount.value?.editor.layout());
}

async function createEditor(content: string) {
  await nextTick();
  if (!host.value) return;
  disposeEditor(mount.value);
  mount.value = null;
  const opts = buildMonacoEditorOptions(prefs, resolveMonacoLanguageId(props.path));
  const fresh = mountMonacoEditor(host.value, opts, content);
  fresh.disposables.push(
    fresh.editor.onDidChangeModelContent(() => {
      const next = fresh.editor.getValue();
      buffer.value = next;
      setDirty(next !== savedContent.value);
    }),
    fresh.editor.onDidChangeCursorPosition((e) => {
      line.value = e.position.lineNumber;
      column.value = e.position.column;
      const sel = fresh.editor.getSelection();
      if (sel) {
        const model = fresh.editor.getModel();
        if (model) selectionLength.value = model.getValueLengthInRange(sel);
      }
    }),
  );
  mount.value = fresh;
}

async function load() {
  disposeEditor(mount.value);
  mount.value = null;
  doc.value = { status: "loading" };
  externalChangePending.value = false;
  mode.value = isMarkdownPath(props.path) ? "split" : "source";
  line.value = 1;
  column.value = 1;
  selectionLength.value = 0;
  setDirty(false);
  emit("dirtyChange", false);
  const result = await readEditorDocument(props.path);
  doc.value = result;
  if (result.status === "ready") {
    savedContent.value = result.content;
    buffer.value = result.content;
    await createEditor(result.content);
  }
}

function normalizePath(path: string): string {
  return path.replace(/\\/g, "/").replace(/\/+$/, "");
}

function fsEventTouchesPath(event: WorkspaceFsChangedEvent, path: string): boolean {
  const current = normalizePath(path);
  if (event.paths.length === 0) {
    const root = normalizePath(event.rootPath);
    return current === root || current.startsWith(`${root}/`);
  }
  return event.paths.some((eventPath) => normalizePath(eventPath) === current);
}

async function reloadExternalChange(force = false) {
  if (dirty.value && !force) {
    externalChangePending.value = true;
    return;
  }
  const currentPath = props.path;
  const result = await readEditorDocument(currentPath);
  if (props.path !== currentPath || (dirty.value && !force)) return;
  doc.value = result;
  externalChangePending.value = false;
  if (result.status === "ready") {
    buffer.value = result.content;
    savedContent.value = result.content;
    setDirty(false);
    if (mount.value) safeReplaceValue(mount.value.editor, result.content);
    else await createEditor(result.content);
  } else {
    savedContent.value = "";
    buffer.value = "";
    disposeEditor(mount.value);
    mount.value = null;
  }
}

async function saveConfirmed() {
  if (!dirty.value) return;
  await writeEditorDocument(props.path, buffer.value);
  savedContent.value = buffer.value;
  externalChangePending.value = false;
  setDirty(false);
  emit("saved");
}

async function save() {
  if (!dirty.value) return;
  if (!externalChangePending.value) {
    await saveConfirmed();
    return;
  }
  dialog.warning({
    title: t("editor.externalChangeSaveTitle"),
    content: t("editor.externalChangeSaveContent"),
    positiveText: t("editor.save"),
    negativeText: t("common.cancel"),
    onPositiveClick: () => void saveConfirmed(),
  });
}

function focus() {
  mount.value?.editor.focus();
}

function getSelection(): string | null {
  const editor = mount.value?.editor;
  if (!editor) return null;
  const sel = editor.getSelection();
  if (!sel || sel.isEmpty()) return null;
  return editor.getModel()?.getValueInRange(sel) ?? null;
}

function openGotoLine(): void {
  const editor = mount.value?.editor;
  if (!editor) return;
  editor.focus();
  const raw = window.prompt(t("editor.gotoLinePrompt"), String(line.value));
  if (!raw) return;
  const target = Number.parseInt(raw, 10);
  if (!Number.isFinite(target) || target < 1) return;
  const model = editor.getModel();
  if (!model) return;
  const clamped = Math.min(target, model.getLineCount());
  editor.setPosition({ lineNumber: clamped, column: 1 });
  editor.revealLine(clamped);
  line.value = clamped;
}

function setContentForTest(content: string) {
  const editor = mount.value?.editor;
  if (!editor) {
    buffer.value = content;
    setDirty(content !== savedContent.value);
    return;
  }
  safeReplaceValue(editor, content);
}

watch(() => props.path, () => void load(), { immediate: true });

watch(() => props.fsEvent, (event) => {
  if (!event || !fsEventTouchesPath(event, props.path)) return;
  void reloadExternalChange();
});

watch(
  () => prefs.editorTheme,
  () => {
    if (!mount.value) return;
    import("monaco-editor").then((m) => {
      m.editor.setTheme(prefs.editorTheme);
    });
  },
);

watch(
  () => [prefs.editorFontSize, prefs.editorTabSize, prefs.editorWordWrap],
  () => {
    if (doc.value.status === "ready") void createEditor(buffer.value);
  },
);

onBeforeUnmount(() => {
  disposeEditor(mount.value);
  mount.value = null;
});

defineExpose({
  save,
  focus,
  getSelection,
  setContentForTest,
  openGotoLine,
  reload: () => reloadExternalChange(true),
  undo: () => mount.value?.editor.trigger("keyboard", "undo", null),
  redo: () => mount.value?.editor.trigger("keyboard", "redo", null),
});
</script>

<template>
  <div class="flex h-full min-h-0 flex-col bg-background">
    <EditorToolbar
      :file-name="fileName"
      :language-label="languageLabel"
      :dirty="dirty"
      :external-change-pending="externalChangePending"
      :is-markdown="markdown"
      :mode="mode"
      @dismiss-external-change="externalChangePending = false"
      @reload-external-change="() => void reloadExternalChange(true)"
      @save="() => void save()"
      @mode-change="setMode"
    />

    <div v-if="doc.status === 'loading'" class="grid min-h-0 flex-1 place-items-center">
      <div class="flex items-center gap-2 text-xs text-muted-foreground">
        <NSpin size="small" />
        <span>{{ t("editor.loadingFile") }}</span>
      </div>
    </div>
    <div v-else-if="doc.status === 'error'" class="grid min-h-0 flex-1 place-items-center p-6 text-center text-xs text-destructive">
      {{ doc.message }}
    </div>
    <div v-else-if="doc.status === 'binary'" class="grid min-h-0 flex-1 place-items-center p-6 text-center">
      <div>
        <div class="text-sm font-medium">{{ t("editor.binaryFile") }}</div>
        <div class="mt-1 text-xs text-muted-foreground">{{ formatBytes(doc.size) }} · {{ t("editor.previewNotSupported") }}</div>
      </div>
    </div>
    <div v-else-if="doc.status === 'toolarge'" class="grid min-h-0 flex-1 place-items-center p-6 text-center">
      <div>
        <div class="text-sm font-medium">{{ t("editor.fileTooLarge") }}</div>
        <div class="mt-1 text-xs text-muted-foreground">
          {{ t("editor.exceedsLimit", { size: formatBytes(doc.size), limit: formatBytes(doc.limit) }) }}
        </div>
      </div>
    </div>
    <div v-else data-editor-mode-root class="min-h-0 flex-1 overflow-hidden" :data-mode="mode">
      <div class="flex h-full min-h-0">
        <div v-show="!markdown || mode !== 'preview'" data-editor-source-panel class="min-h-0 overflow-hidden" :class="sourcePaneClass">
          <div ref="host" data-editor-host class="nexterm-editor-scrollbar h-full min-h-0" />
        </div>
        <div v-if="markdown" v-show="mode !== 'source'" data-editor-preview-panel class="min-h-0 overflow-hidden" :class="previewPaneClass">
          <MarkdownEditorPreview :content="buffer" />
        </div>
      </div>
    </div>

    <EditorStatusBar
      v-if="doc.status === 'ready'"
      :language-label="languageLabel"
      :size-label="sizeLabel"
      :dirty="dirty"
      :line="line"
      :column="column"
      :selection-length="selectionLength"
    />
  </div>
</template>
```

- [ ] **Step 3: 重写 EditorPane.vue.test.ts**

整文件替换 `src/modules/editor/EditorPane.vue.test.ts`：

```ts
// @vitest-environment jsdom
import { mount } from "@vue/test-utils";
import { createPinia } from "pinia";
import { nextTick } from "vue";
import { beforeEach, describe, expect, it, vi } from "vitest";
import EditorPane from "./EditorPane.vue";
import { readEditorDocument, writeEditorDocument } from "./lib/documentService";

const dialogWarningMock = vi.hoisted(() => vi.fn());

vi.mock("naive-ui", async () => {
  const actual = await vi.importActual<typeof import("naive-ui")>("naive-ui");
  return {
    ...actual,
    useDialog: () => ({ warning: dialogWarningMock }),
  };
});

vi.mock("./lib/documentService", () => ({
  readEditorDocument: vi.fn(),
  writeEditorDocument: vi.fn(),
}));

vi.mock("monaco-editor", async () => {
  const actual = await vi.importActual<typeof import("monaco-editor")>("monaco-editor");
  const noopDisposable = { dispose: () => {} };
  const fakeEditor: any = {
    getValue: () => "const value = 1;",
    setValue: (v: string) => {
      fakeEditor._value = v;
    },
    getModel: () => ({
      getValue: () => fakeEditor._value ?? "const value = 1;",
      getValueLengthInRange: () => 0,
    }),
    getSelection: () => ({ isEmpty: () => true }),
    onDidChangeModelContent: (cb: () => void) => {
      fakeEditor._contentCb = cb;
      return noopDisposable;
    },
    onDidChangeCursorPosition: (cb: (e: any) => void) => {
      fakeEditor._cursorCb = cb;
      return noopDisposable;
    },
    trigger: () => undefined,
    focus: () => undefined,
    layout: () => undefined,
    setPosition: (p: any) => {
      fakeEditor._pos = p;
    },
    revealLine: () => undefined,
  };
  return {
    ...actual,
    editor: {
      ...actual.editor,
      create: () => fakeEditor,
      createDiffEditor: () => ({}),
      setTheme: () => undefined,
      defineTheme: () => undefined,
    },
  };
});

async function flush() {
  await Promise.resolve();
  await nextTick();
}

describe("EditorPane.vue", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    dialogWarningMock.mockReset();
    vi.mocked(readEditorDocument).mockResolvedValue({
      status: "ready",
      content: "const value = 1;",
      size: 16,
    });
  });

  it("loads text documents into a Monaco host", async () => {
    const wrapper = mount(EditorPane, {
      global: { plugins: [createPinia()] },
      props: { path: "/repo/src/main.ts" },
    });
    await flush();
    expect(readEditorDocument).toHaveBeenCalledWith("/repo/src/main.ts");
    expect(wrapper.find("[data-editor-host]").exists()).toBe(true);
    expect(wrapper.text()).toContain("main.ts");
    expect(wrapper.find("[data-editor-mode-source]").exists()).toBe(false);
  });

  it("exposes save and dirty state transitions", async () => {
    const wrapper = mount(EditorPane, {
      global: { plugins: [createPinia()] },
      props: { path: "/repo/src/main.ts" },
    });
    await flush();
    wrapper.vm.setContentForTest("const value = 2;");
    await nextTick();
    await wrapper.vm.save();
    expect(wrapper.emitted("dirtyChange")).toEqual([[false], [true], [false]]);
    expect(writeEditorDocument).toHaveBeenCalledWith("/repo/src/main.ts", "const value = 2;");
  });

  it("offers source, split and preview modes for markdown files", async () => {
    vi.mocked(readEditorDocument).mockResolvedValueOnce({
      status: "ready",
      content: "# Draft\n\nUse `pnpm test`.",
      size: 26,
    });
    const wrapper = mount(EditorPane, {
      global: { plugins: [createPinia()] },
      props: { path: "/repo/README.md" },
    });
    await flush();
    expect(wrapper.find("[data-editor-mode-root]").attributes("data-mode")).toBe("split");
    expect(wrapper.find("[data-editor-mode-source]").exists()).toBe(true);
    expect(wrapper.find("[data-editor-mode-split]").exists()).toBe(true);
    expect(wrapper.find("[data-editor-mode-preview]").exists()).toBe(true);
    expect(wrapper.find("[data-editor-markdown-preview]").text()).toContain("Draft");
    wrapper.vm.setContentForTest("# Updated\n\nLive preview");
    await nextTick();
    expect(wrapper.find("[data-editor-markdown-preview]").text()).toContain("Updated");
    await wrapper.find("[data-editor-mode-preview]").trigger("click");
    await nextTick();
    expect(wrapper.find("[data-editor-mode-root]").attributes("data-mode")).toBe("preview");
  });

  it("renders non-text states without mounting an editor", async () => {
    vi.mocked(readEditorDocument).mockResolvedValueOnce({
      status: "binary",
      size: 2048,
    });
    const wrapper = mount(EditorPane, {
      global: { plugins: [createPinia()] },
      props: { path: "/repo/image.png" },
    });
    await flush();
    expect(wrapper.text()).toContain("Binary file");
    expect(wrapper.text()).toContain("2.0 KB");
    expect(wrapper.find("[data-editor-host]").exists()).toBe(false);
  });

  it("confirms before saving over an external disk change", async () => {
    vi.mocked(readEditorDocument).mockResolvedValueOnce({
      status: "ready",
      content: "const value = 1;",
      size: 16,
    });
    dialogWarningMock.mockImplementation((options) => {
      void options.onPositiveClick();
    });
    const wrapper = mount(EditorPane, {
      global: { plugins: [createPinia()] },
      props: { path: "/repo/src/main.ts", fsEvent: null },
    });
    await flush();
    wrapper.vm.setContentForTest("const local = true;");
    await nextTick();
    await wrapper.setProps({
      fsEvent: { rootPath: "/repo", paths: ["/repo/src/main.ts"], gitRelated: false },
    });
    await flush();
    await wrapper.vm.save();
    await flush();
    expect(dialogWarningMock).toHaveBeenCalledWith(
      expect.objectContaining({ title: "Overwrite disk changes?", positiveText: "Save" }),
    );
    expect(writeEditorDocument).toHaveBeenCalledWith("/repo/src/main.ts", "const local = true;");
  });
});
```

- [ ] **Step 4: 跑测试，逐项修复**

```bash
pnpm test src/modules/editor/EditorPane.vue.test.ts
```

预期：所有 `it` 通过。如果某些依赖（比如 `NTag` 等）没有注册导致 mount 失败，逐项修正（多数情况下继续即可）。

- [ ] **Step 5: 跑全量测试与构建**

```bash
pnpm test
pnpm build
```

预期：`pnpm test` 全绿；`pnpm build` 类型检查与构建通过，**但 `DiffCodeMirror.vue` 仍依赖 `@codemirror/merge`，构建会因 Diff 失败**——下个任务解决。

- [ ] **Step 6: 提交**

```bash
git add src/modules/editor/EditorPane.vue \
        src/modules/editor/EditorPane.vue.test.ts \
        src/modules/editor/lib/editorRuntime.ts
git commit -m "refactor(editor): EditorPane 从 CodeMirror 迁移到 Monaco 编辑器"
```

---

## Task 4: Diff 视图（DiffCodeMirror → DiffEditor）

**Files:**
- Create: `src/modules/editor/DiffEditor.vue`
- Modify: `src/modules/editor/GitDiffPane.vue`（引用切换）
- Modify: `src/modules/editor/GitDiffPane.vue.test.ts`（如果有引用 cm 类名）
- Modify: `src/modules/editor/diffStacks.vue.test.ts`（如果有引用 cm 类名）
- Modify: `src/modules/editor/diffRuntimeBoundary.test.ts`
- Delete: `src/modules/editor/DiffCodeMirror.vue`

**Interfaces:**
- Consumes: `props: { path, originalContent, modifiedContent, testId }`；`prefs.editorTheme`（与 Section 1 一致）
- Produces: `<div data-testid="props.testId">` 容器；通过 monaco diff editor 渲染

- [ ] **Step 1: 写 DiffEditor.vue**

新建 `src/modules/editor/DiffEditor.vue`：

```vue
<script setup lang="ts">
import * as monaco from "monaco-editor";
import { nextTick, onBeforeUnmount, ref, shallowRef, watch } from "vue";
import { usePreferencesPiniaStore } from "@/modules/settings/preferencesPinia";
import { buildMonacoDiffOptions } from "./lib/editorConfig";
import { resolveMonacoLanguageId } from "./lib/languageMap";
import { registerMonacoThemes } from "./lib/themes";

registerMonacoThemes();

const props = defineProps<{
  path: string;
  originalContent: string;
  modifiedContent: string;
  testId: string;
}>();

const prefs = usePreferencesPiniaStore();
const host = ref<HTMLDivElement | null>(null);
const editor = shallowRef<monaco.editor.IStandaloneDiffEditor | null>(null);
const models = shallowRef<{
  original: monaco.editor.ITextModel;
  modified: monaco.editor.ITextModel;
} | null>(null);

async function mountDiff() {
  await nextTick();
  if (!host.value) return;
  if (editor.value) {
    editor.value.dispose();
    editor.value = null;
  }
  if (models.value) {
    models.value.original.dispose();
    models.value.modified.dispose();
    models.value = null;
  }
  host.value.innerHTML = "";
  const lang = resolveMonacoLanguageId(props.path) ?? "plaintext";
  const original = monaco.editor.createModel(props.originalContent, lang);
  const modified = monaco.editor.createModel(props.modifiedContent, lang);
  const fresh = monaco.editor.createDiffEditor(host.value, {
    ...buildMonacoDiffOptions(prefs),
  });
  fresh.setModel({ original, modified });
  editor.value = fresh;
  models.value = { original, modified };
}

watch(
  () => [
    props.path,
    props.originalContent,
    props.modifiedContent,
    prefs.editorTheme,
    prefs.editorFontSize,
  ],
  () => void mountDiff(),
  { immediate: true },
);

onBeforeUnmount(() => {
  editor.value?.dispose();
  editor.value = null;
  if (models.value) {
    models.value.original.dispose();
    models.value.modified.dispose();
    models.value = null;
  }
});
</script>

<template>
  <div :data-testid="props.testId" class="h-full min-h-0 w-full overflow-hidden">
    <div
      ref="host"
      :data-git-diff-host="props.testId === 'git-diff-host' ? '' : undefined"
      class="nexterm-editor-scrollbar h-full min-h-0"
    />
  </div>
</template>
```

- [ ] **Step 2: 更新 GitDiffPane.vue 引用 DiffCodeMirror → DiffEditor**

在 `src/modules/editor/GitDiffPane.vue` 中把：

```ts
import DiffCodeMirror from "./DiffCodeMirror.vue";
```

改为：

```ts
import DiffEditor from "./DiffEditor.vue";
```

并把 template 中的 `<DiffCodeMirror ... />` 改为：

```vue
<DiffEditor test-id="git-diff-host" :path="props.source.path" :original-content="loaded.originalContent" :modified-content="loaded.modifiedContent" />
```

- [ ] **Step 3: 检查 GitDiffPane.vue.test.ts / diffStacks.vue.test.ts / diffRuntimeBoundary.test.ts**

```bash
cd /home/xinggao/dev/rust/nexterm
grep -n "DiffCodeMirror\|cm-merge\|.cm-" src/modules/editor/*.test.ts
```

如果有 `.cm-*` 选择器或对 `DiffCodeMirror.vue` 文件存在性的断言，按同样模式改为 Monaco / DiffEditor 等价。

- [ ] **Step 4: 删除 DiffCodeMirror.vue**

```bash
git rm src/modules/editor/DiffCodeMirror.vue
```

- [ ] **Step 5: 跑全量测试与构建**

```bash
pnpm test
pnpm build
```

预期：所有测试通过；构建通过（diff 模块的 CodeMirror 引用已清除）。

- [ ] **Step 6: 提交**

```bash
git add src/modules/editor/DiffEditor.vue \
        src/modules/editor/GitDiffPane.vue \
        src/modules/editor/GitDiffPane.vue.test.ts \
        src/modules/editor/diffStacks.vue.test.ts \
        src/modules/editor/diffRuntimeBoundary.test.ts
git commit -m "refactor(editor): Git Diff 从 CodeMirror merge 迁移到 Monaco diff editor"
git status
```

如果 `git status` 显示 `src/modules/editor/DiffCodeMirror.vue` 仍残留，说明 Step 4 未生效，跳过该 `git rm`，直接转下个任务即可。

---

## Task 5: Vim 集成 + EditorPaneHandle + 清理 + 边界守卫

**Files:**
- Modify: `src/modules/editor/lib/vim.ts`（用 monaco-vim 重写）
- Create: `src/modules/editor/lib/vim.test.ts`
- Modify: `src/modules/editor/editorTypes.ts`（EditorPaneHandle 简化）
- Delete: `src/modules/editor/lib/extensions.ts`（不再需要）
- Delete: `src/modules/editor/lib/languageResolver.ts`（替换为 languageMap.ts）
- Modify: `src/modules/editor/index.ts`（导出不变）
- Modify: `src/modules/editor/editorVueBoundary.test.ts`（加 Monaco 守卫）
- Modify: `src/modules/editor/EditorPane.vue`（接入新的 vim.ts）

**Interfaces:**
- `vim.ts` → `attachVim(editor: IStandaloneCodeEditor, handlers: { save(): void; close(): void }): IDisposable`
- `vim.ts` → `setVimEnabled(editor, enabled, handlers)`：开关切换
- `editorTypes.ts` → `EditorPaneHandle`：`focus / getSelection / getPath / save / openGotoLine / reload / undo / redo`

- [ ] **Step 1: 写 vim.test.ts 失败用例**

新建 `src/modules/editor/lib/vim.test.ts`：

```ts
import { describe, expect, it, vi } from "vitest";

vi.mock("monaco-vim", () => {
  const listeners: Record<string, (cb: any) => void)[] = [];
  return {
    Vim: {
      defineEx: vi.fn(),
      map: vi.fn(),
    },
    initVimMode: vi.fn((editor: any) => {
      const obj = {
        dispose: vi.fn(),
      };
      listeners.push(obj as any);
      return obj;
    }),
    __listeners: listeners,
  };
});

import * as monacoVim from "monaco-vim";
import { attachVim } from "./vim";

describe("vim.ts (monaco-vim)", () => {
  it("attaches vim and exposes dispose", () => {
    const editor: any = {};
    const handlers = { save: vi.fn(), close: vi.fn() };
    const disposable = attachVim(editor, handlers);
    expect(monacoVim.initVimMode).toHaveBeenCalledWith(editor, expect.anything());
    expect(monacoVim.Vim.defineEx).toHaveBeenCalledWith("write", "w", expect.any(Function));
    expect(monacoVim.Vim.defineEx).toHaveBeenCalledWith("quit", "q", expect.any(Function));
    expect(typeof disposable.dispose).toBe("function");
  });

  it("still passes type-check when no editor is attached", () => {
    expect(typeof attachVim).toBe("function");
  });
});
```

- [ ] **Step 2: 跑测试确认失败**

```bash
pnpm test src/modules/editor/lib/vim.test.ts
```

预期：FAIL 显示 `Cannot find module './vim'` 或编译错误。

- [ ] **Step 3: 重写 lib/vim.ts**

整文件替换 `src/modules/editor/lib/vim.ts`：

```ts
import * as monaco from "monaco-editor";
import { initVimMode, Vim } from "monaco-vim";

export type VimHandlers = { save: () => void; close: () => void };

const handlersByEditor = new WeakMap<monaco.editor.IStandaloneCodeEditor, VimHandlers>();
let initialized = false;

function ensureInit() {
  if (initialized) return;
  initialized = true;

  Vim.defineEx("write", "w", (cm: { cm6?: monaco.editor.IStandaloneCodeEditor }) => {
    if (cm.cm6) handlersByEditor.get(cm.cm6)?.save();
  });
  Vim.defineEx("quit", "q", (cm: { cm6?: monaco.editor.IStandaloneCodeEditor }) => {
    if (cm.cm6) handlersByEditor.get(cm.cm6)?.close();
  });
  Vim.defineEx("wq", "wq", (cm: { cm6?: monaco.editor.IStandaloneCodeEditor }) => {
    if (cm.cm6) {
      const h = handlersByEditor.get(cm.cm6);
      h?.save();
      h?.close();
    }
  });
  Vim.defineEx("xit", "x", (cm: { cm6?: monaco.editor.IStandaloneCodeEditor }) => {
    if (cm.cm6) {
      const h = handlersByEditor.get(cm.cm6);
      h?.save();
      h?.close();
    }
  });

  Vim.map("<Up>", "k", "normal");
  Vim.map("<Down>", "j", "normal");
  Vim.map("<Left>", "h", "normal");
  Vim.map("<Right>", "l", "normal");
  Vim.map("<Up>", "k", "visual");
  Vim.map("<Down>", "j", "visual");
  Vim.map("<Left>", "h", "visual");
  Vim.map("<Right>", "l", "visual");
}

export type VimAttachment = {
  dispose(): void;
};

export function attachVim(
  editor: monaco.editor.IStandaloneCodeEditor,
  handlers: VimHandlers,
): VimAttachment {
  ensureInit();
  handlersByEditor.set(editor, handlers);

  const statusNode = document.createElement("div");
  statusNode.style.position = "absolute";
  statusNode.style.bottom = "4px";
  statusNode.style.right = "8px";
  statusNode.style.fontSize = "10px";
  statusNode.style.color = "var(--muted-foreground)";
  statusNode.style.pointerEvents = "none";
  document.body.appendChild(statusNode);

  const vim = initVimMode(editor, statusNode);

  return {
    dispose() {
      vim.dispose();
      statusNode.remove();
      handlersByEditor.delete(editor);
    },
  };
}
```

- [ ] **Step 4: 跑测试**

```bash
pnpm test src/modules/editor/lib/vim.test.ts
```

预期：两个 `it` 通过。

- [ ] **Step 5: 在 EditorPane.vue 接入 vim.ts**

修改 `src/modules/editor/EditorPane.vue` 的 `<script setup>`：

```ts
// 在 import 区追加
import { attachVim, type VimAttachment } from "./lib/vim";

// 在 const 区追加
const vimAttachment = shallowRef<VimAttachment | null>(null);

// watch 中：prefs.vimMode 切换时挂载/卸载
watch(
  () => prefs.vimMode,
  (enabled) => {
    vimAttachment.value?.dispose();
    vimAttachment.value = null;
    if (enabled && mount.value) {
      vimAttachment.value = attachVim(mount.value.editor, {
        save: () => void save(),
        close: () => {
          emit("dirtyChange", false);
        },
      });
    }
  },
  { immediate: true },
);

// onBeforeUnmount 末尾：清理 vim
//   已有 disposeEditor; 在其前加 vimAttachment.value?.dispose();
```

- [ ] **Step 6: 调整 editorTypes.ts**

整文件替换 `src/modules/editor/editorTypes.ts`：

```ts
export type EditorViewMode = "source" | "split" | "preview";

export type EditorPaneHandle = {
  focus: () => void;
  getSelection: () => string | null;
  getPath: () => string;
  save: () => Promise<void>;
  openGotoLine: () => void;
  reload: () => Promise<void>;
  undo: () => void;
  redo: () => void;
};

export interface EditorPaneComponent {
  save: EditorPaneHandle["save"];
  focus: EditorPaneHandle["focus"];
  getSelection: EditorPaneHandle["getSelection"];
  openGotoLine: EditorPaneHandle["openGotoLine"];
  reload: EditorPaneHandle["reload"];
  undo: EditorPaneHandle["undo"];
  redo: EditorPaneHandle["redo"];
}
```

- [ ] **Step 7: 删除过期 lib 文件**

```bash
git rm src/modules/editor/lib/extensions.ts \
       src/modules/editor/lib/languageResolver.ts \
       src/modules/editor/lib/languageResolver.test.ts
```

- [ ] **Step 8: 加 Monaco 边界守卫**

修改 `src/modules/editor/editorVueBoundary.test.ts`，在原有用例之后追加：

```ts
import { readdirSync } from "node:fs";

describe("monaco boundary guard", () => {
  it("does not keep CodeMirror imports in src/modules/editor/", () => {
    const root = new URL("./lib/", import.meta.url);
    const files = readdirSync(root);
    const offenders = files.filter((f) => f.includes("languageResolver") || f.includes("extensions.ts"));
    expect(offenders).toEqual([]);
  });

  it("registers all languages through languageMap, not ad-hoc loaders", () => {
    const map = await import("./lib/languageMap");
    expect(map.resolveMonacoLanguageId("a.ts")).toBe("typescript");
    expect(map.resolveMonacoLanguageId("a.rs")).toBe("rust");
  });
});
```

（如果发现 `extensions.ts` 还在另一处被引用，先 import 残留并按报错修复，再继续。）

- [ ] **Step 9: 全量验证**

```bash
pnpm test
pnpm build
cd src-tauri && cargo check --all-targets --locked && cd ..
```

预期：
- `pnpm test` 全绿
- `pnpm build` 通过
- `cargo check` 不报错（仅 JS 改动不影响 Rust，但确保依赖对齐）

- [ ] **Step 10: 提交**

```bash
git add -A
git commit -m "refactor(editor): 完成 Monaco Vim 集成、清理 CodeMirror 残留、加边界守卫"
```

---

## Spec Coverage Check

对照 `docs/superpowers/specs/2026-07-16-monaco-lsp-migration-design.md` 的 Section 1 章节：

| Spec 项 | 对应任务 |
| --- | --- |
| 3.1 新增依赖 | Task 1 |
| 3.2 移除依赖 | Task 1 |
| 3.3 目录调整 | Task 1 / Task 4 / Task 5 |
| 3.4 Monaco 实例生命周期 | Task 3 |
| 3.5 EditorPaneHandle 简化 | Task 5 |
| 3.6 Diff 视图 | Task 4 |
| 3.7 主题系统 | Task 2 |
| 3.8 Vim 集成 | Task 5 |
| 3.9 Markdown split/preview | Task 3 |
| 3.10 vite.config.ts 调整 | Task 1 |
| 3.11 Section 1 完成标志 | Task 5 |

逐项覆盖。Section 2/3 留待后续 plan。
