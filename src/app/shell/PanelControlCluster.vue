<script setup lang="ts">
/**
 * 停靠面板的控制簇（顶栏左端 / 右端各一个）。
 *
 * 一个簇管一侧面板的两个动作：
 * - **分段控件**：文件树 / 更改 —— 选哪个视图。选中即展开面板
 *   （「选它」就是想看它，收着的话点了没反应会让人困惑）。
 * - **折叠按钮**：开 / 关当前这一侧。视图选择保留，关掉再打开还是它。
 *
 * 视图与显隐是**两个独立维度**（`view` 与 `open`），所以收起时分段控件
 * 仍然高亮着当前视图 —— 用户知道自己关掉的是什么。
 */
import {
  ChevronBackOutline,
  ChevronForwardOutline,
  FolderOpenOutline,
  GitBranchOutline,
} from "@vicons/ionicons5";
import { NIcon } from "naive-ui";
import { computed } from "vue";
import NextermIconButton from "@/components/NextermIconButton.vue";
import TooltipTitle from "@/components/TooltipTitle.vue";
import { t } from "@/modules/i18n/translate";
import type { PanelView } from "@/modules/settings/store";

/** 一侧面板的状态：当前视图 + 是否展开。 */
export interface PanelSlotState {
  view: PanelView;
  open: boolean;
}

const props = defineProps<{
  /** 面板停靠在哪一侧 —— 决定折叠箭头的朝向。 */
  side: "left" | "right";
  view: PanelView;
  open: boolean;
}>();

const emit = defineEmits<{
  "update:slot": [slot: PanelSlotState];
}>();

/** 选视图即展开。 */
function selectView(view: PanelView) {
  emit("update:slot", { view, open: true });
}

/** 折叠 / 展开当前这一侧，视图选择保持不变。 */
function toggleOpen() {
  emit("update:slot", { view: props.view, open: !props.open });
}

/**
 * 折叠箭头朝向：
 * - 右侧面板展开时，箭头朝右（往右收）；收起时朝左（往左拉）。
 * - 左侧面板镜像。
 */
const collapseIcon = computed(() =>
  (props.side === "right") === props.open
    ? ChevronForwardOutline
    : ChevronBackOutline,
);
</script>

<template>
  <div
    data-panel-cluster
    :data-panel-cluster-side="side"
    class="flex items-center gap-0.5 rounded-lg bg-surface-subtle p-0.5"
  >
    <TooltipTitle :label="t('app.rail.tool.explorer')">
      <NextermIconButton
        data-panel-tab="explorer"
        :aria-pressed="view === 'explorer'"
        :aria-label="t('app.rail.tool.explorer')"
        @click="selectView('explorer')"
      >
        <NIcon :component="FolderOpenOutline" :size="14" />
      </NextermIconButton>
    </TooltipTitle>
    <TooltipTitle :label="t('app.rail.tool.changes')">
      <NextermIconButton
        data-panel-tab="changes"
        :aria-pressed="view === 'changes'"
        :aria-label="t('app.rail.tool.changes')"
        @click="selectView('changes')"
      >
        <NIcon :component="GitBranchOutline" :size="14" />
      </NextermIconButton>
    </TooltipTitle>
    <TooltipTitle
      :label="open ? t('app.titleBar.panelHide') : t('app.titleBar.panelShow')"
    >
      <NextermIconButton
        data-toggle-panel
        :aria-pressed="open"
        :aria-label="open ? t('app.titleBar.panelHide') : t('app.titleBar.panelShow')"
        @click="toggleOpen"
      >
        <NIcon :component="collapseIcon" :size="14" />
      </NextermIconButton>
    </TooltipTitle>
  </div>
</template>
