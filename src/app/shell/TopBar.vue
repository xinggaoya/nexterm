<script setup lang="ts">
/**
 * 工作台标题栏。
 *
 * v3.2 壳层重设计：全局侧栏下线后，标题栏左端承接「工作区切换器」，
 * 右端承接「停靠面板控制簇」（文件树 / 更改 + 折叠）。停靠面板自己不再有
 * 独立头部 —— 面板头与顶栏割裂成两条视觉带，纵向也白白多占 44px。
 *
 * v3.3：左右两侧各一个停靠面板，标题栏左端与右端各一个控制簇。
 * 控制簇**只负责展开/收起** —— 哪个视图放哪一侧是设置页的事，
 * 顶栏不提供第二个改布局的入口。
 *
 * 顶栏是全窗口唯一的一条 chrome 带：工作区身份、会话条、面板控制、动作区
 * 全在这里，面板与画布紧贴其下。
 */
import {
  AddOutline,
  DuplicateOutline,
  GitBranchOutline,
  ReorderTwoOutline,
  SearchOutline,
  SettingsOutline,
} from "@vicons/ionicons5";
import { getCurrentWindow } from "@tauri-apps/api/window";
import { NDropdown, NIcon, type DropdownOption } from "naive-ui";
import { computed, h, type VNode } from "vue";
import NextermIconButton from "@/components/NextermIconButton.vue";
import TooltipTitle from "@/components/TooltipTitle.vue";
import WindowControls from "@/components/WindowControls.vue";
import { IS_MAC } from "@/lib/platform";
import { t } from "@/modules/i18n/translate";
import type { WorkspaceEnv, WorkspaceInstance } from "@/modules/workspace";
import type { SplitDir } from "@/modules/terminal/lib/layout";
import type { DragPlacement } from "@/lib/usePointerDragReorder";
import WorkspaceSwitcher from "./WorkspaceSwitcher.vue";
import PanelControlCluster from "./PanelControlCluster.vue";
import type { PanelLayoutPref } from "@/modules/settings/store";

const props = defineProps<{
  workspaceName: string;
  workspacePath: string;
  env: WorkspaceEnv;
  gitBranch: string | null;
  showWindowControls: boolean;
  canSplit: boolean;
  /** 宽度偏窄：隐藏环境徽章，把空间让给会话条与动作区。 */
  compact?: boolean;
  /** 宽度很窄：连分支名也不再显示。 */
  dense?: boolean;
  /** 顶栏左端的工作区切换器数据源。 */
  workspaces: WorkspaceInstance[];
  activeWorkspaceId: string | null;
  /** 停靠面板的左右视图分配（左右各一个，不允许重复）。 */
  panelLayout: PanelLayoutPref;
  /** 左侧停靠面板是否展开。 */
  leftPanelOpen: boolean;
  /** 右侧停靠面板是否展开。 */
  rightPanelOpen: boolean;
}>();

const emit = defineEmits<{
  "new-terminal": [];
  "split-pane": [dir: SplitDir];
  "open-command-palette": [];
  "open-settings": [];
  "select-workspace": [id: string];
  "close-workspace": [id: string];
  "add-workspace": [env: WorkspaceEnv];
  "open-workspace-in-new-window": [id: string];
  "reorder-workspace": [sourceId: string, targetId: string, placement: DragPlacement];
  "toggle:left-panel": [];
  "toggle:right-panel": [];
}>();

async function handleRootPointerDown(event: PointerEvent) {
  if (event.button !== 0) return;
  // 显式声明的「不可拖拽区」优先（工作区切换器等交互区）。
  const target = event.target as HTMLElement | null;
  if (target?.closest("[data-no-drag]")) return;
  // 只在用户直接按在顶栏空白处时启动原生拖拽;落在按钮/会话条上的
  // 事件 target 不是 currentTarget,自然放行。
  if (event.target !== event.currentTarget) return;
  event.preventDefault();
  event.stopPropagation();
  try {
    await getCurrentWindow().startDragging();
  } catch {
    // Browser-only dev/test context
  }
}

const envLabel = computed(() => {
  if (props.env.kind === "wsl") return `WSL · ${props.env.distro}`;
  if (props.env.kind === "ssh") return "SSH";
  return t("app.rail.envLocal");
});

// ── 分屏下拉 ────────────────────────────────────────────────────────────
const splitOptions = computed<DropdownOption[]>(() => [
  { key: "row", label: t("app.header.splitRight") },
  { key: "col", label: t("app.header.splitDown") },
]);

