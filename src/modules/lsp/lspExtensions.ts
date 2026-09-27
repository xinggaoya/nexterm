import {
  autocompletion,
  type CompletionSource,
} from "@codemirror/autocomplete";
import type { Extension } from "@codemirror/state";
import { hoverTooltip, type EditorView, type Tooltip } from "@codemirror/view";
import { getLspClient } from "./manager";
import { fileUriToPath } from "./types";
import {
  offsetToLspPosition,
  resolveDefinitionLocations,
  toCmCompletionResult,
  toHoverText,
  type ResolvedDefinition,
} from "./lspLanguageSupport";

/**
 * 把 LSP 的补全 / 悬浮 / 跳转接到 CodeMirror。
 *
 * 三者都只在 **LSP 模式**下生效：`getLspClient` 没有对应 editor 时扩展
 * 自然退化为空操作，builtin 模式（TypeScript 自带词法高亮）下不会误触发。
 */

/** 补全源：CodeMirror 判定该弹补全面板时同步发起一次请求。 */
const lspCompletionSource: CompletionSource = (context) => {
  const view = context.view as EditorView;
  const client = getLspClient(view);
  if (!client) return null;
  const word = context.matchBefore(/[\w$]+/);
  // 与 `activateOnTyping` 的默认行为对齐：显式触发，或正在输入标识符。
  if (!context.explicit && !word) return null;
  const cursor = context.pos;
  const position = offsetToLspPosition(view.state.doc, cursor);
  return client
    .requestCompletion(position)
    .then((list) => toCmCompletionResult(view.state.doc, list, cursor))
    // 补全面板宁可不弹，也不要弹一个空面板：抛错会让 CodeMirror 记下
    // "source 出错" 并在后续输入里静默跳过它。
    .catch(() => null);
};

export function lspCompletionExtension(): Extension {
  return autocompletion({ override: [lspCompletionSource] });
}

/** 悬浮：把 LSP 的 markdown 降级成纯文本气泡。 */
export function lspHoverExtension(): Extension {
  return hoverTooltip(async (view, pos) => {
    const client = getLspClient(view);
    if (!client) return null;
    const position = offsetToLspPosition(view.state.doc, pos);
    const hover = await client.requestHover(position);
    const text = toHoverText(hover);
    if (!text) return null;
    return {
      pos,
      above: true,
      create: () => {
        const dom = document.createElement("div");
        dom.className = "nexterm-lsp-hover";
        dom.textContent = text;
        return { dom };
      },
    } satisfies Tooltip;
  });
}

/**
 * F12 / Ctrl+Click 的动作：请求定义并把结果回传给宿主。
 *
 * 为什么不在这里直接开文件：编辑器组件不知道工作区怎么开标签（那是
 * WorkspaceHost 的职责），只能把结果上抛。保持编辑器不持有工作区状态
 * 是本仓的模块边界要求。
 */
export async function resolveDefinitionAt(
  view: EditorView,
  pos: number,
): Promise<ResolvedDefinition | null> {
  const client = getLspClient(view);
  if (!client) return null;
  const position = offsetToLspPosition(view.state.doc, pos);
  const result = await client.requestDefinition(position);
  return resolveDefinitionLocations(
    result as Parameters<typeof resolveDefinitionLocations>[0],
    fileUriToPath,
  );
}
