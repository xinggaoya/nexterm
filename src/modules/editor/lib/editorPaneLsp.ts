import type * as monaco from "monaco-editor";

import {
  attachLspToEditor,
  detachLspFromEditor,
} from "@/modules/lsp/manager";

let workerEnvSet = false;

export function setupMonacoWorkerEnvironment(): void {
  if (workerEnvSet) return;
  workerEnvSet = true;
  // monaco-editor v0.52 由 vite-plugin-monaco-editor 在构建阶段自动注入 worker 入口；
  // 本函数作为未来切到自定义 worker 路径的 hook，目前留空实现。
}

export async function attachOrDetachLsp(
  editor: monaco.editor.IStandaloneCodeEditor,
  path: string,
  mode: "builtin" | "lsp",
): Promise<void> {
  await detachLspFromEditor(editor);
  if (mode !== "lsp") return;
  await attachLspToEditor(editor, path);
}
