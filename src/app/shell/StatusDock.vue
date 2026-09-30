<script setup lang="ts">
/**
 * 状态坞（标题栏与画布之间那一条）。
 *
 * 左侧是环境 / 工作区 / 分支；右侧此前**整片空着** —— `justify-between` 却只有
 * 一个子元素，24px 高的常驻条白白占着位置。
 *
 * 对一个以终端为主的 IDE，右侧真正该报的是「当前这条终端正在发生什么」：
 * 尺寸（`cols×rows` 决定了 TUI 工具的布局）、渲染器（WebGL 掉了要立刻知道）、
 * 会话状态。cwd 已经由每个分屏的标题栏承担，这里不重复。
 */
import { GitBranchOutline } from "@vicons/ionicons5";
import { NIcon } from "naive-ui";
import { computed } from "vue";
import { t } from "@/modules/i18n/translate";
import type { WorkspaceEnv } from "@/modules/workspace";
import type { RendererKind } from "@/modules/terminal/lib/rendererPipeline";
import type { SessionState } from "@/modules/terminal/lib/sessions";

const props = defineProps<{
  workspaceName: string;
  env: WorkspaceEnv;
  gitBranch: string | null;
  /** 活动分屏的终端尺寸；无活动终端 tab 时为 null。 */
  terminalSize?: { cols: number; rows: number } | null;
  /** 实际生效的渲染器（设置里选的和 WebGL 回退后真正在跑的可能不同）。 */
  renderer?: RendererKind | null;
  /** 活动分屏的会话状态。 */
  sessionState?: SessionState | null;
}>();

const envLabel = computed(() => {
  if (props.env.kind === "wsl") return `WSL · ${props.env.distro}`;
  if (props.env.kind === "ssh") return "SSH";
  return t("app.rail.envLocal");
});

const sessionLabel = computed(() => {
  switch (props.sessionState) {
    case "running":
      return null;
    case "connecting":
      return t("terminal.stateConnecting");
    case "exited":
      return t("terminal.stateExited");
    default:
      return null;
  }
});

/** 渲染器徽标：WebGL 掉回 DOM 时必须一眼看出来（字形/抗锯齿会变）。 */
const rendererLabel = computed(() =>
  props.renderer === "webgl"
    ? t("app.dock.rendererWebgl")
    : props.renderer === "dom"
      ? t("app.dock.rendererDom")
      : null,
);

const hasRightContent = computed(
  () =>
    Boolean(props.terminalSize) ||
    Boolean(rendererLabel.value) ||
    Boolean(sessionLabel.value),
);
</script>

<template>
  <footer
    class="flex h-6 shrink-0 items-center justify-between gap-3 border-t border-border bg-shell-bg px-3 text-[11px] text-muted-foreground"
    data-status-dock
  >
    <div class="flex min-w-0 items-center gap-2">
      <span class="size-1.5 shrink-0 rounded-full bg-success/70" />
      <span
        class="shrink-0 rounded-full bg-surface-hover px-1.5 text-[10px] leading-4"
        :data-env-badge="env.kind"
      >{{ envLabel }}</span>
      <span class="truncate" :title="workspaceName">{{ workspaceName }}</span>
      <span
        v-if="gitBranch"
        class="flex min-w-0 shrink-0 items-center gap-1"
        :title="gitBranch"
      >
        <NIcon :component="GitBranchOutline" :size="11" />
        <span class="max-w-36 truncate">{{ gitBranch }}</span>
      </span>
    </div>

    <!--
      右侧：只有真的有内容时才占位。没有活动终端时保持整条空着，而不是留一串
      “–” 之类的占位符。
    -->
    <div
      v-if="hasRightContent"
      class="flex shrink-0 items-center gap-2.5"
      data-status-dock-right
    >
      <span
        v-if="sessionLabel"
        class="shrink-0 text-[10px] text-warning"
        data-dock-session
      >
        {{ sessionLabel }}
      </span>
      <span
        v-if="rendererLabel"
        class="shrink-0 rounded-full bg-surface-hover px-1.5 text-[10px] leading-4"
        :title="t('app.dock.rendererHint')"
        data-dock-renderer
      >
        {{ rendererLabel }}
      </span>
      <span
        v-if="terminalSize"
        class="shrink-0 tabular-nums"
        :title="t('app.dock.sizeHint')"
        data-dock-size
      >
        {{ terminalSize.cols }}×{{ terminalSize.rows }}
      </span>
    </div>
  </footer>
</template>
