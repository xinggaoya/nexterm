<script setup lang="ts">
import { CloseOutline } from "@vicons/ionicons5";
import { NIcon } from "naive-ui";
import { onBeforeUnmount, ref } from "vue";
import TooltipTitle from "@/components/TooltipTitle.vue";
import { t } from "@/modules/i18n/translate";

/**
 * 玻璃拟态浮层容器:终端优先壳层里面板(文件树/源控/任务)的统一外壳。
 * placement="left" 为左列浮层(可拖右缘调宽),placement="bottom" 为底部
 * 浮层(任务控制台,固定高度)。浮层只覆盖画布,不改变其布局。
 */
const props = withDefaults(
  defineProps<{
    title: string;
    placement?: "left" | "bottom";
    width?: number;
    height?: number;
    draggable?: boolean;
    showHeader?: boolean;
  }>(),
  {
    placement: "left",
    width: 340,
    height: 300,
    draggable: true,
    showHeader: true,
  },
);

const emit = defineEmits<{
  close: [];
  "resize-width": [width: number];
}>();

const SIDE_PANEL_MIN = 240;
const SIDE_PANEL_MAX = 520;

const dragging = ref(false);
let detachMove: (() => void) | null = null;
let detachUp: (() => void) | null = null;

function onResizeStart(e: PointerEvent) {
  if (!props.draggable) return;
  e.preventDefault();
  dragging.value = true;
  const startX = e.clientX;
  const startWidth = props.width;

  function onMove(ev: PointerEvent) {
    const dx = ev.clientX - startX;
    // 向左拖(dx<0)加宽浮层,与旧版右缘 explorer 卡片一致。
    const next = Math.min(
      SIDE_PANEL_MAX,
      Math.max(SIDE_PANEL_MIN, Math.round(startWidth - dx)),
    );
    emit("resize-width", next);
  }

  function onUp() {
    dragging.value = false;
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
</script>

<template>
  <section
    class="nexterm-overlay-panel v2-glass absolute z-30 flex flex-col overflow-hidden rounded-xl border border-border/80 shadow-[var(--glass-shadow)]"
    :class="[
      placement === 'left'
        ? 'bottom-2 left-2 top-2 v2-anim-slide-left'
        : 'inset-x-2 bottom-2 v2-anim-slide-up',
    ]"
    :style="
      placement === 'left'
        ? { width: `${width}px` }
        : { height: `${height}px` }
    "
    :data-overlay-placement="placement"
  >
    <header
      v-if="showHeader"
      class="flex h-9 shrink-0 items-center justify-between gap-2 border-b border-border/70 pl-3 pr-1.5"
    >
      <span class="text-[12px] font-medium tracking-wide text-foreground">{{ title }}</span>
      <TooltipTitle :label="t('common.close')">
        <button
          type="button"
          data-overlay-close
          class="grid size-6 place-items-center rounded-md text-muted-foreground transition-colors duration-[var(--dur-fast)] hover:bg-surface-hover hover:text-foreground"
          :aria-label="t('common.close')"
          @click="emit('close')"
        >
          <NIcon :component="CloseOutline" :size="13" />
        </button>
      </TooltipTitle>
    </header>

    <div class="relative min-h-0 flex-1 overflow-hidden">
      <slot />
    </div>

    <!-- 右缘调宽手柄(仅左列浮层) -->
    <div
      v-if="placement === 'left' && draggable"
      data-overlay-resizer
      class="absolute inset-y-0 right-0 z-10 w-1 cursor-col-resize bg-transparent transition-colors duration-[var(--dur-fast)] hover:bg-primary/40"
      @pointerdown="onResizeStart"
    />
  </section>
</template>
