<script setup lang="ts">
import type { PendingEdit, ReferenceGroup } from "@/modules/lsp/lspLanguageSupport";
import { computed, defineAsyncComponent } from "vue";
import { native } from "@/lib/native";
import { getPtyIdForLeaf, TerminalWorkspace, disposeSession } from "@/modules/terminal";
import type { PaneStatus } from "@/modules/terminal";
import { tryWorkspaceContext } from "@/app/workspaceContext";
const EditorPane = defineAsyncComponent(() => import("@/modules/editor/EditorPane.vue"));
import GitDiffStack from "@/modules/editor/GitDiffStack.vue";
import GitHistoryStack from "@/modules/git-history/GitHistoryStack.vue";
import MarkdownStack from "@/modules/markdown/MarkdownStack.vue";
import PreviewStack from "@/modules/preview/PreviewStack.vue";
import FilePreviewStack from "@/modules/file-preview/FilePreviewStack.vue";
import type { EditorTab, Tab, TerminalTab } from "@/modules/tabs/tabsTypes";

type TabsStoreBinding = {
  focusPane: (tabId: number, leafId: number) => void;
  openCommitFileDiffTab: (input: {
    repoRoot: string;
    sha: string;
    shortSha: string;
    subject: string;
    path: string;
    originalPath: string | null;
  }) => void;
  setLeafCwd: (leafId: number, cwd: string) => void;
  setLeafTitle: (leafId: number, title: string) => void;
  updateTab: (id: number, patch: { url?: string; dirty?: boolean }) => void;
};

const props = defineProps<{
  activeId: number;
  activeTab: Tab | null;
  tabs: Tab[];
  tabsStore: TabsStoreBinding;
  workspaceFsEvent: import("@/lib/native").WorkspaceFsChangedEvent | null;
}>();

export type GoToDefinitionTarget = {
  path: string;
  /** 0-based（LSP 语义）。 */
  line: number;
  character: number;
};

const emit = defineEmits<{
  "history-ref-change": [
    input: { tabId: number; refName: string | null; allRefs: boolean },
  ];
  /**
   * LSP 跳转定义。编辑器不持有工作区状态也不知道怎么开标签，逐层上抛给
   * WorkspaceHost 统一编排（开 tab + 跳行）。
   */
  "go-to-definition": [target: GoToDefinitionTarget | null];
  /** LSP 重命名的待改列表（上抛给宿主确认后落盘）。 */
  "request-rename": [edits: PendingEdit[]];
  /** 查找引用结果。 */
  "show-references": [groups: ReferenceGroup[]];
  /** 分屏标题栏发来的“重命名这条分屏”。 */
  "rename-pane": [leafId: number];
  /**
   * 活动分屏的终端状态摘要（尺寸 / 渲染器 / 会话状态）。
   *
   * 状态坞需要这些才能填满右半边 —— 此前那里整片空着。尺寸尤其重要：
   * `cols×rows` 直接决定 TUI 工具的布局，用户得能一眼看到。
   */
  "pane-status": [status: PaneStatus | null];
}>();

export type { PaneStatus } from "@/modules/terminal";

/** EditorPane 通过 defineExpose 暴露给外部调用的方法子集。 */
type EditorPaneExpose = InstanceType<typeof EditorPane>;

/**
 * 每个编辑器 tab 一个常驻实例。
 *
 * 原来只有单个实例 + `:path` 驱动重建，带来三件事：
 * 切标签丢撤销栈/折叠/滚动位置、每切一次闪 loading，以及最严重的 —
 * 旧 EditorView 被 GC 后 LSP client 永不 dispose，`lsp_stop` 不触发，
 * Rust 侧的语言服务器子进程一直活着（切 20 次 = 20 个 rust-analyzer）。
 * 见模板里 editorTabs 那段注释。
 */
const editorPaneRefs = new Map<number, EditorPaneExpose>();

function setEditorPaneRef(id: number, pane: EditorPaneExpose | null) {
  if (pane) editorPaneRefs.set(id, pane);
  else editorPaneRefs.delete(id);
}

/** 当前活动编辑器实例（非活动 tab 的实例不响应命令）。 */
const activeEditorPane = computed<EditorPaneExpose | null>(() =>
  props.activeTab ? editorPaneRefs.get(props.activeTab.id) ?? null : null,
);

function isActiveKind(kind: Tab["kind"]): boolean {
  return props.activeTab?.kind === kind;
}

function isActiveGitDiff(): boolean {
  return (
    props.activeTab?.kind === "git-diff" ||
    props.activeTab?.kind === "git-commit-file"
  );
}

function handleHistoryRefChange(input: {
  tabId: number;
  refName: string | null;
  allRefs: boolean;
}) {
  emit("history-ref-change", input);
}

async function saveActiveEditor() {
  await activeEditorPane.value?.save();
}

function openGotoLine() {
  activeEditorPane.value?.openGotoLine();
}

async function killTerminal(leafId: number) {
  const wsId = tryWorkspaceContext()?.workspace.id ?? "";
  const ptyId = getPtyIdForLeaf(wsId, leafId);
  if (ptyId === null) {
    disposeSession(wsId, leafId.toString());
    return;
  }
  try {
    await native.ptyKill(ptyId);
  } catch (error) {
    console.warn("killTerminal failed", error);
  }
}

const terminalTabs = computed<TerminalTab[]>(() =>
  props.tabs.filter((tab): tab is TerminalTab => tab.kind === "terminal"),
);

