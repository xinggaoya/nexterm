<script setup lang="ts">
import type { PendingEdit, ReferenceGroup } from "@/modules/lsp/lspLanguageSupport";
import { computed, defineAsyncComponent, ref } from "vue";
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
import type { Tab, TerminalTab } from "@/modules/tabs/tabsTypes";

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

const activeEditorPane = ref<InstanceType<typeof EditorPane> | null>(null);

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
      v-if="activeTab && activeTab.kind === 'editor'"
      data-tab-layer="editor"
      class="absolute inset-0 flex min-h-0 flex-col bg-background"
      :class="isActiveKind('editor') ? '' : 'pointer-events-none invisible'"
      :aria-hidden="!isActiveKind('editor')"
    >
      <EditorPane
        ref="activeEditorPane"
        :path="activeTab.path"
        :fs-event="workspaceFsEvent"
        @dirty-change="(dirty) => tabsStore.updateTab(activeTab!.id, { dirty })"
        @go-to-definition="(target) => emit('go-to-definition', target)"
        @request-rename="(edits) => emit('request-rename', edits)"
        @show-references="(groups) => emit('show-references', groups)"
      />
    </div>
  </div>
</template>
