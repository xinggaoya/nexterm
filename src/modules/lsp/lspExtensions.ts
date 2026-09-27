import {
  autocompletion,
  type CompletionSource,
} from "@codemirror/autocomplete";
import type { Extension } from "@codemirror/state";
import { hoverTooltip, type EditorView, type Tooltip } from "@codemirror/view";
import { getLspClient } from "./manager";
import { fileUriToPath, type LspDocumentSymbol } from "./types";
import {
  offsetToLspPosition,
  resolveDefinitionLocations,
  toCmCompletionResult,
  toHoverText,
  toPendingEdits,
  toReferenceGroups,
  type PendingEdit,
  type ReferenceGroup,
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

/**
 * F2 重命名的结果：server 给出的 WorkspaceEdit 已摊平成待改列表。
 *
 * 为什么不直接落盘：跨文件重命名会同时改多个文件，server 也可能给出我们
 * 接不住的改动。摊平成"哪些文件、哪些位置、改成什么"之后，UI 才能先给用户
 * 看一眼再落。
 */
export async function resolveRenameAt(
  view: EditorView,
  pos: number,
  newName: string,
): Promise<PendingEdit[] | null> {
  const client = getLspClient(view);
  if (!client) return null;
  const position = offsetToLspPosition(view.state.doc, pos);
  const edit = await client.requestRename(position, newName);
  const edits = toPendingEdits(edit, fileUriToPath);
  return edits.length > 0 ? edits : null;
}

/** 查找引用。`includeDeclaration` 为真时结果含定义本身那一处。 */
export async function resolveReferencesAt(
  view: EditorView,
  pos: number,
  includeDeclaration = false,
): Promise<ReferenceGroup[] | null> {
  const client = getLspClient(view);
  if (!client) return null;
  const position = offsetToLspPosition(view.state.doc, pos);
  const locations = await client.requestReferences(position, includeDeclaration);
  const groups = toReferenceGroups(locations, fileUriToPath);
  return groups.length > 0 ? groups : null;
}

/** 文档符号（面包屑 / 大纲的数据源）。 */
export async function resolveDocumentSymbols(
  view: EditorView,
): Promise<LspDocumentSymbol[] | null> {
  const client = getLspClient(view);
  if (!client) return null;
  return client.requestDocumentSymbols();
}