/**
 * 常驻挂载的编辑器列表。
 *
 * 之前这里只有一个 `EditorPane` 实例，靠 `:path` 变化驱动重建：
 * `destroyEditor()` → 新 `EditorView`。代价有三：
 * 1. 切标签会丢撤销栈、折叠状态、滚动位置；
 * 2. 每个标签都闪一下 loading；
 * 3. **最严重**：旧 `EditorView` 被 GC 后，`clients` 这个 WeakMap 里的
 *    client.dispose() 永不执行 → `onDispose → lsp_stop` 永不触发 →
 *    Rust 侧的 LSP 子进程一直活着。切 20 次标签 = 20 个 rust-analyzer
 *    常驻并各自做全量索引。
 *
 * 与终端层一样用 `v-for` + `v-show`：实例常驻，切换只是显隐。
 */
const editorTabs = computed<EditorTab[]>(() =>
  props.tabs.filter((tab): tab is EditorTab => tab.kind === "editor"),
);

/** Find in Files 跳转:仅当活动 tab 正是该文件且编辑器已挂载时生效。 */
function revealEditorLine(path: string, line: number): boolean {
  if (!props.activeTab || props.activeTab.kind !== "editor") return false;
  if (props.activeTab.path !== path) return false;
  if (!activeEditorPane.value) return false;
  activeEditorPane.value.revealLine(line);
  return true;
}

/** F12：把命令系统的调用转给活动编辑器（无编辑器时静默）。 */
async function goToDefinition(): Promise<void> {
  await activeEditorPane.value?.goToDefinition();
}

async function renameSymbol(): Promise<void> {
  await activeEditorPane.value?.renameSymbol();
}

async function findReferences(): Promise<void> {
  await activeEditorPane.value?.findReferences();
}

defineExpose({
  saveActiveEditor,
  openGotoLine,
  goToDefinition,
  renameSymbol,
  findReferences,
  revealEditorLine,
  killTerminal,
});
</script>

<template>
  <div
    class="relative min-h-0 min-w-0 flex-1 overflow-hidden bg-background"
    data-canvas
  >
    <!-- ── Tab 内容层:全部常驻挂载,按活动 tab 切换可见性 ───────────── -->
    <div
      :class="[
        'absolute inset-0',
        isActiveKind('terminal') ? '' : 'pointer-events-none invisible',
      ]"
      data-tab-layer="terminal"
      :aria-hidden="!isActiveKind('terminal')"
    >
      <div
        v-for="terminalTab in terminalTabs"
        v-show="terminalTab.id === activeId"
        :key="terminalTab.id"
        class="absolute inset-0"
      >
        <TerminalWorkspace
          :tab="terminalTab"
          :is-active="isActiveKind('terminal') && terminalTab.id === activeId"
          @rename="(leafId) => emit('rename-pane', leafId as number)"
          @pane-status="(status) => emit('pane-status', status as PaneStatus | null)"
        />
      </div>
    </div>

    <div
      :class="[
        'absolute inset-0',
        isActiveKind('preview') ? '' : 'pointer-events-none invisible',
      ]"
      data-tab-layer="preview"
      :aria-hidden="!isActiveKind('preview')"
    >
      <PreviewStack
        :tabs="tabs"
        :active-id="activeId"
        @url-change="(id, url) => tabsStore.updateTab(id, { url })"
      />
    </div>

    <div
      :class="[
        'absolute inset-0',
        isActiveKind('markdown') ? '' : 'pointer-events-none invisible',
      ]"
      data-tab-layer="markdown"
      :aria-hidden="!isActiveKind('markdown')"
    >
      <MarkdownStack :tabs="tabs" :active-id="activeId" />
    </div>

    <div
      :class="[
        'absolute inset-0',
        isActiveKind('file-preview') ? '' : 'pointer-events-none invisible',
      ]"
      data-tab-layer="file-preview"
      :aria-hidden="!isActiveKind('file-preview')"
    >
      <FilePreviewStack :tabs="tabs" :active-id="activeId" />
    </div>

    <div
      :class="[
        'absolute inset-0',
        isActiveGitDiff() ? '' : 'pointer-events-none invisible',
      ]"
      data-tab-layer="git-diff"
      :aria-hidden="!isActiveGitDiff()"
    >
      <GitDiffStack :tabs="tabs" :active-id="activeId" />
    </div>

    <div
      :class="[
        'absolute inset-0',
        isActiveKind('git-history') ? '' : 'pointer-events-none invisible',
      ]"
      data-tab-layer="git-history"
      :aria-hidden="!isActiveKind('git-history')"
    >
      <GitHistoryStack
        :tabs="tabs"
        :active-id="activeId"
        @open-commit-file="(input) => tabsStore.openCommitFileDiffTab(input)"
        @change-ref="handleHistoryRefChange"
      />
    </div>

    <div
      v-if="editorTabs.length > 0"
      data-tab-layer="editor"
      class="absolute inset-0 flex min-h-0 flex-col bg-background"
      :class="isActiveKind('editor') ? '' : 'pointer-events-none invisible'"
      :aria-hidden="!isActiveKind('editor')"
    >
      <div
        v-for="editorTab in editorTabs"
        v-show="editorTab.id === activeId"
        :key="editorTab.id"
        class="absolute inset-0 flex min-h-0 flex-col"
      >
        <EditorPane
          :ref="(el) => setEditorPaneRef(editorTab.id, el as EditorPaneExpose | null)"
          :path="editorTab.path"
          :fs-event="workspaceFsEvent"
          @dirty-change="(dirty) => tabsStore.updateTab(editorTab.id, { dirty })"
          @go-to-definition="(target) => emit('go-to-definition', target)"
          @request-rename="(edits) => emit('request-rename', edits)"
          @show-references="(groups) => emit('show-references', groups)"
        />
      </div>
    </div>
  </div>
</template>
