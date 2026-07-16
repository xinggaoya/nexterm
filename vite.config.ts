import tailwindcss from "@tailwindcss/vite";
import vue from "@vitejs/plugin-vue";
import { readFileSync } from "node:fs";
import path from "path";
import AutoImport from "unplugin-auto-import/vite";
import Components from "unplugin-vue-components/vite";
import { NaiveUiResolver } from "unplugin-vue-components/resolvers";
import monacoEditorPluginRaw from "vite-plugin-monaco-editor";
import { defineConfig } from "vite";

const monacoEditorPlugin =
  (monacoEditorPluginRaw as unknown as { default?: typeof monacoEditorPluginRaw }).default ??
  monacoEditorPluginRaw;

const host = process.env.TAURI_DEV_HOST;
const packageJson = JSON.parse(
  readFileSync(new URL("./package.json", import.meta.url), "utf8"),
) as { version: string };

// vitest 启动时 process.env.VITEST === 'true'，dev/build 时为 undefined。
const isVitest = !!process.env.VITEST;

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
    // monaco-editor 的 worker 入口在其 package.json 中仅声明 module 字段，
    // vitest 通过 Vite 解析器需要 main 字段；测试环境下跳过 worker 自动注入，
    // 因为测试套件会对 monaco-editor 进行 vi.mock，不会真正调用 create。
    ...(mode !== "test" && !isVitest
      ? [
          monacoEditorPlugin({
            languageWorkers: [
              "editorWorkerService",
              "typescript",
              "json",
              "html",
              "css",
            ],
          }),
        ]
      : []),
    tailwindcss(),
  ],
  resolve: {
    alias: isVitest
      ? [
          { find: "@", replacement: path.resolve(__dirname, "./src") },
          {
            find: /^monaco-editor$/,
            replacement: path.resolve(__dirname, "./tests/monaco-editor-stub.ts"),
          },
          {
            find: /^monaco-vim$/,
            replacement: path.resolve(__dirname, "./tests/monaco-vim-stub.ts"),
          },
          {
            find: /^monaco-themes\/(.+)$/,
            replacement: path.resolve(__dirname, "./tests/monaco-theme-empty.ts"),
          },
          {
            find: /^monaco-themes$/,
            replacement: path.resolve(__dirname, "./tests/monaco-themes-stub.ts"),
          },
        ]
      : {
          "@": path.resolve(__dirname, "./src"),
        },
  },
  optimizeDeps: {
    exclude: ["monaco-editor", "monaco-vim", "monaco-themes"],
  },
  ssr: {
    external: ["monaco-editor", "monaco-vim", "monaco-themes"],
  },
  test: {
    setupFiles: ["./tests/vitest.setup.ts"],
    deps: {
      optimizer: {
        web: {
          include: [],
          exclude: ["monaco-editor", "monaco-vim", "monaco-themes"],
        },
        ssr: {
          include: [],
          exclude: ["monaco-editor", "monaco-vim", "monaco-themes"],
        },
      },
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
            id.includes("/monaco-editor/") ||
            id.includes("/monaco-vim/") ||
            id.includes("/monaco-themes/")
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
