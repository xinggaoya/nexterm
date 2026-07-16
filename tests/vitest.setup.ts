import { vi } from "vitest";

// vite.config.ts 的 alias 已在测试模式下将 monaco-editor / monaco-vim / monaco-themes
// 替换为本地 stub。这里不再额外 vi.mock，避免重复拦截。
