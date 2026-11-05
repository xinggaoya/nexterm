<script setup lang="ts">
/**
 * 停靠面板的控制簇（顶栏左端 / 右端各一个）。
 *
 * 一个簇管一侧面板的两个动作：
 * - **分段控件**：文件树 / 更改 —— 选这一侧显示哪个视图。
 *   同一个视图不允许同时出现在两侧，所以点另一个侧已经占着的视图时
 *   两侧**对调**（见 `shell/panelVisibility.ts` 的 `assignPanelView`）。
 * - **折叠按钮**：开 / 关当前这一侧。视图选择保留，关掉再打开还是它。
 *
 * 视图与显隐是**两个独立维度**（`layout` 与 `open`），所以收起时分段控件
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
import { assignPanelView, type PanelSide } from "./panelVisibility";
const props = defineProps<{
  /** 面板停靠在哪一侧 —— 决定折叠箭头的朝向。 */
  side: PanelSide;
  /** 全局的左右视图分配。 */
  layout: { left: PanelView; right: PanelView };
  /** 这一侧是否展开。 */
  open: boolean;
}>();

const emit = defineEmits<{
  "update:layout": [layout: { left: PanelView; right: PanelView }];
  toggle: [];
}>();

/** 这一侧当前显示的视图。 */
const currentView = computed<PanelView>(() => props.layout[props.side]);

/** 选视图：另一侧已经占着就两侧对调，绝不出现重复视图。 */
function selectView(view: PanelView) {
  emit("update:layout", assignPanelView(props.layout, props.side, view));
}

/** 折叠 / 展开当前这一侧，视图选择保持不变。 */
function toggleOpen() {
  emit("toggle");
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
        :aria-pressed="currentView === 'explorer'"
        :aria-label="t('app.rail.tool.explorer')"
        @click="selectView('explorer')"
      >
        <NIcon :component="FolderOpenOutline" :size="14" />
      </NextermIconButton>
    </TooltipTitle>
    <TooltipTitle :label="t('app.rail.tool.changes')">
      <NextermIconButton
        data-panel-tab="changes"
        :aria-pressed="currentView === 'changes'"
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
