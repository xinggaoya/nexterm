<script setup lang="ts">
/**
 * 停靠面板的控制簇（顶栏左端 / 右端各一个）。
 *
 * **这里只做展开 / 收起。** 哪个视图放在哪一侧是「设置 → 通用 → 停靠面板
 * 布局」的事 —— 顶栏不再是第二个能改布局的地方，否则同一个设置有两个入口，
 * 用户会分不清「顶栏那个按钮改了以后设置里的值也跟着变吗」。
 *
 * 于是簇里只剩两样东西：
 * - **只读指示**：一枚图标，说明这一侧当前放的是文件树还是更改。
 *   它不是按钮，点不动 —— 只把「关掉的是哪个视图」讲清楚。
 * - **折叠按钮**：开 / 关当前这一侧。视图选择保留，关掉再打开还是它。
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
import type { PanelSide } from "./panelVisibility";

const props = defineProps<{
  /** 面板停靠在哪一侧 —— 决定折叠箭头的朝向与指示文案。 */
  side: PanelSide;
  /** 这一侧当前显示的视图（只读指示用）。 */
  view: PanelView;
  /** 这一侧是否展开。 */
  open: boolean;
}>();

const emit = defineEmits<{
  toggle: [];
}>();

/** 视图图标（只读）。 */
const viewIcon = computed(() =>
  props.view === "explorer" ? FolderOpenOutline : GitBranchOutline,
);

/** 视图名（只读指示的可读名称 / 提示）。 */
const viewLabel = computed(() =>
  props.view === "explorer"
    ? t("app.rail.tool.explorer")
    : t("app.rail.tool.changes"),
);

/** 侧别名，用于把「哪一侧 + 哪个视图」讲清楚。 */
const sideLabel = computed(() =>
  props.side === "left" ? t("app.titleBar.leftPanel") : t("app.titleBar.rightPanel"),
);

/**
 * 折叠按钮的文案必须带侧别 —— 两侧各有一个同名按钮（「隐藏侧面板」）时，
 * 屏幕阅读器用户根本分不清按的是哪一侧。
 */
const toggleLabel = computed(() => {
  const open = props.open;
  if (props.side === "left") {
    return open ? t("app.titleBar.panelHideLeft") : t("app.titleBar.panelShowLeft");
  }
  return open ? t("app.titleBar.panelHideRight") : t("app.titleBar.panelShowRight");
});

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
    class="flex items-center gap-0.5 rounded-md bg-surface-subtle p-0.5"
  >
    <!--
      只读指示：这一侧放的是哪个视图。
      刻意不做成按钮 —— 换视图只去设置里换，这里只负责讲清楚现状。
    -->
    <TooltipTitle :label="`${sideLabel}：${viewLabel}`">
      <span
        data-panel-view-indicator
        :data-panel-view="view"
        role="img"
        :aria-label="`${sideLabel}：${viewLabel}`"
        class="grid size-7 shrink-0 place-items-center text-muted-foreground"
      >
        <NIcon :component="viewIcon" :size="14" />
      </span>
    </TooltipTitle>
    <TooltipTitle :label="toggleLabel">
      <NextermIconButton
        data-toggle-panel
        :aria-pressed="open"
        :aria-label="toggleLabel"
        @click="toggleOpen"
      >
        <NIcon :component="collapseIcon" :size="14" />
      </NextermIconButton>
    </TooltipTitle>
  </div>
</template>
