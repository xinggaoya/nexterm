import tailwindcss from "@tailwindcss/vite";
import vue from "@vitejs/plugin-vue";
import { readFileSync } from "node:fs";
import path from "path";
import AutoImport from "unplugin-auto-import/vite";
import Components from "unplugin-vue-components/vite";
import { NaiveUiResolver } from "unplugin-vue-components/resolvers";
import { defineConfig } from "vite";

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
    tailwindcss(),
  ],
  resolve: {
    alias: [{ find: "@", replacement: path.resolve(__dirname, "./src") }],
  },
  test: {
    setupFiles: ["./tests/vitest.setup.ts"],
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
            id.includes("/@codemirror/") ||
            id.includes("/@lezer/") ||
            id.includes("/@uiw/") ||
            id.includes("/@replit/")
          ) {
            // 语言包(lang-* / legacy-modes / 各 lezer parser)跟随
            // languageResolver 的动态 import 独立分包,只有打开对应文件时
            // 才加载;核心运行时合并为一个 codemirror chunk。
            if (/[@/](codemirror)\/(lang-|legacy-modes)/.test(id)) return;
            if (
              /\/@lezer\/(javascript|html|css|json|python|java|cpp|rust|php|markdown|yaml|xml|sql|go|dist)\//.test(
                id,
              )
            )
              return;
            return "codemirror";
          }
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
