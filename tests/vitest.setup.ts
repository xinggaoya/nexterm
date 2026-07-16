import { vi } from "vitest";

// vite.config.ts 的 alias 已将 monaco-editor / monaco-vim / monaco-themes 替换为
// 本地 stub，这些 vi.mock 仅用于子路径 monaco-themes/themes/*.json 的导入（alias
// 不会拦截子路径）。返回值必须带 default 字段以匹配源码 `import X from "..."`。

vi.mock("monaco-themes/themes/GitHub Dark.json", () => ({ default: {} }));
vi.mock("monaco-themes/themes/GitHub Light.json", () => ({ default: {} }));
vi.mock("monaco-themes/themes/Xcode_Dark.json", () => ({ default: {} }));
vi.mock("monaco-themes/themes/Xcode_default.json", () => ({ default: {} }));
