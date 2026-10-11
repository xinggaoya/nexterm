import tailwindcss from "@tailwindcss/vite";
import vue from "@vitejs/plugin-vue";
import { readFileSync } from "node:fs";
import { availableParallelism } from "node:os";
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
      imports: ["vue", "pinia"],
      vueTemplate: true,
      // 测试时不写 .d.ts：否则跑一次 `pnpm test` 就会改动
      // src/auto-imports.d.ts（行尾翻转），开发者的工作区永远不干净，
      // 且并发 worker 写同一个文件有撕裂风险。
      dts: isVitest ? false : "src/auto-imports.d.ts",
    }),
    Components({
      resolvers: [NaiveUiResolver()],
      dts: isVitest ? false : "src/components.d.ts",
    }),
    // Tailwind 的扫描 / transform 在测试里没有产出，只付 transform 成本。
    ...(isVitest ? [] : [tailwindcss()]),
  ],
  resolve: {
    alias: [{ find: "@", replacement: path.resolve(__dirname, "./src") }],
  },
  test: {
    setupFiles: ["./tests/vitest.setup.ts"],

    // worker 用 threads 而不是默认的 forks：CI runner 通常只有 2~4 核但
    // fork 进程开销是固定成本（~300ms/个），threads 共享进程、模块图只解析
    // 一次。maxThreads 跟着 `availableParallelism` 走，在小 runner 上不会
    // 过订阅 —— 真正的瓶颈是 CPU 抢占，不是并行度。
    pool: "threads",
    poolOptions: {
      threads: {
        maxThreads: Math.min(8, availableParallelism?.() ?? 4),
        minThreads: 2,
      },
    },
    // 必须保持 true：preferencesSnapshot / notificationCenter 等模块级单例
    // 会跨用例串味（preferencesSnapshot.test.ts 已经暴露了这个形状）。
    isolate: true,

    // 默认 5000ms 在 CI 上不够：SourceControlPanel / FilePickerDialog 这类
    // 组件测试要等一次 jsdom 布局 + 虚拟列表测量，机器一忙就超 5s。
    // 这些用例本身并不慢，只是等得久 —— 放宽超时比在测试里塞固定 sleep 诚实。
    testTimeout: 15_000,
    hookTimeout: 15_000,

    // 显式化：目前靠 default 行为，升级 vitest 时容易被静默改掉。
    css: false,
    globals: false,
    clearMocks: false,
    mockReset: false,
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