function renderSplitIcon(option: DropdownOption): VNode {
  return h(NIcon, { size: 14 }, { default: () => h(option.key === "col" ? ReorderTwoOutline : DuplicateOutline) });
}

function handleSplitSelect(key: string | number) {
  emit("split-pane", key === "col" ? "col" : "row");
}
</script>

<template>
  <header
    class="flex h-11 shrink-0 items-center gap-2 border-b border-border bg-title-bar px-2 text-[12px]"
    :class="IS_MAC ? 'pl-[76px]' : ''"
    data-top-bar
    @pointerdown="handleRootPointerDown"
  >
    <!-- 左:工作区切换器 + 左侧面板控制簇 -->
    <WorkspaceSwitcher
      :workspaces="workspaces"
      :active-workspace-id="activeWorkspaceId"
      @select-workspace="(id) => emit('select-workspace', id)"
      @close-workspace="(id) => emit('close-workspace', id)"
      @add-workspace="(env) => emit('add-workspace', env)"
      @open-workspace-in-new-window="(id) => emit('open-workspace-in-new-window', id)"
      @reorder-workspace="(sourceId, targetId, placement) => emit('reorder-workspace', sourceId, targetId, placement)"
    />

    <PanelControlCluster
      side="left"
      :view="panelLayout.left"
      :open="leftPanelOpen"
      @toggle="emit('toggle:left-panel')"
    />

    <!--
      身份区:只保留环境徽标与分支名。
      工作区名称已由切换器承载,再重复一遍是冗余;分支名在窄窗隐藏 ——
      状态坞里始终有一份。
    -->
    <div
      class="flex min-w-0 shrink items-center gap-1.5 rounded-lg px-1.5 py-1"
      data-workspace-identity
      :title="workspacePath"
    >
      <span
        v-if="!compact"
        class="shrink-0 rounded-full bg-surface-hover px-1.5 py-px text-[10px] leading-4 text-muted-foreground"
        :data-env-badge="env.kind"
      >
        {{ envLabel }}
      </span>
      <span
        v-if="gitBranch && !dense"
        class="flex min-w-0 shrink items-center gap-1 text-[11px] text-muted-foreground"
        :title="gitBranch"
      >
        <NIcon :component="GitBranchOutline" :size="11" class="shrink-0" />
        <span class="max-w-28 truncate">{{ gitBranch }}</span>
      </span>
    </div>

    <!-- 中:会话条(由父组件注入) -->
    <div class="flex h-full min-w-0 flex-1 items-center">
      <slot name="center" />
    </div>

    <!-- 右:动作区 -->
    <div class="flex shrink-0 items-center gap-0.5">
      <TooltipTitle :label="t('app.header.newTerminal')">
        <NextermIconButton
          data-new-terminal
          :aria-label="t('app.header.newTerminal')"
          @click="emit('new-terminal')"
        >
          <NIcon :component="AddOutline" :size="14" />
        </NextermIconButton>
      </TooltipTitle>
      <TooltipTitle :label="t('app.header.splitActions')">
        <NDropdown
          trigger="click"
          placement="bottom-end"
          :options="splitOptions"
          :disabled="!canSplit"
          :render-icon="renderSplitIcon"
          @select="handleSplitSelect"
        >
          <NextermIconButton
            data-split-terminal
            :disabled="!canSplit"
            :aria-label="t('app.header.splitActions')"
          >
            <NIcon :component="DuplicateOutline" :size="14" />
          </NextermIconButton>
        </NDropdown>
      </TooltipTitle>
      <TooltipTitle :label="t('app.header.openCommandCenter')">
        <NextermIconButton
          data-open-command-palette
          :aria-label="t('app.header.openCommandCenter')"
          @click="emit('open-command-palette')"
        >
          <NIcon :component="SearchOutline" :size="14" />
        </NextermIconButton>
      </TooltipTitle>
      <TooltipTitle :label="t('common.settings')">
        <NextermIconButton
          data-open-settings
          :aria-label="t('common.settings')"
          @click="emit('open-settings')"
        >
          <NIcon :component="SettingsOutline" :size="14" />
        </NextermIconButton>
      </TooltipTitle>

      <!--
        右侧面板控制簇:贴在右端,正好落在面板上方。
        面板本体不再有独立头部 —— 原来顶栏 44px 之上还叠着面板自己的 44px,
        右侧区域白白多占一条 chrome 带。
      -->
      <PanelControlCluster
        side="right"
        class="ml-1"
        :view="panelLayout.right"
        :open="rightPanelOpen"
        @toggle="emit('toggle:right-panel')"
      />

      <WindowControls v-if="showWindowControls && !IS_MAC" />
    </div>
  </header>
</template>
