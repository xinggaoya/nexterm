<script setup lang="ts">
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
import type { WorkspaceEnv } from "@/modules/workspace";
import type { SplitDir } from "@/modules/terminal/lib/layout";

const props = defineProps<{
  workspaceName: string;
  workspacePath: string;
  env: WorkspaceEnv;
  gitBranch: string | null;
  showWindowControls: boolean;
  canSplit: boolean;
}>();

const emit = defineEmits<{
  "new-terminal": [];
  "split-pane": [dir: SplitDir];
  "open-command-palette": [];
  "open-settings": [];
}>();

async function handleRootPointerDown(event: PointerEvent) {
  if (event.button !== 0) return;
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
    <!-- 左:工作区身份(也是拖拽区) -->
    <div
      class="flex min-w-0 max-w-72 shrink-0 items-center gap-2 rounded-lg px-2 py-1"
      data-workspace-identity
      :title="workspacePath"
    >
      <span class="v2-dot-glow size-1.5 shrink-0 rounded-full bg-primary" />
      <span class="truncate font-medium text-foreground">{{ workspaceName }}</span>
      <span
        class="shrink-0 rounded-full bg-surface-hover px-1.5 py-px text-[10px] leading-4 text-muted-foreground"
        :data-env-badge="env.kind"
      >
        {{ envLabel }}
      </span>
      <span
        v-if="gitBranch"
        class="flex min-w-0 shrink-0 items-center gap-1 text-[11px] text-muted-foreground"
        :title="gitBranch"
      >
        <NIcon :component="GitBranchOutline" :size="11" />
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
      <WindowControls v-if="showWindowControls && !IS_MAC" />
    </div>
  </header>
</template>
