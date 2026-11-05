<script setup lang="ts">
/**
 * 停靠工作区面板（文件树 / 更改）。
 *
 * v3.2 壳层重设计：**面板本体不再有独立头部**。原来的 44px 标签头（文件树 /
 * 更改 标签组 + git 分支徽标）已并入顶栏右侧的控制簇 —— 顶栏 44px 之上再
 * 叠一条 44px 的面板头，右侧区域白白多占一条 chrome 带，且与顶栏割裂。
 *
 * 面板现在只负责内容：按 `tab` 切换文件树 / 源控两层，宽度可拖拽，
 * 显隐由宿主的顶栏折叠按钮控制。
 */
import { onBeforeUnmount, ref, type Ref } from "vue";
import type { GitCommitResult, WorkspaceFsChangedEvent } from "@/lib/native";
import FileExplorer from "@/modules/explorer/FileExplorer.vue";
import type { GitDecorationMap } from "@/modules/source-control";
import SourceControlPanel from "@/modules/source-control/SourceControlPanel.vue";
import type { WorkspacePanelTab } from "@/modules/settings/store";

const SIDE_PANEL_MIN = 240;
const SIDE_PANEL_MAX = 520;

const props = defineProps<{
  tab: WorkspacePanelTab;
  width: number;
  /**
   * 覆盖层模式：面板浮在画布之上，不占布局宽度。
   *
   * 极窄窗口（< 640px）里，面板与画布争宽度会把画布挤成 0，而画布才是
   * 终端与编辑器的主体。改为覆盖层后画布保持满宽，面板由顶栏按钮唤出。
   */
  overlay?: boolean;
  workspaceId: string;
  workspaceRoot: string | null;
  workspaceScope: string;
  activeRepoRoot: string | null;
  gitDecorations: GitDecorationMap;
  showBranchesModal: Ref<boolean>;
  fsEvent: WorkspaceFsChangedEvent | null;
}>();

const emit = defineEmits<{
  /** 面板自己不持有标签状态 —— 需要换视图时请求宿主切换。 */
  "request-tab": [tab: WorkspacePanelTab];
  "resize-width": [width: number];
  "open-file": [path: string, pin: boolean];
  "open-file-preview": [path: string];
  "open-markdown-preview": [path: string];
  "open-in-terminal": [path: string];
  "path-renamed": [from: string, to: string];
  "path-deleted": [path: string];
  "open-search-result": [path: string, line: number];
  "open-source-diff": [
    input: {
      repoRoot: string;
      path: string;
      mode: "-" | "+";
      originalPath: string | null;
      title?: string;
    },
  ];
  "open-source-history": [
    input: {
      repoRoot: string;
      refName?: string | null;
      allRefs?: boolean;
    },
  ];
  "repo-selected": [repoRoot: string | null];
  "decorations-change": [decorations: GitDecorationMap];
  "branch-change": [branch: string | null];
  "committed": [result: GitCommitResult];
}>();

const fileExplorerRef = ref<InstanceType<typeof FileExplorer> | null>(null);

// ── 左缘拖宽(面板位于画布右侧;持久化由宿主负责) ─────────────────────
let detachMove: (() => void) | null = null;
let detachUp: (() => void) | null = null;

function onResizeStart(e: PointerEvent) {
  e.preventDefault();
  const startX = e.clientX;
  const startWidth = props.width;

  function onMove(ev: PointerEvent) {
    const dx = ev.clientX - startX;
    // 向左拖(dx<0)加宽面板,与旧版右缘卡片拖拽手感一致。
    const next = Math.min(
      SIDE_PANEL_MAX,
      Math.max(SIDE_PANEL_MIN, Math.round(startWidth - dx)),
    );
    emit("resize-width", next);
  }

  function onUp() {
    window.removeEventListener("pointermove", onMove);
    window.removeEventListener("pointerup", onUp);
    detachMove = null;
    detachUp = null;
  }

  window.addEventListener("pointermove", onMove);
  window.addEventListener("pointerup", onUp);
  detachMove = () => window.removeEventListener("pointermove", onMove);
  detachUp = () => window.removeEventListener("pointerup", onUp);
}

onBeforeUnmount(() => {
  detachMove?.();
  detachUp?.();
});

// ── 宿主编排入口 ────────────────────────────────────────────────────────
defineExpose({
  /** workspace 切回时:立即重读根+展开节点。 */
  activate: () => fileExplorerRef.value?.activate(),
  /** workspace 切回时:取消防抖,立即执行 pending loadChildren。 */
  flushPendingTreeRefresh: () => fileExplorerRef.value?.flushPendingTreeRefresh(),
  /** Find in Files:进入内容搜索模式(并请求宿主切到文件树视图)。 */
  openFindInFiles: () => {
    if (props.tab !== "explorer") emit("request-tab", "explorer");
    fileExplorerRef.value?.setMode("content");
  },
});
</script>

<template>
  <aside
    class="flex h-full min-h-0 shrink-0 flex-col border-r border-border bg-sidebar"
    :class="
      overlay
        ? 'absolute inset-y-0 right-0 z-20 shadow-[var(--glass-shadow)]'
        : 'relative'
    "
    :style="{ width: `${width}px` }"
    data-workspace-panel
    data-workspace-panel-right
  >
    <!-- 内容层:v-show 保活,保持各模块状态 -->
    <div class="relative min-h-0 flex-1">
      <div
        v-show="tab === 'explorer'"
        class="absolute inset-0 overflow-hidden"
        data-panel-tab-explorer
      >
        <FileExplorer
          ref="fileExplorerRef"
          :root-path="workspaceRoot"
          :fs-event="fsEvent"
          :git-decorations="gitDecorations"
          @open-file="(path, pin) => emit('open-file', path, pin)"
          @open-file-preview="(path) => emit('open-file-preview', path)"
          @open-markdown-preview="(path) => emit('open-markdown-preview', path)"
          @open-in-terminal="(path) => emit('open-in-terminal', path)"
          @open-search-result="(path, line) => emit('open-search-result', path, line)"
          @path-renamed="(from, to) => emit('path-renamed', from, to)"
          @path-deleted="(path) => emit('path-deleted', path)"
        />
      </div>

      <div
        v-show="tab === 'changes'"
        class="absolute inset-0 overflow-hidden"
        data-panel-tab-changes
      >
        <SourceControlPanel
          :root-path="workspaceRoot"
          :workspace-scope="workspaceScope"
          :active-repo-root="activeRepoRoot"
          :fs-event="fsEvent"
          :show-branches-modal="showBranchesModal"
          :workspace-id="workspaceId"
          :visible="tab === 'changes'"
          @open-diff="(input) => emit('open-source-diff', input)"
          @open-history="(input) => emit('open-source-history', input)"
          @repo-selected="(repoRoot) => emit('repo-selected', repoRoot)"
          @decorations-change="(d) => emit('decorations-change', d)"
          @branch-change="(branch) => emit('branch-change', branch)"
          @committed="(result) => emit('committed', result)"
        />
      </div>
    </div>

    <!-- 左缘拖宽手柄(面板在画布右侧,向左拖加宽) -->
    <div
      data-panel-resizer
      class="absolute inset-y-0 left-0 z-10 w-1 cursor-col-resize bg-transparent transition-colors duration-[var(--dur-fast)] hover:bg-primary/30"
      @pointerdown="onResizeStart"
    />
  </aside>
</template>
